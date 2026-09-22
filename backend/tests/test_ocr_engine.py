"""
Real OCR engine check (slow on first run while the model loads). Renders a
poster-like image, reads it back, and parses the fields.

    cd backend && .venv312/bin/python -m unittest tests.test_ocr_engine
"""
import io
import unittest

from api import ocr
from api.listing_extract import parse_listing_text


@unittest.skipUnless(ocr.ocr_available(), "OCR engine not installed")
class OcrEngineTests(unittest.TestCase):
    def test_reads_a_rendered_poster(self):
        from PIL import Image, ImageDraw, ImageFont
        img = Image.new("RGB", (1000, 720), "white")
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34)
        except Exception:
            font = ImageFont.load_default()
        y = 30
        for line in ["Nairobi Water Company", "We are hiring", "1. Credit Control Officers", "2. Laundry Porter",
                     "Deadline: 7th July 2026", "https://example.co.ke/careers/"]:
            draw.text((40, y), line, fill="black", font=font)
            y += 70
        buf = io.BytesIO()
        img.save(buf, format="PNG")

        text = ocr.extract_text_from_image(buf.getvalue())
        self.assertIn("Credit Control Officers", text)
        self.assertIn("Deadline", text)
        fields = parse_listing_text(text)
        self.assertEqual(fields["application_deadline"], "2026-07-07")
        self.assertEqual(fields["apply_url"], "https://example.co.ke/careers/")
        self.assertEqual(fields["positions"], ["Credit Control Officers", "Laundry Porter"])
        self.assertEqual(fields["location"], "Nairobi, Kenya")


if __name__ == "__main__":
    unittest.main()
