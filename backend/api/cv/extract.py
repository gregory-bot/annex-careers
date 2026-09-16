"""
Server-side CV text extraction — replaces the old client-side flow where
Gemini's multimodal API read the uploaded file directly. Supports plain
text, DOCX, and PDF only (no images/legacy .doc — see module docstring in
main.py's /api/cv/analyze for the rationale).
"""
import re
from io import BytesIO

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB, matches the old client-side limit
MAX_TEXT_CHARS = 20_000  # defensive cap so a pathological file can't slow parsing


class CvExtractionError(Exception):
    """Raised when a CV file can't be read or has no usable text."""


def normalize_text(text: str) -> str:
    """Collapse repeated blank lines, normalize bullet characters, and cap length."""
    # Normalize common unicode bullets to a single "- " marker.
    text = re.sub(r"[•●▪◦‣∙]", "-", text)
    # Collapse 3+ blank lines down to 2 (one blank line between paragraphs).
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Strip trailing whitespace on each line.
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return text.strip()[:MAX_TEXT_CHARS]


def _extract_pdf_text(content: bytes) -> str:
    import pdfplumber

    pages_text = []
    with pdfplumber.open(BytesIO(content)) as pdf:
        for page in pdf.pages:
            words = page.extract_words() or []
            if _looks_two_column(words, page.width):
                pages_text.append(_extract_two_column(words))
            else:
                pages_text.append(page.extract_text() or "")
    return "\n".join(pages_text)


def _looks_two_column(words: list, page_width: float) -> bool:
    """Heuristic: a persistent vertical gap spanning most of the page's
    height, roughly down the middle, suggests a two-column layout. This is
    not a general solution — it helps common two-column templates and
    nothing more elaborate (magazine-style, sidebars, etc.)."""
    if not words or page_width <= 0:
        return False
    mid = page_width / 2
    near_mid = [w for w in words if abs(((w["x0"] + w["x1"]) / 2) - mid) < page_width * 0.03]
    # If very few words straddle the vertical midline relative to total
    # words, and there's a healthy spread on both sides, assume 2 columns.
    left = sum(1 for w in words if w["x1"] < mid)
    right = sum(1 for w in words if w["x0"] > mid)
    return len(near_mid) < len(words) * 0.05 and left > 5 and right > 5


def _extract_two_column(words: list) -> str:
    if not words:
        return ""
    xs = [w["x0"] for w in words]
    mid = (min(xs) + max(xs)) / 2
    left = sorted((w for w in words if w["x0"] < mid), key=lambda w: (round(w["top"]), w["x0"]))
    right = sorted((w for w in words if w["x0"] >= mid), key=lambda w: (round(w["top"]), w["x0"]))

    def to_lines(ws):
        lines, current_top, current = [], None, []
        for w in ws:
            top = round(w["top"], 0)
            if current_top is not None and abs(top - current_top) > 3:
                lines.append(" ".join(current))
                current = []
            current.append(w["text"])
            current_top = top
        if current:
            lines.append(" ".join(current))
        return lines

    return "\n".join(to_lines(left) + to_lines(right))


def _extract_docx_text(content: bytes) -> str:
    import docx

    doc = docx.Document(BytesIO(content))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def extract_text_from_upload(filename: str, content: bytes) -> str:
    """Dispatch on file extension and return normalized plain text.
    Raises CvExtractionError with a user-facing message on failure."""
    if len(content) > MAX_UPLOAD_BYTES:
        raise CvExtractionError("File is too large (max 10MB).")

    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()

    if ext == "txt":
        raw = content.decode("utf-8", errors="ignore")
    elif ext == "docx":
        try:
            raw = _extract_docx_text(content)
        except Exception as e:
            raise CvExtractionError(f"Could not read this .docx file: {e}")
    elif ext == "pdf":
        try:
            raw = _extract_pdf_text(content)
        except Exception as e:
            raise CvExtractionError(f"Could not read this PDF: {e}")
    elif ext == "doc":
        raise CvExtractionError(
            "Legacy .doc files aren't supported — please save as .docx or .pdf and re-upload."
        )
    else:
        raise CvExtractionError(
            "Unsupported file type — please upload a .pdf, .docx, or .txt file."
        )

    text = normalize_text(raw)
    if len(text) < 40:
        raise CvExtractionError(
            "No readable text found in this file — if it's a scanned/image-only PDF, "
            "please upload a text-based PDF or DOCX instead."
        )
    return text
