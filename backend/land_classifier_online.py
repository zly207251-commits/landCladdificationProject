import os
from pathlib import Path

import requests
import cv2
import numpy as np


def load_local_dotenv(dotenv_path: Path | str | None = None) -> None:
    path = Path(dotenv_path or Path(__file__).with_name('.env'))
    if not path.exists():
        return

    for line in path.read_text(encoding='utf-8').splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or '=' not in stripped:
            continue

        key, value = stripped.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


class LandColorClassifierOnline:
    def __init__(self, hf_token):
        self.api_url = "https://api-inference.huggingface.co/models/facebook/segment-anything"
        self.headers = {"Authorization": f"Bearer {hf_token}"}

    def test_token(self):
        """وظيفة لاختبار التوكن فقط"""
        try:
            response = requests.get(self.api_url, headers=self.headers)
            if response.status_code == 200:
                print("✅ الاتصال ناجح! التوكن صالح.")
            else:
                print(f"⚠️ الاتصال لم ينجح، رمز الحالة: {response.status_code}")
                print(response.text)
        except requests.exceptions.RequestException as e:
            print(f"❌ خطأ أثناء الاتصال: {e}")

# اختبار التوكن الجديد
if __name__ == "__main__":
    load_local_dotenv()
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise EnvironmentError(
            "لم يتم العثور على متغير البيئة HF_TOKEN. اعداد HF_TOKEN قبل تشغيل هذا الملف."
        )

    classifier = LandColorClassifierOnline(token)
    classifier.test_token()
