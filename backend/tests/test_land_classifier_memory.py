import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from land_classifier import LandSegmenterSAM


def test_initializer_defers_model_loading(monkeypatch):
    calls = []

    def fail_if_called(self, *args, **kwargs):
        calls.append("called")
        raise AssertionError("model should not load during initialization")

    monkeypatch.setattr(LandSegmenterSAM, "_load_sam_model", fail_if_called)
    monkeypatch.setattr(LandSegmenterSAM, "_load_segformer_model", fail_if_called)

    segmenter = LandSegmenterSAM(fail_fast=False)

    assert segmenter.sam is None
    assert segmenter.semantic_segmenter is None
    assert calls == []
