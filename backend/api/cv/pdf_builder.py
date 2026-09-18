"""
Rule-based ATS CV generation, rendered server-side with reportlab.

Chosen over WeasyPrint/HTML-to-PDF because the deploy target is a slim
Docker image (python:3.11-slim, only gcc/libpq-dev/curl installed) — adding
WeasyPrint's native dependency chain (Pango, Cairo, GDK-Pixbuf) is real
deploy risk for no benefit here, while reportlab ships as prebuilt wheels.

"Revamp" is rule-based, not generative: no word is ever added, removed, or
substituted in a fact the candidate wrote — every skill, employer, metric,
and claim in the output already existed in their CV (or was a job-required
skill they explicitly confirmed having, via the checkbox flow in main.py).
"Tailoring" is achieved only through two safe, deterministic operations:
  1. Reordering — bullets/sentences/skills that match the target job's
     keywords, or show a generic transferable signal (collaboration,
     stakeholder work, research...), are moved earlier; word-for-word text
     is untouched.
  2. Highlighting — the exact substring that made something relevant is
     bolded in place, so a human reader's eye is drawn to it; this changes
     zero characters of the underlying text (irrelevant to ATS parsing,
     which reads raw text and ignores styling).
A professional-summary line is synthesized from a small template only when
none exists in the original CV; when one exists, its own sentences are
reordered by the same relevance rule rather than replaced.
"""
import re
from io import BytesIO
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, ListFlowable, ListItem, KeepInFrame,
)

from api.cv.parser import ParsedCV
from api.cv.matcher import build_phrase_for_skills, has_transferable_signal, TRANSFERABLE_SIGNAL_RE

_styles = getSampleStyleSheet()

NAME_STYLE = ParagraphStyle("CvName", parent=_styles["Title"], alignment=TA_LEFT, fontSize=20, spaceAfter=2, textColor=colors.HexColor("#111827"))
CONTACT_STYLE = ParagraphStyle("CvContact", parent=_styles["Normal"], fontSize=9.5, textColor=colors.HexColor("#6b7280"), spaceAfter=10)
SECTION_HEADER_STYLE = ParagraphStyle("CvSection", parent=_styles["Heading2"], fontSize=11.5, spaceBefore=12, spaceAfter=4, textColor=colors.HexColor("#111827"), fontName="Helvetica-Bold")
BODY_STYLE = ParagraphStyle("CvBody", parent=_styles["Normal"], fontSize=9.5, leading=13.5, textColor=colors.HexColor("#1f2937"))
ENTRY_TITLE_STYLE = ParagraphStyle("CvEntryTitle", parent=_styles["Normal"], fontSize=10, leading=13, fontName="Helvetica-Bold", textColor=colors.HexColor("#111827"))
ENTRY_META_STYLE = ParagraphStyle("CvEntryMeta", parent=_styles["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#6b7280"))
BULLET_STYLE = ParagraphStyle("CvBullet", parent=_styles["Normal"], fontSize=9.5, leading=13, textColor=colors.HexColor("#1f2937"))
TARGET_ROLE_STYLE = ParagraphStyle("CvTargetRole", parent=_styles["Normal"], fontSize=10.5, leading=13, fontName="Helvetica-Bold", textColor=colors.HexColor("#4b5563"), spaceAfter=3)


def _section_header(title: str):
    return [
        Paragraph(title.upper(), SECTION_HEADER_STYLE),
        HRFlowable(width="100%", thickness=0.75, color=colors.HexColor("#d1d5db"), spaceAfter=6),
    ]


def _rank_by_keywords(items: list[str], matched_lower: set[str]) -> list[str]:
    """Rank a candidate's own real bullets/skills for visibility: an exact
    match against the target job's keywords ranks first, a generic
    transferable-skill signal (collaboration, stakeholder work, research...)
    ranks second, everything else stays last. Order only ever changes —
    nothing here rewrites or invents text, so a career switcher's real but
    less specific experience still surfaces above buried unrelated detail."""
    def relevance(item: str) -> int:
        low = item.lower()
        # Word-boundary match, not plain substring — otherwise a job keyword
        # like "sql" would falsely match inside "postgresql" or "nosql" and
        # outrank a candidate's genuinely relevant transferable skills.
        if any(re.search(r"\b" + re.escape(kw) + r"\b", low) for kw in matched_lower):
            return 0
        if has_transferable_signal(low):
            return 1
        return 2
    return sorted(items, key=relevance)


def _escape(text: str) -> str:
    """Escape a real CV field for reportlab's mini-XML Paragraph markup, so a
    literal '&'/'<'/'>' in someone's own text (e.g. "R&D", "Sales & Marketing")
    can't be mistaken for markup or crash rendering."""
    return xml_escape(text or "")


