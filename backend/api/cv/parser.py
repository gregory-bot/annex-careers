"""
Rule-based CV -> structured profile parser.

No ML, no training — pattern-matching heuristics over section headers,
date ranges, and known skill terms. This is the hardest, most
failure-prone part of the CV engine, so it's built to degrade gracefully:
when confidence is low, the original text is always kept verbatim
(`raw_text`) rather than silently dropping content the heuristics
couldn't structure.

Known limitations (by design, not oversight):
  - English/Latin-script CVs only — section-header regexes are English.
  - Heavily graphic/Canva-style CVs with little running text parse poorly.
  - Unrecognised section headers are kept verbatim under their own heading
    (`extra_sections`) rather than being structured.
  - Title vs. company ordering on an experience line is a best guess.
"""
import re
from dataclasses import dataclass, field

from api.cv.taxonomy import ALL_SKILLS

EMAIL_RE = re.compile(r"[\w.\-+]+@[\w.\-]+\.\w+")
PHONE_RE = re.compile(r"(\+?\d[\d\-\s()]{7,14}\d)")
YEAR_RANGE_RE = re.compile(
    r"(19|20)\d{2}\s*(-|–|—|to)\s*((19|20)\d{2}|present|current|now)",
    re.IGNORECASE,
)
MONTH_YEAR_RANGE_RE = re.compile(
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}",
    re.IGNORECASE,
)
PRESENT_RE = re.compile(r"\b(present|current|now)\b", re.IGNORECASE)
DATE_RANGE_RE = re.compile(
    r"(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?"
    r"(?:19|20)\d{2}\s*(?:-|–|—|to)\s*"
    r"(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?"
    r"(?:(?:19|20)\d{2}|present|current|now)",
    re.IGNORECASE,
)
DEGREE_KEYWORDS = (
    "bachelor", "bsc", "b.sc", "ba", "b.a", "msc", "m.sc", "mba", "phd",
    "diploma", "hnd", "certificate", "master", "associate degree",
)

SECTION_PATTERNS: dict[str, re.Pattern] = {
    "summary": re.compile(
        r"^((professional|career|personal|executive)\s+)?(summary|profile|objective|statement)s?\s*:?$|^about\s+me\s*:?$",
        re.IGNORECASE,
    ),
    # "Relevant Experience" is also the heading our own generated CV uses, so
    # re-uploading a generated CV must still find the jobs.
    "experience": re.compile(
        r"^((work|relevant|professional|employment|career|industry|related)\s+)?"
        r"(experience|employment(\s+history)?|history|work\s+history)s?\s*:?$",
        re.IGNORECASE,
    ),
    "education": re.compile(
        r"^(education(al)?(\s+(background|history|&\s+training|and\s+training))?|academic\s+(qualifications?|background|history)|qualifications)\s*:?$",
        re.IGNORECASE,
    ),
    "skills": re.compile(
        r"^((technical|core|key|professional|relevant|hard|soft)\s+)?(skills|competenc(y|ies))(\s*(&|and)\s*(tools|technologies|expertise|competencies))?\s*:?$"
        r"|^(tools|technologies)(\s*(&|and)\s*(tools|technologies))?\s*:?$",
        re.IGNORECASE,
    ),
    "certifications": re.compile(
        r"^((licen[cs]es|awards)\s*(&|and)\s*)?(certifications?|certificates?)(\s*(&|and)\s*(licen[cs]es|training|courses))?\s*:?$",
        re.IGNORECASE,
    ),
    "projects": re.compile(r"^((key|selected|personal|academic)\s+)?projects?\s*:?$", re.IGNORECASE),
}


@dataclass
class ExperienceEntry:
    title: str
    company: str = ""
    dates: str = ""
    bullets: list[str] = field(default_factory=list)


@dataclass
class EducationEntry:
    institution: str
    degree: str = ""
    dates: str = ""


