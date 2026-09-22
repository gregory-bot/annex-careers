"""
Image text extraction (OCR) for uploaded job posters, via RapidOCR: a
pure-pip ONNX engine, so it runs inside the Docker image without system
packages. The engine is loaded once (slow) and reused; load it in the
background at startup so the first upload is not the one that pays.
"""
import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

_engine = None
_lock = threading.Lock()
_load_error: Optional[str] = None
MIN_CONFIDENCE = 0.5


def ocr_available() -> bool:
    try:
        import rapidocr_onnxruntime  # noqa: F401
        return True
    except ImportError:
        return False


def _get_engine():
    global _engine, _load_error
    if _engine is None:
        with _lock:
            if _engine is None:
                from rapidocr_onnxruntime import RapidOCR
                try:
                    _engine = RapidOCR()
                except Exception as e:
                    _load_error = str(e)
                    raise
    return _engine


def warm_up_in_background() -> None:
    if not ocr_available():
        logger.info("OCR engine not installed; poster text extraction disabled")
        return

    def _run():
        try:
            _get_engine()
            logger.info("OCR engine ready")
        except Exception as e:
            logger.warning(f"OCR engine failed to load: {e}")

    threading.Thread(target=_run, name="ocr-warmup", daemon=True).start()


def extract_text_from_image(content: bytes) -> str:
    """Recognised text, one visual line per output line, top to bottom."""
    import numpy as np
    import cv2

    image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode the image")
    height, width = image.shape[:2]
    if max(height, width) < 1000:  # small posters recognise better upscaled
        scale = 1000 / max(height, width)
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        height, width = image.shape[:2]

    result, _ = _get_engine()(image)
    if not result:
        return ""

    items = []
    for box, text, confidence in result:
        if float(confidence) < MIN_CONFIDENCE or not str(text).strip():
            continue
        top = min(point[1] for point in box)
        left = min(point[0] for point in box)
        items.append((top, left, str(text).strip()))
    items.sort()

    # Boxes whose tops are within ~1.2% of the image height sit on one line.
    tolerance = max(10.0, height * 0.012)
    lines, current, current_top = [], [], None
    for top, left, text in items:
        if current_top is None or abs(top - current_top) > tolerance:
            if current:
                lines.append(" ".join(t for _, t in sorted(current)))
            current, current_top = [(left, text)], top
        else:
            current.append((left, text))
    if current:
        lines.append(" ".join(t for _, t in sorted(current)))
    return "\n".join(lines)