def _highlight_relevant(text: str, matched_lower: set[str]) -> str:
    """Bold the exact substring(s) that make this line relevant to the target
    job — a literal job-keyword match or a transferable-skill signal — so a
    human reader's eye is drawn to it. Escapes first and only ever wraps
    existing characters in <b></b>; no word is added, removed, or changed."""
    escaped = _escape(text)
    spans = []
    for kw in matched_lower:
        for m in re.finditer(r"\b" + re.escape(kw) + r"\b", escaped, re.IGNORECASE):
            spans.append(m.span())
    for m in TRANSFERABLE_SIGNAL_RE.finditer(escaped):
        spans.append(m.span())
    if not spans:
        return escaped

    spans.sort()
    merged = [spans[0]]
    for start, end in spans[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    out, cursor = [], 0
    for start, end in merged:
        out.append(escaped[cursor:start])
        out.append(f"<b>{escaped[start:end]}</b>")
        cursor = end
    out.append(escaped[cursor:])
    return "".join(out)


def build_ats_cv_pdf(
    parsed: ParsedCV,
    matched_skills: list[str] | None = None,
    job_title: str = "",
    company: str = "",
) -> bytes:
    matched_lower = {s.lower() for s in (matched_skills or [])}
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=13 * mm, bottomMargin=12 * mm, leftMargin=17 * mm, rightMargin=17 * mm,
        title=f"{parsed.name or 'CV'} - ATS CV",
    )

    story = []

    story.append(Paragraph(_escape(parsed.name) or "Your Name", NAME_STYLE))
    if job_title:
        story.append(Paragraph(_escape(job_title), TARGET_ROLE_STYLE))
    contact_bits = [_escape(c) for c in [parsed.email, parsed.phone] if c]
    if contact_bits:
        story.append(Paragraph(" &nbsp;&middot;&nbsp; ".join(contact_bits), CONTACT_STYLE))
    story.append(HRFlowable(width="100%", thickness=1.2, color=colors.HexColor("#111827"), spaceAfter=10))

    # Summary — an existing one has its own sentences reordered by relevance
    # (same rule as bullets below) rather than replaced; only when none
    # exists at all do we synthesize a short, templated line, grounded in
    # the candidate's own most recent title and top real skills.
    ordered_skills = _rank_by_keywords(parsed.skills, matched_lower) if parsed.skills else []
    top_skills = ordered_skills[:3]
    if parsed.summary:
        sentences = [
            s.strip() for s in re.split(r"(?<=[.!?])\s+|(?=Applying for\b)", parsed.summary.strip())
            if s.strip() and not s.strip().lower().startswith("applying for")
        ]
        ranked_sentences = _rank_by_keywords(sentences, matched_lower)
        summary_body = " ".join(ranked_sentences[:3])
        if job_title:
            summary_body += f" Applying for the {job_title} role" + (f" at {company}." if company else ".")
    else:
        phrase = build_phrase_for_skills(top_skills)
        skill_clause = f" with hands-on experience in {', '.join(top_skills)}" if top_skills else ""
        role_clause = f" seeking to bring this expertise to the {job_title} role" if job_title else ""
        company_clause = f" at {company}" if (job_title and company) else ""
        subject = (parsed.experience[0].title if parsed.experience and parsed.experience[0].title else None) or "Motivated professional"
        summary_body = f"{subject}{skill_clause}. Proven ability to {phrase}{role_clause}{company_clause}."
    story += _section_header("Summary")
    story.append(Paragraph(_highlight_relevant(summary_body, matched_lower), BODY_STYLE))

    if parsed.experience:
        story += _section_header("Relevant Experience")
        for entry in parsed.experience:
            title_line = _escape(entry.title) or "Role"
            story.append(Paragraph(title_line, ENTRY_TITLE_STYLE))
            meta_bits = [_escape(b) for b in [entry.company, entry.dates] if b]
            if meta_bits:
                story.append(Paragraph(" &nbsp;&middot;&nbsp; ".join(meta_bits), ENTRY_META_STYLE))
            if entry.bullets:
                ranked_bullets = _rank_by_keywords(entry.bullets, matched_lower)
                items = [ListItem(Paragraph(_highlight_relevant(b, matched_lower), BULLET_STYLE), leftIndent=10) for b in ranked_bullets]
                story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=12, spaceBefore=2, spaceAfter=6))
            else:
                story.append(Spacer(1, 6))

    if ordered_skills:
        story += _section_header("Skills")
        story.append(Paragraph(" &nbsp;&bull;&nbsp; ".join(_highlight_relevant(s, matched_lower) for s in ordered_skills), BODY_STYLE))
        story.append(Spacer(1, 4))

    if parsed.education:
        story += _section_header("Education")
        for entry in parsed.education:
            story.append(Paragraph(_escape(entry.degree or entry.institution), ENTRY_TITLE_STYLE))
            meta_bits = [_escape(b) for b in [entry.institution if entry.degree else "", entry.dates] if b]
            if meta_bits:
                story.append(Paragraph(" &nbsp;&middot;&nbsp; ".join(meta_bits), ENTRY_META_STYLE))
            story.append(Spacer(1, 4))

    if parsed.low_confidence:
        story += _section_header("Additional Information (from original CV)")
        story.append(Paragraph(
            "This CV's structure was hard to parse automatically, so the original text is included "
            "below to avoid losing any information.",
            ENTRY_META_STYLE,
        ))
        story.append(Spacer(1, 4))
        for para in parsed.raw_text.split("\n\n"):
            cleaned = _escape(para.strip()).replace("\n", "<br/>")
            if cleaned:
                story.append(Paragraph(cleaned, BODY_STYLE))
                story.append(Spacer(1, 4))

    story.append(Spacer(1, 14))
    story.append(Paragraph("Generated by Annex Careers", ENTRY_META_STYLE))

    # Keep the generated CV to one page. ReportLab scales the complete,
    # already-ranked document only when a long source CV needs it.
    doc.build([KeepInFrame(doc.width, doc.height, story, mode="shrink")])
    return buf.getvalue()
