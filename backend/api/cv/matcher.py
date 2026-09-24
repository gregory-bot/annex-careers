"""
Deterministic CV-vs-job keyword matching and scoring.

Explicitly NOT a trained model, and not TF-IDF/cosine similarity either:
job/CV keyword sets here are small (a job's requirements distill to maybe
15-50 terms, a CV's skills to 10-60), and the actual product need — an
explicit "here's what you're missing" list — falls directly out of a set
difference. An opaque similarity score wouldn't give us that for free.

Scoring is templated, not LLM-generated prose: phrasing will repeat across
users/jobs whenever the same condition fires. That repetition is the
direct, accepted cost of removing the AI dependency that was exhausting
API credits.
"""
import re
from dataclasses import dataclass, field

from api.cv.taxonomy import ALL_SKILLS, PROPER_NOUN_STOPWORDS
from api.cv.parser import ParsedCV

PROPER_NOUN_RE = re.compile(r"\b[A-Z][A-Za-z0-9+.#/-]{1,20}\b")


@dataclass
class AnalysisResult:
    score: int
    matched_skills: list[str] = field(default_factory=list)
    missing_skills: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    summary: str = ""
    candidate_name: str | None = None
    candidate_email: str | None = None
    parse_confidence: float = 0.0
    low_confidence: bool = False


def extract_job_keywords(job_text: str) -> set[str]:
    """Mine required skills/keywords from a job's description/requirements/tags."""
    lower = job_text.lower()
    keywords = {skill for skill in ALL_SKILLS if re.search(r"\b" + re.escape(skill) + r"\b", lower)}

    for match in PROPER_NOUN_RE.finditer(job_text):
        # "AWS/GCP/Microsoft" is three tools, not one keyword a CV could ever
        # contain verbatim; judge each part on its own.
        for token in match.group(0).strip("./-").split("/"):
            if token.lower() in PROPER_NOUN_STOPWORDS or len(token) < 3 or "." in token:
                continue  # "." also drops abbreviations like "U.S"
            # Only keep tokens that look like a tool/product name (has a digit,
            # an internal capital, or is short and all-caps like "SQL"/"AWS")
            # to avoid pulling in ordinary capitalized sentence-starters.
            if token.isupper() or re.search(r"[A-Z].*[A-Z]", token) or any(c.isdigit() for c in token):
                keywords.add(token.lower())

    return keywords


def _structure_score(parsed: ParsedCV) -> int:
    has_experience = len(parsed.experience) > 0
    has_skills = len(parsed.skills) >= 3
    if has_experience and has_skills:
        return 100
    if has_experience or has_skills:
        return 60
    return 30


PHRASE_BANK = {
    "programming": "build and ship reliable software",
    "frameworks_libraries": "develop modern, maintainable applications",
    "data_ml": "turn data into actionable insights",
    "databases": "design and manage robust data systems",
    "cloud_devops": "deploy and scale infrastructure reliably",
    "design": "craft intuitive, user-centered experiences",
    "marketing": "grow brand reach and engagement",
    "finance_accounting": "manage financial operations with precision",
    "sales_business": "drive revenue and build client relationships",
    "hr_admin": "support people operations effectively",
    "project_management": "deliver projects on time and on scope",
    "customer_support": "resolve customer issues with care",
    "soft_skills": "collaborate effectively across teams",
    "default": "deliver results in fast-paced environments",
}


