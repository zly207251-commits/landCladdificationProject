import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api import _extract_google_drive_download_url


def test_extract_google_drive_download_url_from_single_quoted_href():
    html = """
    <html><body>
        <a href='https://drive.google.com/uc?export=download&id=abc123'>Download</a>
    </body></html>
    """

    result = _extract_google_drive_download_url(html, "https://drive.google.com/open?id=abc123")

    assert result == "https://drive.google.com/uc?export=download&id=abc123"