@dataclass
class ParsedCV:
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    skills: list[str] = field(default_factory=list)
    experience: list[ExperienceEntry] = field(default_factory=list)
    education: list[EducationEntry] = field(default_factory=list)
    summary: str | None = None
    certifications: list[str] = field(default_factory=list)
    projects: list[str] = field(default_factory=list)
    # Sections with headings we don't structure (Languages, Awards, Referees...),
    # kept verbatim as (heading, lines) so nothing the candidate wrote is lost.
    extra_sections: list[tuple[str, list[str]]] = field(default_factory=list)
    raw_text: str = ""
    parse_confidence: float = 0.0
    low_confidence: bool = True


def _looks_like_header(line: str) -> str | None:
    stripped = line.strip().rstrip(":").strip()
    if not stripped:
        return None
    for section, pattern in SECTION_PATTERNS.items():
        if pattern.match(stripped):
            return section
    # Fallback: short, ALL-CAPS, non-bullet lines are probably headers even
    # if they don't match a known synonym (absorbed into "other" below).
    if (
        len(stripped) <= 40
        and stripped.isupper()
        and not stripped.startswith("-")
        and len(stripped.split()) <= 4
    ):
        return "other"
    return None


def _extract_contact(lines: list[str]) -> tuple[str | None, str | None, str | None]:
    header_block = "\n".join(lines[:15])
    email_match = EMAIL_RE.search(header_block)
    email = email_match.group(0) if email_match else None

    phone = None
    for m in PHONE_RE.finditer(header_block):
        digits = re.sub(r"\D", "", m.group(0))
        if 9 <= len(digits) <= 15:
            phone = m.group(0).strip()
            break

    name = None
    for line in lines[:5]:
        candidate = line.strip()
        if not candidate:
            continue
        if EMAIL_RE.search(candidate) or PHONE_RE.search(candidate):
            continue
        if re.match(r"^(curriculum\s+vitae|resume|cv)$", candidate, re.IGNORECASE):
            continue
        if len(candidate.split()) <= 6 and not any(ch.isdigit() for ch in candidate):
            name = candidate
            break
    return name, email, phone


def _mine_skills(text: str) -> list[str]:
    lower = text.lower()
    found = []
    for skill in ALL_SKILLS:
        pattern = r"\b" + re.escape(skill) + r"\b"
        if re.search(pattern, lower):
            found.append(skill)
    return found


def _split_skills_section(block_lines: list[str]) -> list[str]:
    joined = " ".join(block_lines)
    # "Python (pandas, NumPy)" is one skill: hide separators inside brackets
    # from the split below, then restore them.
    depth, chars = 0, []
    for i, ch in enumerate(joined):
        depth = max(0, depth + (ch in "([") - (ch in ")]"))
        spaced_dash = ch in "-–" and joined[i - 1:i] == " " and joined[i + 1:i + 2] == " "
        chars.append("\0" if depth > 0 and (ch in ",;|•·" or spaced_dash) else ch)
    joined = "".join(chars)
    # Separators: commas, pipes, semicolons, bullets/middots (a PDF's "•"
    # often extracts as " - "), and runs of spaces.
    parts = re.split(r"[,\n|;•·]|\s[-–]\s|(?<=\w)\s{2,}(?=\w)", joined)
    skills = []
    for part in parts:
        cleaned = part.strip("-• \t").replace(" \0 ", ", ").replace("\0", ",").strip()
        if cleaned.count("(") != cleaned.count(")"):
            cleaned = cleaned.replace("(", "").replace(")", "").strip()
        if 2 <= len(cleaned) <= 60:
            skills.append(cleaned)
    return skills


def _is_entry_header(line: str) -> bool:
    stripped = line.strip()
    if not stripped or stripped.startswith("-"):
        return False
    if len(stripped) > 120:
        return False
    return bool(
        DATE_RANGE_RE.search(stripped)
        or YEAR_RANGE_RE.search(stripped)
        or MONTH_YEAR_RANGE_RE.search(stripped)
        or PRESENT_RE.search(stripped)
    )


