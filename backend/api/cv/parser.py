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
  - Unconventional section headers get absorbed into the previous section.
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
DEGREE_KEYWORDS = (
    "bachelor", "bsc", "b.sc", "ba", "b.a", "msc", "m.sc", "mba", "phd",
    "diploma", "hnd", "certificate", "master", "associate degree",
)

SECTION_PATTERNS: dict[str, re.Pattern] = {
    "summary": re.compile(r"^(professional\s+)?(summary|profile|objective)s?\s*:?$", re.IGNORECASE),
    "experience": re.compile(
        r"^(work\s+)?(experience|employment(\s+history)?|career\s+history|professional\s+experience)s?\s*:?$",
        re.IGNORECASE,
    ),
    "education": re.compile(r"^(education|academic\s+qualifications?)\s*:?$", re.IGNORECASE),
    "skills": re.compile(r"^(skills|technical\s+skills|core\s+competenc(y|ies)|key\s+skills)\s*:?$", re.IGNORECASE),
    "certifications": re.compile(r"^certifications?\s*:?$", re.IGNORECASE),
    "projects": re.compile(r"^projects?\s*:?$", re.IGNORECASE),
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
    parts = re.split(r"[,\n|;]|(?<=\w)\s{2,}(?=\w)", joined)
    skills = []
    for part in parts:
        cleaned = part.strip("-• \t")
        if 2 <= len(cleaned) <= 40:
            skills.append(cleaned)
    return skills


def _is_entry_header(line: str) -> bool:
    stripped = line.strip()
    if not stripped or stripped.startswith("-"):
        return False
    if len(stripped) > 120:
        return False
    return bool(YEAR_RANGE_RE.search(stripped) or MONTH_YEAR_RANGE_RE.search(stripped))


def _parse_experience_block(block_lines: list[str]) -> list[ExperienceEntry]:
    entries: list[ExperienceEntry] = []
    current: ExperienceEntry | None = None
    for line in block_lines:
        stripped = line.strip()
        if not stripped:
            continue
        if _is_entry_header(stripped):
            if current:
                entries.append(current)
            date_match = YEAR_RANGE_RE.search(stripped) or MONTH_YEAR_RANGE_RE.search(stripped)
            dates = date_match.group(0) if date_match else ""
            header_text = stripped.replace(dates, "").strip(" -,|–—")
            parts = re.split(r",|\||–| at ", header_text, maxsplit=1)
            title = parts[0].strip()
            company = parts[1].strip() if len(parts) > 1 else ""
            current = ExperienceEntry(title=title or header_text, company=company, dates=dates)
        elif stripped.startswith("-"):
            if current:
                current.bullets.append(stripped.lstrip("- ").strip())
        elif current:
            current.bullets.append(stripped)
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


def parse_cv(raw_text: str) -> ParsedCV:
    lines = raw_text.split("\n")
    name, email, phone = _extract_contact(lines)

    sections: dict[str, list[str]] = {}
    current_section = "header"
    sections[current_section] = []
    for line in lines:
        header = _looks_like_header(line)
        if header:
            current_section = header
            sections.setdefault(current_section, [])
            continue
        sections.setdefault(current_section, []).append(line)

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
        summary=summary, raw_text=raw_text,
        parse_confidence=round(confidence * 100),
        low_confidence=confidence < 0.4,
    )
