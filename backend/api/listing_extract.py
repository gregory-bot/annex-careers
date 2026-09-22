"""
Turn an uploaded poster image or TOR / contract document into text, then
into suggested listing fields (title, organisation, deadline, apply link...)
so the form can be pre-filled. Everything is a suggestion the person can
edit; nothing is published without them pressing the button.
"""
import re
import datetime
import logging
from typing import Optional

from api import ocr
from api.cv.extract import extract_text_from_upload, CvExtractionError
from airflow_home.transformers.cleaner import classify_kind

logger = logging.getLogger(__name__)

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
DOCUMENT_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
}
EXTENSION_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
}

ORG_HINTS = re.compile(
    r"\b(university|hospital|ltd|limited|plc|bank|group|company|institute|ministry|county|authority|"
    r"foundation|organi[sz]ation|agency|school|college|sacco|ngo|commission|board|centre|center|trust|"
    r"society|association|international|consulting|solutions|technologies|enterprises|holdings|kenya)\b",
    re.I,
)
ROLE_HINTS = re.compile(
    r"\b(officers?|managers?|directors?|engineers?|assistants?|interns?|analysts?|consultants?|specialists?|"
    r"coordinators?|nurses?|teachers?|drivers?|clerks?|accountants?|developers?|leads?|heads?|technicians?|"
    r"supervisors?|executives?|representatives?|agents?|attach(?:e|é)s?|trainees?|advisors?|auditors?|"
    r"secretar(?:y|ies)|receptionists?|cashiers?|porters?|waiters?|surveyors?|draughtsmen|architects?|"
    r"designers?|marketers?|pharmacists?|doctors?|lecturers?|tutors?|planners?|economists?|lawyers?|"
    r"volunteers?|fellows?|consultancy)\b",
    re.I,
)
NOISE_LINE = re.compile(
    r"^(we\s*'?\s*(are|re)\s*hiring!?|now\s*hiring!?|hiring!?|join\s+our\s+team!?|"
    r"job\s*(vacanc(y|ies)|alert|openings?|advert(isement)?s?)|vacanc(y|ies)|career\s*opportunit(y|ies)|"
    r"available\s*positions?|open\s*positions?|positions?\s*available|announcement|apply\s*now!?|"
    r"for\s+applications?\s+please\s+visit:?|how\s+to\s+apply:?|requirements?:?|qualifications?:?|"
    r"enquir(y|ies):?.*|tel:?.*|p\.?o\.?\s*box.*)$",
    re.I,
)
POSITION_LINE = re.compile(r"^\s*(?:\d{1,2}\s*[.):-]|[-•*▪●])\s*(.+?)\s*$")
DEADLINE_LINE = re.compile(r"(deadline|closing\s+date|closes\s+on|closes|apply\s+by|applications?\s+(?:close|due)|due\s+date|not\s+later\s+than)\s*[:\-]?\s*(.+)", re.I)
URL_RE = re.compile(r"(https?://[^\s<>\"')\]]+|www\.[^\s<>\"')\]]+)", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
KENYA_PLACES = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Machakos", "Kiambu", "Nyeri", "Kakamega", "Garissa", "Kitale", "Malindi", "Naivasha"]
DATE_FORMATS = ("%d %B %Y", "%d %b %Y", "%B %d %Y", "%b %d %Y", "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d")


def detect_content_type(filename: str, declared: Optional[str]) -> Optional[str]:
    declared = (declared or "").split(";")[0].strip().lower()
    if declared in IMAGE_TYPES or declared in DOCUMENT_TYPES:
        return declared
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    return EXTENSION_TYPES.get(ext)


def extract_text(filename: str, content_type: str, content: bytes) -> tuple[str, str]:
    """(text, kind) where kind is 'image' or 'document'. Extraction failures
    are logged and yield empty text; the file itself is still kept."""
    if content_type in IMAGE_TYPES:
        if not ocr.ocr_available():
            return "", "image"
        try:
            return ocr.extract_text_from_image(content), "image"
        except Exception as e:
            logger.warning(f"OCR failed for {filename}: {e}")
            return "", "image"
    ext = DOCUMENT_TYPES.get(content_type, "txt")
    try:
        return extract_text_from_upload(f"{filename}.{ext}" if not filename.lower().endswith(f".{ext}") else filename, content), "document"
    except CvExtractionError as e:
        logger.info(f"No text extracted from {filename}: {e}")
        return "", "document"
    except Exception as e:
        logger.warning(f"Document extraction failed for {filename}: {e}")
        return "", "document"


def _parse_date(text: str) -> Optional[str]:
    cleaned = re.sub(r"(\d{1,2})(st|nd|rd|th)\b", r"\1", text)
    cleaned = re.sub(r"[,]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .;:-")
    candidates = [cleaned] + re.findall(r"\d{1,2} [A-Za-z]{3,9} \d{4}|[A-Za-z]{3,9} \d{1,2} \d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}", cleaned)
    for candidate in candidates:
        for fmt in DATE_FORMATS:
            try:
                return datetime.datetime.strptime(candidate, fmt).date().isoformat()
            except ValueError:
                continue
    return None


def _tidy_case(text: str) -> str:
    """SHOUTING poster text -> Title Case, keeping bracketed acronyms."""
    if not text.isupper():
        return text
    words = []
    for word in text.split():
        core = word.strip("(),.&")
        if word.startswith("(") and core.isupper() and len(core) <= 7:
            words.append(word)  # (KUTRRH)
        else:
            words.append(word.capitalize())
    return " ".join(words)


def parse_listing_text(text: str) -> dict:
    """Suggested listing fields from poster / TOR text. Only confident
    findings are returned; the full text is always offered as description."""
    lines = [re.sub(r"\s+", " ", line).strip() for line in (text or "").splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return {}
    result: dict = {}

    urls = [u.rstrip(".,;)") for u in URL_RE.findall(text)]
    if urls:
        first = urls[0]
        result["apply_url"] = first if first.lower().startswith("http") else f"https://{first}"

    for line in lines:
        match = DEADLINE_LINE.search(line)
        if match:
            parsed = _parse_date(match.group(2)) or _parse_date(line)
            if parsed:
                result["application_deadline"] = parsed
                break

    # Organisation: an early line with organisation words and no role words.
    org = None
    for index, line in enumerate(lines[:8]):
        if NOISE_LINE.match(line) or URL_RE.search(line) or EMAIL_RE.search(line):
            continue
        if ORG_HINTS.search(line) and not ROLE_HINTS.search(line) and not POSITION_LINE.match(line):
            org = line
            nxt = lines[index + 1] if index + 1 < len(lines) else ""
            if nxt and (line.endswith(",") or nxt[:1] in "&(" or nxt.lower().startswith(("and ", "of ", "for "))) \
                    and not ROLE_HINTS.search(nxt) and not NOISE_LINE.match(nxt):
                org = f"{line} {nxt}"
            break
    if org:
        result["company"] = _tidy_case(org)

    positions = []
    for line in lines:
        match = POSITION_LINE.match(line)
        if match and ROLE_HINTS.search(match.group(1)) and len(match.group(1)) <= 80:
            positions.append(_tidy_case(match.group(1)))
    if len(positions) >= 2:
        result["title"] = f"{len(positions)} Open Positions" + (f" at {result['company']}" if result.get("company") else "")
        result["positions"] = positions
    elif len(positions) == 1:
        result["title"] = positions[0]
    else:
        org_lines = set(org.split(" ")) if org else set()
        for line in lines:
            if NOISE_LINE.match(line) or URL_RE.search(line) or EMAIL_RE.search(line) or DEADLINE_LINE.search(line):
                continue
            if org and (line in org or line == org):
                continue
            words = line.split()
            if 1 <= len(words) <= 10 and 4 <= len(line) <= 90 and ROLE_HINTS.search(line):
                result["title"] = _tidy_case(line.strip(" -:"))
                break
        if "title" not in result:
            for line in lines:
                if NOISE_LINE.match(line) or URL_RE.search(line) or EMAIL_RE.search(line) or DEADLINE_LINE.search(line):
                    continue
                if org and line in org:
                    continue
                words = line.split()
                if 2 <= len(words) <= 10 and 6 <= len(line) <= 90 and not line[-1] in ".:":
                    result["title"] = _tidy_case(line.strip(" -:"))
                    break

    for place in KENYA_PLACES:
        if re.search(rf"\b{place}\b", text, re.I):
            result["location"] = f"{place}, Kenya"
            break
    else:
        if re.search(r"\bkenya\b", text, re.I):
            result["location"] = "Kenya"

    lowered = text.lower()
    if re.search(r"\bintern(ship)?s?\b", lowered):
        result["job_type"] = "Internship"
    elif "attachment" in lowered and "attach" in lowered.split("deadline")[0]:
        result["job_type"] = "Attachment"
    elif re.search(r"part[- ]time", lowered):
        result["job_type"] = "Part-time"
    elif re.search(r"consultan|tender|terms of reference|\btor\b|request for proposal", lowered):
        result["job_type"] = "Consultancy"

    result["kind"] = classify_kind(result.get("title"), text, "job")
    if result["kind"] == "contract" and "job_type" not in result:
        result["job_type"] = "Consultancy"
    result["description"] = "\n".join(lines)
    return result
