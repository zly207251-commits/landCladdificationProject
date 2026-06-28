import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_system.memory import SharedMemory


def test_shared_memory_resolves_relative_paths(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    memory = SharedMemory(db_path="nested/shared_memory.db")

    assert os.path.isabs(memory.db_path)
    assert Path(memory.db_path).resolve() == (tmp_path / "nested" / "shared_memory.db").resolve()