def _split_title_company(text: str) -> tuple[str, str]:
    parts = re.split(r",|\||\s+-\s+|–|—| at ", text, maxsplit=1)
    title = parts[0].strip(" ,|–—·")
    company = parts[1].strip(" ,|–—·") if len(parts) > 1 else ""
    return title, company


def _is_title_line(line: str) -> bool:
    """A 'Data Engineer — Acme' line sitting directly above its own
    'Nairobi · Jan 2022 – Present' line: capitalised, short, not a bullet and
    not the tail of a sentence."""
    return bool(
        line
        and not line.startswith(("-", "•"))
        and re.match(r"[A-Z]", line)
        and not re.search(r"[.,;:]$", line)
        and len(line.split()) <= 12
        and not _is_entry_header(line)
    )


def _parse_experience_block(block_lines: list[str]) -> list[ExperienceEntry]:
    entries: list[ExperienceEntry] = []
    current: ExperienceEntry | None = None
    pending_bullet = False
    previous_plain: str | None = None  # last non-bullet line, if it may be a title
    for line in block_lines:
        stripped = line.strip()
        if not stripped:
            continue
        if _is_entry_header(stripped):
            date_match = (
                DATE_RANGE_RE.search(stripped)
                or YEAR_RANGE_RE.search(stripped)
                or MONTH_YEAR_RANGE_RE.search(stripped)
                or PRESENT_RE.search(stripped)
            )
            dates = date_match.group(0) if date_match else ""
            header_text = stripped.replace(dates, "").strip(" -,|–—·")
            title_line = None
            # Only a short remainder (a location like "Nairobi" or
            # "Acme, Nairobi (Contract)") means the title is on the line above.
            if previous_plain and len(header_text.split()) <= 5:
                title_line = previous_plain
                # That title line was provisionally stored as a bullet (or as a
                # bulletless entry); take it back.
                if current and current.bullets and current.bullets[-1] == previous_plain:
                    current.bullets.pop()
                elif current and not current.bullets and current.title == previous_plain:
                    current = None
            if current:
                entries.append(current)
            if title_line:
                title, company = _split_title_company(title_line)
                location = header_text.strip(" ,|–—·")
                company = " · ".join(b for b in [company, location] if b)
            else:
                title, company = _split_title_company(header_text)
            current = ExperienceEntry(title=title or header_text, company=company, dates=dates)
            previous_plain = None
            pending_bullet = False
            continue
        previous_plain = stripped if _is_title_line(stripped) else None
        if stripped.startswith("-"):
            pending_bullet = not stripped.lstrip("- ").strip()
            bullet = stripped.lstrip("- ").strip()
            if current and bullet:
                current.bullets.append(bullet)
        elif current:
            starts_new_sentence = bool(current.bullets and re.match(r"[A-Z0-9]", stripped))
            previous_is_complete = bool(current.bullets and re.search(r"[.!?:;]$", current.bullets[-1]))
            if pending_bullet or not current.bullets or (starts_new_sentence and previous_is_complete):
                current.bullets.append(stripped)
            else:
                current.bullets[-1] = f"{current.bullets[-1]} {stripped}".strip()
            pending_bullet = False
        else:
            # Content before any recognized entry header — keep as a
            # bulletless entry rather than silently dropping it.
            current = ExperienceEntry(title=stripped)
    if current:
        entries.append(current)
    return entries


def _parse_education_block(block_lines: list[str]) -> list[EducationEntry]:
    entries: list[EducationEntry] = []
    current: EducationEntry | None = None
    for line in block_lines:
        stripped = line.strip()
        if not stripped:
            continue
        has_degree = any(kw in stripped.lower() for kw in DEGREE_KEYWORDS)
        has_year = YEAR_RANGE_RE.search(stripped) or re.search(r"(19|20)\d{2}", stripped)
        if has_degree or has_year:
            if current:
                entries.append(current)
            date_match = YEAR_RANGE_RE.search(stripped) or re.search(r"(19|20)\d{2}", stripped)
            dates = date_match.group(0) if date_match else ""
            remainder = stripped.replace(dates, "").strip(" -,|–—")
            parts = re.split(r",|\||–", remainder, maxsplit=1)
            first = parts[0].strip()
            second = parts[1].strip() if len(parts) > 1 else ""
            if has_degree:
                current = EducationEntry(institution=second or "", degree=first, dates=dates)
            else:
                current = EducationEntry(institution=first, degree=second, dates=dates)
        elif current:
            # Extra descriptive line under the same entry.
            if not current.degree:
                current.degree = stripped
        else:
            current = EducationEntry(institution=stripped)
    if current:
        entries.append(current)
    return entries


