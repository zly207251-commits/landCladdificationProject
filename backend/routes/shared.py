import os
import threading
from threading import Thread
import traceback as tb

from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.graph import create_swarm_graph
from land_classifier import LandSegmenterSAM
from storage_paths import resolve_storage_path, resolve_storage_dir

import importlib.util
rasterio_spec = importlib.util.find_spec('rasterio')
if rasterio_spec is not None:
    rasterio = importlib.import_module('rasterio')
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
else:
    rasterio = None
    transform_bounds = None
    from_bounds = None

# تهيئة قاعدة بيانات الذاكرة المشتركة وباص الرسائل
BASE_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
DB_PATH = resolve_storage_path(BASE_DIR, "BACKEND_DB_PATH", "shared_memory.db")
UPLOAD_DIR = resolve_storage_dir(BASE_DIR, "BACKEND_UPLOAD_DIR", "temp_uploads")
CHUNK_UPLOAD_DIR = resolve_storage_dir(BASE_DIR, "BACKEND_CHUNK_UPLOAD_DIR", os.path.join("temp_uploads", "chunks"))

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(CHUNK_UPLOAD_DIR, exist_ok=True)

memory = SharedMemory(db_path=DB_PATH)
message_bus = MessageBus(memory)

_segmenter: LandSegmenterSAM | None = None
_segmenter_lock = threading.Lock()
_segmenter_ready = threading.Event()

def _load_segmenter_background():
    global _segmenter
    try:
        seg = LandSegmenterSAM()
        with _segmenter_lock:
            _segmenter = seg
        _segmenter_ready.set()
        print("Segmenter loaded in background and ready")
    except Exception as e:
        print(f"Failed loading segmenter in background: {str(e)}")

# Startup background loader thread
t = threading.Thread(target=_load_segmenter_background, daemon=True)
t.start()

def get_segmenter() -> LandSegmenterSAM:
    global _segmenter
    if _segmenter is None:
        _segmenter = LandSegmenterSAM()
    return _segmenter

def ensure_segmenter(timeout: float = 60.0):
    global _segmenter
    if _segmenter_ready.is_set():
        return _segmenter
    waited = _segmenter_ready.wait(timeout=timeout)
    if waited and _segmenter is not None:
        return _segmenter
    try:
        with _segmenter_lock:
            if _segmenter is None:
                _segmenter = LandSegmenterSAM()
                _segmenter_ready.set()
    except Exception as e:
        print(f"⚠️ Failed synchronous segmenter load fallback: {e}")
    return _segmenter

def remove_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f"Error removing temporary file {path}: {e}")

def run_agent_swarm_background(task_id: str, image_path: str):
    print(f"[backend] starting background processing for {task_id} in {DB_PATH}")
    existing_task = memory.get_task(task_id)
    try:
        existing_meta = existing_task.get("metadata") or {} if existing_task else {}
        merged_meta = {**existing_meta, "source": "background_worker"}
        existing_hash = existing_task.get("image_hash") if existing_task else None
        memory.ensure_task_record(task_id, image_path, metadata=merged_meta, status="RUNNING", image_hash=existing_hash)
        
        compiled_graph = create_swarm_graph(memory, message_bus, get_segmenter())
        initial_state = {
            "task_id": task_id,
            "image_path": image_path,
            "messages": [],
            "completed_specialists": [],
            "next_agent": "coordinator"
        }
        compiled_graph.invoke(initial_state)
    except Exception as e:
        print(f"[backend] EXCEPTION in background processing: {str(e)}")
        tb.print_exc()
        try:
            message_bus.publish(
                task_id=task_id,
                sender="system",
                message_type="ERROR",
                content=f"حدث خطأ أثناء تشغيل تدفق الوكلاء: {str(e)}"
            )
        except Exception as pub_err:
            print(f"[backend] Failed to publish error message: {pub_err}")
        
        try:
            cur_task = memory.get_task(task_id)
            cur_meta = cur_task.get("metadata") or {} if cur_task else {}
            merged_failure_meta = {**cur_meta, "failure_reason": str(e)[:200]}
            memory.ensure_task_record(task_id, image_path, metadata=merged_failure_meta, status="FAILED")
        except Exception as mem_err:
            print(f"[backend] Failed to update task status: {mem_err}")

def launch_background_processing(task_id: str, image_path: str):
    worker = Thread(
        target=run_agent_swarm_background,
        args=(task_id, image_path),
        daemon=True,
        name=f"agent-bg-{task_id}",
    )
    worker.start()
    return worker
