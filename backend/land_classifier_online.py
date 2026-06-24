import requests
import cv2
import numpy as np

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
    import os

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise EnvironmentError(
            "لم يتم العثور على متغير البيئة HF_TOKEN. اعداد HF_TOKEN قبل تشغيل هذا الملف."
        )

    classifier = LandColorClassifierOnline(token)
    classifier.test_token()
