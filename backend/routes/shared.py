import os
import asyncio
import threading
from threading import Thread
import traceback as tb
import hashlib
import re
import json
from urllib.parse import urlparse, parse_qs, unquote, urljoin, urlencode
import requests

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

def start_segmenter_loader():
    """Call this from app startup event to begin background loading."""
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


def get_geotiff_metadata(path: str):
    if rasterio is None or not path.lower().endswith(('.tif', '.tiff', '.geotiff')):
        return None
    try:
        with rasterio.open(path) as ds:
            transform = None
            if hasattr(ds, 'transform'):
                transform = ds.transform.to_gdal() if ds.transform is not None else None
            return {
                'crs': str(ds.crs) if ds.crs else None,
                'transform': transform,
                'width': ds.width,
                'height': ds.height,
                'count': ds.count,
                'bounds': {
                    'left': ds.bounds.left,
                    'bottom': ds.bounds.bottom,
                    'right': ds.bounds.right,
                    'top': ds.bounds.top
                }
            }
    except Exception:
        return None


def normalize_remote_url(remote_url: str) -> str:
    parsed = urlparse(remote_url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL must start with http:// or https://")

    if "drive.google.com" in parsed.netloc:
        query = parse_qs(parsed.query)
        if "/file/d/" in parsed.path:
            file_id = parsed.path.split("/file/d/")[1].split("/")[0]
            return f"https://drive.google.com/uc?export=download&id={file_id}"
        if "id" in query:
            return f"https://drive.google.com/uc?export=download&id={query['id'][0]}"
        if "/open" in parsed.path and "id" in query:
            return f"https://drive.google.com/uc?export=download&id={query['id'][0]}"

    if "dropbox.com" in parsed.netloc:
        if "dl=0" in parsed.query:
            return remote_url.replace("dl=0", "dl=1")
        if parsed.path.endswith("/") and "dl=" not in parsed.query:
            return f"{remote_url}?dl=1"

    return remote_url.strip()


def _extract_google_drive_download_url(html: str, base_url: str) -> str | None:
    import html as html_lib
    match = re.search(r'href=["\']([^"\']*uc\?export=download[^"\']*)["\']', html)
    if match:
        unescaped_url = html_lib.unescape(match.group(1))
        return urljoin(base_url, unescaped_url)

    form_match = re.search(r'<form[^>]*action="([^"]*)"[^>]*>(.*?)</form>', html, re.DOTALL)
    if form_match:
        action_url = form_match.group(1)
        form_body = form_match.group(2)
        params = {}
        for inp in re.finditer(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', form_body):
            params[inp.group(1)] = inp.group(2)
        if params:
            return f"{action_url}?{urlencode(params)}"

    match = re.search(r'name="confirm" value="([0-9A-Za-z_-]+)"', html)
    if match:
        return _append_confirm_token(base_url, match.group(1))

    match = re.search(r'name="download_warning" value="([0-9A-Za-z_-]+)"', html)
    if match:
        return _append_confirm_token(base_url, match.group(1))

    match = re.search(r'confirm=([0-9A-Za-z_-]+)', html)
    if match:
        return _append_confirm_token(base_url, match.group(1))

    return None


def _append_confirm_token(url: str, token: str) -> str:
    if "confirm=" in url:
        return re.sub(r'confirm=[^&]+', f'confirm={token}', url)
    sep = '&' if '?' in url else '?'
    return f"{url}{sep}confirm={token}"


def choose_remote_filename(remote_url: str, response) -> str | None:
    cd = response.headers.get("content-disposition")
    if cd:
        parts = cd.split(";")
        for part in parts:
            if "filename=" in part:
                filename = part.split("=")[1].strip().strip('"')
                return unquote(filename)
    parsed = urlparse(remote_url)
    basename = os.path.basename(parsed.path)
    if basename:
        return unquote(basename)
    return None


def download_remote_file(remote_url: str, dest_path: str, task_id: str | None = None, max_bytes: int = 5 * 1024 * 1024 * 1024, chunk_size: int = 8 * 1024 * 1024) -> None:
    """Download a file from a remote URL with progress tracking. Runs in a thread."""
    download_url = normalize_remote_url(remote_url)
    session = requests.Session()
    response = session.get(download_url, stream=True, allow_redirects=True, timeout=30)
    try:
        response.raise_for_status()

        if "text/html" in response.headers.get("content-type", ""):
            html_text = response.text
            if "drive.google.com" in download_url:
                new_download_url = _extract_google_drive_download_url(html_text, download_url)
                if new_download_url and new_download_url != download_url:
                    response.close()
                    response = session.get(new_download_url, stream=True, allow_redirects=True, timeout=30)
                    response.raise_for_status()
                    download_url = new_download_url

        content_type = response.headers.get("content-type", "")
        if "text/html" in content_type or "application/json" in content_type:
            raise ValueError(f"Expected binary image content but received {content_type}")

        total_header = response.headers.get("content-length")
        try:
            total_expected = int(total_header) if total_header else None
        except Exception:
            total_expected = None

        total_bytes = 0
        if task_id:
            try:
                memory.log_message(task_id, "system", "DOWNLOAD_PROGRESS", "start", {"downloaded": 0, "total": total_expected})
                memory.update_task_status(task_id, "DOWNLOADING")
            except Exception:
                pass

        with open(dest_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        raise ValueError("Remote file exceeds maximum allowed size")
                    f.write(chunk)
                    if task_id:
                        try:
                            percent = None
                            if total_expected:
                                percent = int((total_bytes / total_expected) * 100)
                            memory.log_message(task_id, "system", "DOWNLOAD_PROGRESS", "progress", {"downloaded": total_bytes, "total": total_expected, "percent": percent})
                        except Exception:
                            pass

        if task_id:
            try:
                memory.log_message(task_id, "system", "DOWNLOAD_PROGRESS", "complete", {"downloaded": total_bytes, "total": total_expected, "percent": 100})
                memory.update_task_status(task_id, "PENDING")
            except Exception:
                pass
    finally:
        response.close()
        session.close()


def merge_chunk_files(upload_id: str, target_path: str, total_chunks: int, chunk_upload_dir: str) -> str:
    """Merge chunk files into a single file and return SHA256 hash."""
    chunk_dir = os.path.join(chunk_upload_dir, upload_id)
    sha256_hash = hashlib.sha256()
    with open(target_path, "wb") as target:
        for idx in range(total_chunks):
            chunk_path = os.path.join(chunk_dir, f"chunk_{idx}")
            if not os.path.exists(chunk_path):
                raise FileNotFoundError(f"الجزء مفقود: {idx}")
            with open(chunk_path, "rb") as chunk_file:
                while True:
                    data = chunk_file.read(1024 * 1024)
                    if not data:
                        break
                    target.write(data)
                    sha256_hash.update(data)
    return sha256_hash.hexdigest()


def _write_file_sync(path: str, content: bytes):
    """Write bytes to disk — intended to run via asyncio.to_thread."""
    with open(path, "wb") as f:
        f.write(content)


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
