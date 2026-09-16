"""
Rule-based ATS CV generation, rendered server-side with reportlab.

Chosen over WeasyPrint/HTML-to-PDF because the deploy target is a slim
Docker image (python:3.11-slim, only gcc/libpq-dev/curl installed) — adding
WeasyPrint's native dependency chain (Pango, Cairo, GDK-Pixbuf) is real
deploy risk for no benefit here, while reportlab ships as prebuilt wheels.

"Revamp" is rule-based, not generative: matched skills/bullets are
reordered to the top, but existing bullet TEXT is never rewritten — only
its order changes — since inventing new claims about someone's own work
without their input would be worse than not revamping at all. A
professional-summary line is synthesized from a small template only when
none exists in the original CV.
"""
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, ListFlowable, ListItem,
)

from api.cv.parser import ParsedCV
from api.cv.matcher import build_phrase_for_skills

_styles = getSampleStyleSheet()

NAME_STYLE = ParagraphStyle("CvName", parent=_styles["Title"], alignment=TA_LEFT, fontSize=20, spaceAfter=2, textColor=colors.HexColor("#111827"))
CONTACT_STYLE = ParagraphStyle("CvContact", parent=_styles["Normal"], fontSize=9.5, textColor=colors.HexColor("#6b7280"), spaceAfter=10)
SECTION_HEADER_STYLE = ParagraphStyle("CvSection", parent=_styles["Heading2"], fontSize=11.5, spaceBefore=12, spaceAfter=4, textColor=colors.HexColor("#111827"), fontName="Helvetica-Bold")
BODY_STYLE = ParagraphStyle("CvBody", parent=_styles["Normal"], fontSize=9.5, leading=13.5, textColor=colors.HexColor("#1f2937"))
ENTRY_TITLE_STYLE = ParagraphStyle("CvEntryTitle", parent=_styles["Normal"], fontSize=10, leading=13, fontName="Helvetica-Bold", textColor=colors.HexColor("#111827"))
ENTRY_META_STYLE = ParagraphStyle("CvEntryMeta", parent=_styles["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#6b7280"))
BULLET_STYLE = ParagraphStyle("CvBullet", parent=_styles["Normal"], fontSize=9.5, leading=13, textColor=colors.HexColor("#1f2937"))


def _section_header(title: str):
    return [
        Paragraph(title.upper(), SECTION_HEADER_STYLE),
        HRFlowable(width="100%", thickness=0.75, color=colors.HexColor("#d1d5db"), spaceAfter=6),
    ]


def _rank_by_keywords(items: list[str], matched_lower: set[str]) -> list[str]:
    def relevance(item: str) -> int:
        return 0 if any(kw in item.lower() for kw in matched_lower) else 1
    return sorted(items, key=relevance)


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
        topMargin=20 * mm, bottomMargin=18 * mm, leftMargin=20 * mm, rightMargin=20 * mm,
        title=f"{parsed.name or 'CV'} - ATS CV",
    )

    story = []

    story.append(Paragraph(parsed.name or "Your Name", NAME_STYLE))
    contact_bits = [c for c in [parsed.email, parsed.phone] if c]
    if contact_bits:
        story.append(Paragraph(" &nbsp;&middot;&nbsp; ".join(contact_bits), CONTACT_STYLE))
    story.append(HRFlowable(width="100%", thickness=1.2, color=colors.HexColor("#111827"), spaceAfter=10))

    # Summary — reuse an existing one if present, else synthesize a short,
    # templated line naming the target role and top matched skills.
    ordered_skills = _rank_by_keywords(parsed.skills, matched_lower) if parsed.skills else []
    top_skills = ordered_skills[:3]
    if parsed.summary:
        summary_text = parsed.summary
        if job_title:
            summary_text += f" Applying for the {job_title} role" + (f" at {company}." if company else ".")
    else:
        phrase = build_phrase_for_skills(top_skills)
        skill_clause = f" with hands-on experience in {', '.join(top_skills)}" if top_skills else ""
        role_clause = f" seeking to bring this expertise to the {job_title} role" if job_title else ""
        company_clause = f" at {company}" if (job_title and company) else ""
        summary_text = f"Motivated professional{skill_clause}. Proven ability to {phrase}{role_clause}{company_clause}."
    story += _section_header("Summary")
    story.append(Paragraph(summary_text, BODY_STYLE))

    if parsed.experience:
        story += _section_header("Experience")
        for entry in parsed.experience:
            title_line = entry.title or "Role"
            story.append(Paragraph(title_line, ENTRY_TITLE_STYLE))
            meta_bits = [b for b in [entry.company, entry.dates] if b]
            if meta_bits:
                story.append(Paragraph(" &nbsp;&middot;&nbsp; ".join(meta_bits), ENTRY_META_STYLE))
            if entry.bullets:
                ranked_bullets = _rank_by_keywords(entry.bullets, matched_lower)
                items = [ListItem(Paragraph(b, BULLET_STYLE), leftIndent=10) for b in ranked_bullets]
                story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=12, spaceBefore=2, spaceAfter=6))
            else:
                story.append(Spacer(1, 6))

    if ordered_skills:
        story += _section_header("Skills")
        story.append(Paragraph(" &nbsp;&bull;&nbsp; ".join(ordered_skills), BODY_STYLE))
        story.append(Spacer(1, 4))

    if parsed.education:
        story += _section_header("Education")
        for entry in parsed.education:
            story.append(Paragraph(entry.degree or entry.institution, ENTRY_TITLE_STYLE))
            meta_bits = [b for b in [entry.institution if entry.degree else "", entry.dates] if b]
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
            cleaned = para.strip().replace("\n", "<br/>")
            if cleaned:
                story.append(Paragraph(cleaned, BODY_STYLE))
                story.append(Spacer(1, 4))

    story.append(Spacer(1, 14))
    story.append(Paragraph("Generated by Annex Careers", ENTRY_META_STYLE))

    doc.build(story)
    return buf.getvalue()
