import io
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api as api_module


def test_upload_returns_500_when_task_record_creation_fails(monkeypatch):
    monkeypatch.setattr(api_module.memory, "create_task", lambda *args, **kwargs: False)

    client = TestClient(api_module.app)
    response = client.post(
        "/tasks/analyze",
        files={"file": ("img.png", io.BytesIO(b"fake-image"), "image/png")},
        data={"image_type": "regular"},
    )

    assert response.status_code == 500
    assert "تعذر حفظ سجل المهمة" in response.json()["detail"]