def analyze(parsed: ParsedCV, job_keywords: set[str] | None, job_title: str = "", company: str = "") -> AnalysisResult:
    cv_text_lower = parsed.raw_text.lower()
    cv_skills_lower = {s.lower() for s in parsed.skills}

    if job_keywords:
        matched = set()
        for kw in job_keywords:
            if kw in cv_skills_lower or re.search(r"\b" + re.escape(kw) + r"\b", cv_text_lower):
                matched.add(kw)
        missing = job_keywords - matched
        keyword_score = 100 if not job_keywords else round(100 * len(matched) / len(job_keywords))
    else:
        # No job selected — "general CV review" against the whole taxonomy:
        # score reflects breadth/structure rather than fit to one role.
        matched = cv_skills_lower
        missing = set()
        keyword_score = min(100, round(len(matched) * 8))

    structure_score = _structure_score(parsed)
    final_score = max(0, min(100, round(0.8 * keyword_score + 0.2 * structure_score)))

    strengths = []
    if matched:
        top_matched = sorted(matched)[:6]
        strengths.append(f"Your CV already covers {len(matched)} of the skills this role asks for: {', '.join(top_matched)}.")
    if len(parsed.experience) > 0:
        strengths.append(f"You've listed {len(parsed.experience)} work experience {'entry' if len(parsed.experience) == 1 else 'entries'}, which gives concrete evidence of your background.")
    if any(any(ch.isdigit() for ch in b) for e in parsed.experience for b in e.bullets):
        strengths.append("Some of your bullet points include numbers. Quantified achievements stand out to both recruiters and ATS systems.")
    if not strengths:
        strengths.append("Your CV was received and processed. Add more detail to your Skills and Experience sections to strengthen this analysis.")

    gaps = []
    for skill in sorted(missing)[:8]:
        gaps.append(f"No mention of \"{skill}\": this job asks for it but it wasn't found anywhere in your CV.")
    if not parsed.experience:
        gaps.append("No work experience section was detected. Make sure it's clearly labeled (e.g. \"Experience\").")
    if len(parsed.skills) < 3:
        gaps.append("Fewer than 3 skills were detected. Consider adding a dedicated Skills section.")

    recommendations = []
    if missing:
        recommendations.append(f"If you have experience with {', '.join(sorted(missing)[:5])}, add it explicitly. ATS systems and recruiters scan for exact keyword matches.")
    if not any(any(ch.isdigit() for ch in b) for e in parsed.experience for b in e.bullets):
        recommendations.append("Add quantifiable outcomes to your experience bullets (e.g. \"increased sales by 20%\", \"managed a team of 5\").")
    if not parsed.summary:
        recommendations.append("Add a short professional summary at the top of your CV tailored to the role you're applying for.")
    if parsed.low_confidence:
        recommendations.append("Your CV's structure was hard to parse automatically. Using clear section headers (SUMMARY, EXPERIENCE, EDUCATION, SKILLS) will help both this tool and real ATS software read it correctly.")
    if not recommendations:
        recommendations.append("Your CV is well-structured. Keep it updated with your most recent achievements.")

    summary_bits = [f"Match score: {final_score}/100."]
    if job_title:
        summary_bits.append(f"Compared against: {job_title}{f' at {company}' if company else ''}.")
    summary = " ".join(summary_bits)

    return AnalysisResult(
        score=final_score,
        matched_skills=sorted(matched),
        missing_skills=sorted(missing),
        strengths=strengths,
        gaps=gaps,
        recommendations=recommendations,
        summary=summary,
        candidate_name=parsed.name,
        candidate_email=parsed.email,
        parse_confidence=parsed.parse_confidence,
        low_confidence=parsed.low_confidence,
    )


def build_phrase_for_skills(skills: list[str]) -> str:
    """Pick a category-appropriate phrase for the top matched skill, for the
    templated professional-summary generator in pdf_builder.py."""
    for skill in skills:
        category = ALL_SKILLS.get(skill.lower())
        if category and category in PHRASE_BANK:
            return PHRASE_BANK[category]
    return PHRASE_BANK["default"]


# Generic, role-agnostic signals of transferable capability — independent of
# any one job's technical keyword list. Used only to reorder a candidate's
# own real bullets/skills toward the top when they're relevant across roles
# (e.g. a career switcher's "collaborated with stakeholders" bullet), never
# to add or rewrite a claim they didn't already write themselves.
TRANSFERABLE_SIGNAL_RE = re.compile(
    r"\b("
    r"collaborat\w*|cross-functional|cross functional|stakeholder\w*|"
    r"communicat\w*|presented|presentation\w*|mentor\w*|coach\w*|"
    r"leadership|led|coordinat\w*|problem[- ]solv\w*|"
    r"user research|user feedback|customer feedback|client\w*|"
    r"research\w*|iterat\w*|usability|requirement\w*|document\w*|"
    r"planning|organi[sz]\w*|prioriti[sz]\w*|"
    r"attention to detail|process improvement|"
    r"negotiat\w*|facilitat\w*"
    r")\b",
    re.IGNORECASE,
)


def has_transferable_signal(text: str) -> bool:
    """True if text shows a generic transferable-skill signal (collaboration,
    stakeholder work, research, etc.), independent of any specific job."""
    return bool(TRANSFERABLE_SIGNAL_RE.search(text))