def _block_items(block_lines: list[str]) -> list[str]:
    """Certifications/projects as items: each bullet or unwrapped line starts
    an item; a lowercase continuation line joins the one before it."""
    items: list[str] = []
    for line in block_lines:
        stripped = line.strip()
        if not stripped:
            continue
        is_bullet = stripped.startswith(("-", "•", "*"))
        text = stripped.lstrip("-•* ").strip()
        if not text:
            continue
        if items and not is_bullet and re.match(r"[a-z(]", text):
            items[-1] = f"{items[-1]} {text}"
        else:
            items.append(text)
    return items


def parse_cv(raw_text: str) -> ParsedCV:
    # Our own generated CVs end with this footer; re-uploading one must not
    # turn it into a "skill".
    raw_text = re.sub(r"\s*Generated by Annex Careers\s*", "\n", raw_text)
    lines = raw_text.split("\n")
    name, email, phone = _extract_contact(lines)

    sections: dict[str, list[str]] = {}
    extra_sections: list[tuple[str, list[str]]] = []
    current_section = "header"
    sections[current_section] = []
    for line in lines:
        # The name line is often ALL CAPS, which the header fallback would
        # otherwise read as the start of an unknown section.
        header = None if (name and line.strip() == name) else _looks_like_header(line)
        if header == "other":
            extra_sections.append((line.strip().rstrip(":").strip(), []))
            current_section = f"other:{len(extra_sections) - 1}"
            continue
        if header:
            current_section = header
            sections.setdefault(current_section, [])
            continue
        if current_section.startswith("other:"):
            extra_sections[int(current_section.split(":")[1])][1].append(line)
            continue
        sections.setdefault(current_section, []).append(line)
    extra_sections = [
        (heading, [l.strip() for l in body if l.strip()])
        for heading, body in extra_sections
        if any(l.strip() for l in body)
    ]

    skills = []
    if "skills" in sections:
        skills.extend(_split_skills_section(sections["skills"]))
    # Safety net: scan the whole document too, regardless of whether a
    # dedicated Skills section was found — catches inline-mentioned skills.
    for skill in _mine_skills(raw_text):
        if skill not in [s.lower() for s in skills]:
            skills.append(skill)

    experience = _parse_experience_block(sections.get("experience", []))
    education = _parse_education_block(sections.get("education", []))
    certifications = _block_items(sections.get("certifications", []))
    projects = _block_items(sections.get("projects", []))

    summary = None
    if "summary" in sections and any(l.strip() for l in sections["summary"]):
        summary = " ".join(l.strip() for l in sections["summary"] if l.strip())
    else:
        header_block = "\n".join(sections.get("header", []))
        leftover = header_block
        if name:
            leftover = leftover.replace(name, "")
        if email:
            leftover = leftover.replace(email, "")
        if phone:
            leftover = leftover.replace(phone, "")
        leftover = leftover.strip()
        if len(leftover) > 40:
            summary = re.sub(r"\s+", " ", leftover)

    signals = [
        bool(name), bool(email), len(experience) > 0, len(education) > 0, len(skills) >= 3,
    ]
    confidence = sum(signals) / len(signals)

    return ParsedCV(
        name=name, email=email, phone=phone,
        skills=skills, experience=experience, education=education,
        summary=summary, certifications=certifications, projects=projects,
        extra_sections=extra_sections, raw_text=raw_text,
        parse_confidence=round(confidence * 100),
        low_confidence=confidence < 0.4,
    )
