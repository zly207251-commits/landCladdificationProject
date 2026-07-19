from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse, FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn
import asyncio
import numpy as np
import cv2
import io
import uuid
import os
import json
import hashlib
import mimetypes
import importlib.util
import re
import tempfile
import zipfile
import shutil
import threading
from threading import Thread
from pydantic import BaseModel
from PIL import Image
import requests
import mercantile
from pyproj import Transformer
from urllib.parse import urlparse, parse_qs, unquote, urljoin, urlencode
from typing import Optional, List, Dict, Any

rasterio_spec = importlib.util.find_spec('rasterio')
if rasterio_spec is not None:
    rasterio = importlib.import_module('rasterio')
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
else:
    rasterio = None
    transform_bounds = None
    from_bounds = None

# استيراد مكونات نظام الوكلاء
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.graph import create_swarm_graph
from land_classifier import LandSegmenterSAM
from storage_paths import resolve_storage_path, resolve_storage_dir

app = FastAPI(
    title="نظام فريق وكلاء التحليل الجغرافي (Geo-AI Swarm)",
    description="واجهة برمجية للتحليل المساحي الذكي للصور الجوية وإسقاط المساحات بالفدان والقيراط والسهم.",
    version="2.0"
)

# Configure CORS with wildcard origin for GitHub.dev/potential dynamic hosts.
# If your frontend sends credentials, change this to a fixed origin and allow_credentials=True.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

DEFAULT_CHUNK_SIZE_BYTES = 4 * 1024 * 1024
DEFAULT_CHUNK_UPLOAD_CONCURRENCY = 2


def get_chunk_upload_config() -> dict:
    """Return safe chunk upload settings for environments with low request-body limits."""
    try:
        chunk_size = int(os.getenv("CHUNK_UPLOAD_SIZE_BYTES", str(DEFAULT_CHUNK_SIZE_BYTES)))
    except ValueError:
        chunk_size = DEFAULT_CHUNK_SIZE_BYTES

    try:
        concurrency = int(os.getenv("CHUNK_UPLOAD_CONCURRENCY", str(DEFAULT_CHUNK_UPLOAD_CONCURRENCY)))
    except ValueError:
        concurrency = DEFAULT_CHUNK_UPLOAD_CONCURRENCY

    return {
        "chunk_size_bytes": max(1024 * 1024, chunk_size),
        "concurrency": max(1, concurrency),
    }


@app.middleware("http")
async def add_cors_headers_to_all_responses(request: Request, call_next):
    if request.method == "OPTIONS":
        response = Response(status_code=204)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
        response.headers["Access-Control-Max-Age"] = "600"
        return response

    try:
        response = await call_next(request)
    except Exception:
        response = JSONResponse(status_code=500, content={"detail": "Internal server error"})

    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    response.headers["Access-Control-Max-Age"] = "600"
    return response


@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
    response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    response = JSONResponse(status_code=422, content={"detail": exc.errors()})
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    return response


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    response = JSONResponse(status_code=500, content={"detail": "Internal server error"})
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    return response

# تهيئة قاعدة بيانات الذاكرة المشتركة وباص الرسائل
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = resolve_storage_path(BASE_DIR, "BACKEND_DB_PATH", "shared_memory.db")
UPLOAD_DIR = resolve_storage_dir(BASE_DIR, "BACKEND_UPLOAD_DIR", "temp_uploads")
CHUNK_UPLOAD_DIR = resolve_storage_dir(BASE_DIR, "BACKEND_CHUNK_UPLOAD_DIR", os.path.join("temp_uploads", "chunks"))

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(CHUNK_UPLOAD_DIR, exist_ok=True)

memory = SharedMemory(db_path=DB_PATH)
message_bus = MessageBus(memory)

# Segmenter will be loaded in background on startup to avoid blocking import
segmenter = None
_segmenter_lock = threading.Lock()
_segmenter_ready = threading.Event()

def _load_segmenter_background():
    global segmenter
    try:
        seg = LandSegmenterSAM()
        with _segmenter_lock:
            segmenter = seg
        _segmenter_ready.set()
        print("✔️ Segmenter loaded in background and ready")
    except Exception as e:
        print(f"⚠️ Failed loading segmenter in background: {e}")


@app.on_event("startup")
def _start_segmenter_loader():
    t = threading.Thread(target=_load_segmenter_background, daemon=True)
    t.start()

def ensure_segmenter(timeout: float = 60.0):
    """Ensure the global `segmenter` is loaded. Wait up to `timeout` seconds.
    If not ready after timeout, attempt a synchronous load as fallback.
    """
    global segmenter
    if _segmenter_ready.is_set():
        return segmenter
    # wait briefly for background loader
    waited = _segmenter_ready.wait(timeout=timeout)
    if waited and segmenter is not None:
        return segmenter
    # fallback: attempt synchronous load (may block)
    try:
        with _segmenter_lock:
            if segmenter is None:
                segmenter = LandSegmenterSAM()
                _segmenter_ready.set()
    except Exception as e:
        print(f"⚠️ Failed synchronous segmenter load fallback: {e}")
    return segmenter
_segmenter: LandSegmenterSAM | None = None

def get_segmenter() -> LandSegmenterSAM:
    global _segmenter
    if _segmenter is None:
        _segmenter = LandSegmenterSAM()
    return _segmenter


def get_chunk_dir(upload_id: str) -> str:
    return os.path.join(CHUNK_UPLOAD_DIR, upload_id)


# Diagnostic info: print DB path used by SharedMemory to help debug missing tasks
print(f"[startup] BASE_DIR={BASE_DIR}")
try:
    print(f"[startup] DB_PATH configured: {DB_PATH}")
    print(f"[startup] SharedMemory.db_path: {getattr(memory, 'db_path', '<missing>')}")
    print(f"[startup] DB exists at startup: {os.path.exists(DB_PATH)}")
except Exception:
    pass


def write_chunk_metadata(upload_id: str, metadata: dict):
    chunk_dir = get_chunk_dir(upload_id)
    os.makedirs(chunk_dir, exist_ok=True)
    meta_path = os.path.join(chunk_dir, "metadata.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f)


def read_chunk_metadata(upload_id: str) -> dict | None:
    meta_path = os.path.join(get_chunk_dir(upload_id), "metadata.json")
    if not os.path.exists(meta_path):
        return None
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


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
    # Google Drive may render a link on the warning page with the download URL.
    match = re.search(r'href=["\']([^"\']*uc\?export=download[^"\']*)["\']', html)
    if match:
        unescaped_url = html_lib.unescape(match.group(1))
        return urljoin(base_url, unescaped_url)

    # Look for the download form and construct its GET URL.
    form_match = re.search(r'<form[^>]*action="([^"]*)"[^>]*>(.*?)</form>', html, re.DOTALL)
    if form_match:
        action_url = form_match.group(1)
        form_body = form_match.group(2)
        params = {}
        for inp in re.finditer(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', form_body):
            params[inp.group(1)] = inp.group(2)
        if params:
            return f"{action_url}?{urlencode(params)}"

    # fallback: if the page includes a confirm input, add it to the URL.
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


def merge_chunk_files(upload_id: str, target_path: str, total_chunks: int) -> str:
    chunk_dir = get_chunk_dir(upload_id)
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


def cleanup_chunk_upload(upload_id: str):
    chunk_dir = get_chunk_dir(upload_id)
    if os.path.exists(chunk_dir):
        for root, dirs, files in os.walk(chunk_dir, topdown=False):
            for name in files:
                try:
                    os.remove(os.path.join(root, name))
                except Exception:
                    pass
            for name in dirs:
                try:
                    os.rmdir(os.path.join(root, name))
                except Exception:
                    pass
        try:
            os.rmdir(chunk_dir)
        except Exception:
            pass


@app.post("/save_map_tiff", summary="حفظ صورة الخريطة كـ TIFF")
async def save_map_tiff(file: UploadFile = File(...), filename: str | None = Form(None)):
    """
    يستقبل ملف صورة (PNG/JPEG) عبر Multipart Form، يحولها إلى TIFF ويخزنها مؤقتاً ثم يعيد رابط التحميل.
    """
    try:
        content = await file.read()
        img = Image.open(io.BytesIO(content)).convert('RGBA')
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"تعذر قراءة ملف الصورة: {str(e)}")

    out_name = filename or f"map_capture_{uuid.uuid4().hex[:8]}.tiff"
    out_path = os.path.join(UPLOAD_DIR, out_name)

    try:
        # حفظ كـ TIFF (غير مضغوط افتراضياً)
        img.save(out_path, format='TIFF')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل حفظ الصورة كـ TIFF: {str(e)}")

    return {"message": "تم الحفظ كـ TIFF بنجاح", "filename": out_name, "path": out_path, "download_url": f"/map_exports/{out_name}"}


@app.get('/map_exports/{fname}', summary='تحميل ملف صادر')
def download_map_export(fname: str):
    path = os.path.join(UPLOAD_DIR, fname)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail='الملف غير موجود')
    return FileResponse(path, filename=fname)


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


def launch_background_processing(task_id: str, image_path: str):
    """Start background processing in a real worker thread so task execution is not lost after the request completes."""
    worker = Thread(
        target=run_agent_swarm_background,
        args=(task_id, image_path),
        daemon=True,
        name=f"agent-bg-{task_id}",
    )
    worker.start()
    return worker


def run_agent_swarm_background(task_id: str, image_path: str):
    """دالة تُنفذ في الخلفية لتشغيل تدفق الوكلاء عبر LangGraph دون إيقاف الواجهة."""
    import traceback as tb
    print(f"[backend] starting background processing for {task_id} in {DB_PATH}")
    
    # Debug: Check if task exists before starting
    existing_task = memory.get_task(task_id)
    print(f"[backend] existing_task at start: {existing_task}")
    
    try:
        existing_meta = existing_task.get("metadata") or {} if existing_task else {}
        merged_meta = {**existing_meta, "source": "background_worker"}
        memory.ensure_task_record(task_id, image_path, metadata=merged_meta, status="RUNNING")
        
        # Debug: Verify after status update
        verify = memory.get_task(task_id)
        print(f"[backend] verify after update_task_status: {verify}")
        # بناء وتشغيل الرسم البياني للوكلاء
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
        # توثيق الفشل في باص الرسائل وتحديث الحالة
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
        
        print(f"[backend] background processing failed for {task_id}: {e}")

# --- نقطة نهاية رفع الملفات المقطعة ---

@app.get("/tasks/analyze/chunk/config", summary="Get safe chunk upload configuration")
def chunk_upload_config():
    return get_chunk_upload_config()


@app.get("/tasks/analyze/chunk/status", summary="Check which chunks are already stored for a resumable upload")
async def get_chunk_upload_status(upload_id: str):
    metadata = read_chunk_metadata(upload_id)
    if not metadata:
        return {
            "upload_id": upload_id,
            "exists": False,
            "uploaded_chunks": [],
            "total_chunks": 0,
            "filename": None,
        }

    # Detect uploaded chunks directly from files on disk
    chunk_dir = get_chunk_dir(upload_id)
    uploaded_chunks = []
    total_chunks = metadata.get("total_chunks", 0)
    for idx in range(int(total_chunks)):
        if os.path.exists(os.path.join(chunk_dir, f"chunk_{idx}")):
            uploaded_chunks.append(idx)

    return {
        "upload_id": upload_id,
        "exists": True,
        "uploaded_chunks": sorted(uploaded_chunks),
        "total_chunks": total_chunks,
        "filename": metadata.get("filename"),
    }


def _write_file_sync(path: str, content: bytes):
    with open(path, "wb") as f:
        f.write(content)


@app.post("/tasks/analyze/chunk", summary="Upload a file chunk for a large task image")
async def upload_task_chunk(
    upload_id: str = Form(..., description='معرف الرفع المقطّع الفريد'),
    chunk_index: int = Form(..., description='فهرس الجزء الحالي بدءاً من 0'),
    total_chunks: int = Form(..., description='إجمالي عدد الأجزاء'),
    file: UploadFile = File(..., description="جزء من الملف"),
    filename: str = Form(..., description='اسم الملف الكامل مع الامتداد'),
    image_type: str = Form('regular', description='نوع الصورة: regular أو geospatial'),
    geospatial_crs: str = Form('EPSG:4326', description='نظام الإحداثيات إذا كانت الصورة جغرافية'),
    use_geo_metadata: bool = Form(False, description='محاولة قراءة بيانات GeoTIFF المضمنة إذا كانت متاحة'),
    pixel_scale_meters: float = Form(0.5, description="مقياس الرسم: كم متر يمثله البكسل الواحد (GSD)"),
    ref_latitude: float = Form(15.3694, description="إحداثي خط العرض لنقطة المرجع المساحية"),
    ref_longitude: float = Form(44.1910, description="إحداثي خط الطول لنقطة المرجع المساحية"),
    sam_use_fallback: bool = Form(False, description='تمكين التراجع في SAM إذا كانت النتائج قليلة'),
    sam_min_mask_region_area: int = Form(500, description='أدنى مساحة منطقة قناع SAM بالبكسل للاحتفاظ بها'),
    sam_points_per_side: int = Form(16, description='عدد نقاط SAM لكل جانب لإنشاء الأقنعة'),
    sam_pred_iou_thresh: float = Form(0.86, description='عتبة IoU لنموذج SAM'),
    sam_stability_score_thresh: float = Form(0.85, description='عتبة ثبات قناع SAM'),
    tfw_content: Optional[str] = Form(None, description='محتوى ملف TFW الجغرافي الاختياري')
):
    if chunk_index < 0 or chunk_index >= total_chunks:
        raise HTTPException(status_code=400, detail="فهرس الجزء غير صالح")

    upload_dir = get_chunk_dir(upload_id)
    os.makedirs(upload_dir, exist_ok=True)

    # metadata.json only needs to be written once (no need to update uploaded_chunks in it)
    meta_path = os.path.join(upload_dir, "metadata.json")
    if not os.path.exists(meta_path):
        metadata = {
            "filename": filename,
            "image_type": image_type,
            "geospatial_crs": geospatial_crs,
            "use_geo_metadata": use_geo_metadata,
            "pixel_scale_meters": pixel_scale_meters,
            "ref_latitude": ref_latitude,
            "ref_longitude": ref_longitude,
            "sam_use_fallback": sam_use_fallback,
            "sam_min_mask_region_area": sam_min_mask_region_area,
            "sam_points_per_side": sam_points_per_side,
            "sam_pred_iou_thresh": sam_pred_iou_thresh,
            "sam_stability_score_thresh": sam_stability_score_thresh,
            "total_chunks": total_chunks,
            "tfw_content": tfw_content
        }
        write_chunk_metadata(upload_id, metadata)

    chunk_path = os.path.join(upload_dir, f"chunk_{chunk_index}")
    try:
        content = await file.read()
        # Offload blocking write to a background thread to prevent blocking Uvicorn's async event loop
        await asyncio.to_thread(_write_file_sync, chunk_path, content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"تعذر حفظ جزء الملف: {str(e)}")

    return {
        "upload_id": upload_id,
        "chunk_index": chunk_index,
        "total_chunks": total_chunks,
        "status": "chunk_received"
    }


@app.options("/tasks/analyze/chunk")
async def options_task_chunk(request: Request):
    # Explicitly respond to preflight to ensure CORS headers reach the browser
    origin = request.headers.get("origin", "*")
    return Response(status_code=204, headers={
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    })


@app.post("/tasks/analyze/chunk/complete", summary="Finalize chunked task upload and start analysis")
async def complete_task_chunk_upload(
    background_tasks: BackgroundTasks,
    upload_id: str = Form(..., description='معرف الرفع المقطّع الفريد')
):
    metadata = read_chunk_metadata(upload_id)
    if not metadata:
        raise HTTPException(status_code=404, detail="بيانات الرفع المقطّع غير موجودة")

    total_chunks = metadata.get("total_chunks")
    if total_chunks is None:
        raise HTTPException(status_code=400, detail="عدد الأجزاء مفقود")

    # Validate that all chunk files physically exist on disk
    chunk_dir = get_chunk_dir(upload_id)
    missing_chunks = []
    for idx in range(int(total_chunks)):
        chunk_path = os.path.join(chunk_dir, f"chunk_{idx}")
        if not os.path.exists(chunk_path):
            missing_chunks.append(idx)

    if missing_chunks:
        raise HTTPException(status_code=400, detail=f"الأجزاء غير المكتملة: {missing_chunks}")

    file_extension = os.path.splitext(metadata["filename"])[1] or ".bin"
    task_id = f"task_{uuid.uuid4().hex[:8]}"
    temp_file_name = f"{task_id}{file_extension}"
    temp_file_path = os.path.join(UPLOAD_DIR, temp_file_name)
    try:
        # Offload file merge to background thread and get file hash
        file_hash = await asyncio.to_thread(merge_chunk_files, upload_id, temp_file_path, total_chunks)
        cleanup_chunk_upload(upload_id)
        
        # كتابة ملف الإحداثيات المصاحب (TFW) إذا تم تمريره
        tfw_content = metadata.get("tfw_content")
        if tfw_content:
            base_path, ext = os.path.splitext(temp_file_path)
            world_ext_map = {
                '.tif': '.tfw', '.tiff': '.tfw', '.geotiff': '.tfw',
                '.jpg': '.jgw', '.jpeg': '.jgw',
                '.png': '.pgw'
            }
            world_ext = world_ext_map.get(ext.lower(), '.tfw')
            with open(base_path + world_ext, "w", encoding="utf-8") as wf:
                wf.write(tfw_content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل تجميع الأجزاء: {str(e)}")

    # تحقق مما إذا كانت الصورة قد تم تحليلها مسبقاً بنجاح
    existing_task = memory.get_completed_task_by_hash(file_hash)
    if existing_task:
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except Exception:
            pass
            
        print(f"[api] complete_task_chunk_upload: found cached task {existing_task['task_id']} for hash {file_hash}")
        return {
            "message": "تم العثور على نتيجة سابقة لنفس الصورة.",
            "task_id": existing_task['task_id'],
            "status": "COMPLETED"
        }

    task_metadata = {
        key: value for key, value in metadata.items()
        if key not in ["filename", "total_chunks"]
    }

    print(f"[api] complete_task_chunk_upload request task_id={task_id} upload_id={upload_id} db={getattr(memory, 'db_path', '<no-db>')}")
    created = memory.create_task(task_id, temp_file_path, task_metadata, image_hash=file_hash)
    print(f"[api] complete_task_chunk_upload create_task returned {created} for {task_id}")
    
    # Debug: verify task was created
    if created:
        verify_task = memory.get_task(task_id)
        print(f"[api] verify_task after create: {verify_task}")
    
    if not created:
        raise HTTPException(status_code=500, detail="تعذر حفظ سجل المهمة في قاعدة البيانات")

    # mark task as ready to be processed
    memory.update_task_status(task_id, "PENDING")
    launch_background_processing(task_id, temp_file_path)

    return {
        "message": "تم تجميع الأجزاء وبدء المهمة بنجاح.",
        "task_id": task_id,
        "status": "PENDING"
    }


@app.options("/tasks/analyze/chunk/complete")
async def options_task_chunk_complete(request: Request):
    origin = request.headers.get("origin", "*")
    return Response(status_code=204, headers={
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    })


@app.options("/tasks/analyze/remote")
async def options_task_remote(request: Request):
    # Explicitly respond to preflight to ensure CORS headers reach the browser
    origin = request.headers.get("origin", "*")
    return Response(status_code=204, headers={
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    })


@app.post("/tasks/analyze/remote", summary="Start analysis from a remote image URL")
async def analyze_remote_image(
    background_tasks: BackgroundTasks,
    remote_url: str = Form(..., description='رابط الملف الخارجي'),
    filename: str | None = Form(None, description='اسم الملف المراد حفظه (اختياري)'),
    image_type: str = Form('regular', description='نوع الصورة: regular أو geospatial'),
    geospatial_crs: str = Form('EPSG:4326', description='نظام الإحداثيات إذا كانت الصورة جغرافية'),
    use_geo_metadata: bool = Form(False, description='محاولة قراءة بيانات GeoTIFF المضمنة إذا كانت متاحة'),
    pixel_scale_meters: float = Form(0.5, description="مقياس الرسم: كم متر يمثله البكسل الواحد (GSD)"),
    ref_latitude: float = Form(15.3694, description="إحداثي خط العرض لنقطة المرجع المساحية"),
    ref_longitude: float = Form(44.1910, description="إحداثي خط الطول لنقطة المرجع المساحية"),
    sam_use_fallback: bool = Form(False, description='تمكين التراجع في SAM إذا كانت النتائج قليلة'),
    sam_min_mask_region_area: int = Form(500, description='أدنى مساحة منطقة قناع SAM بالبكسل للاحتفاظ بها'),
    sam_points_per_side: int = Form(16, description='عدد نقاط SAM لكل جانب لإنشاء الأقنعة'),
    sam_pred_iou_thresh: float = Form(0.86, description='عتبة IoU لنموذج SAM'),
    sam_stability_score_thresh: float = Form(0.85, description='عتبة ثبات قناع SAM')
):
    try:
        download_url = normalize_remote_url(remote_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    task_id = f"task_{uuid.uuid4().hex[:8]}"
    guessed_name = filename or os.path.basename(urlparse(download_url).path) or f"remote_image_{task_id}.bin"
    file_extension = os.path.splitext(guessed_name)[1] or ".bin"
    temp_file_name = f"{task_id}{file_extension}"
    temp_file_path = os.path.join(UPLOAD_DIR, temp_file_name)

    try:
        # run download in thread and pass task_id to enable progress updates
        await asyncio.to_thread(download_remote_file, download_url, temp_file_path, task_id)
    except Exception as e:
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception:
                pass
        raise HTTPException(status_code=400, detail=f"فشل تنزيل الملف من الرابط: {str(e)}")

    task_metadata = {
        "remote_url": remote_url,
        "image_type": image_type,
        "geospatial_crs": geospatial_crs,
        "use_geo_metadata": use_geo_metadata,
        "pixel_scale_meters": pixel_scale_meters,
        "ref_latitude": ref_latitude,
        "ref_longitude": ref_longitude,
        "sam_use_fallback": sam_use_fallback,
        "sam_min_mask_region_area": sam_min_mask_region_area,
        "sam_points_per_side": sam_points_per_side,
        "sam_pred_iou_thresh": sam_pred_iou_thresh,
        "sam_stability_score_thresh": sam_stability_score_thresh,
    }

    print(f"[api] analyze_remote_image request task_id={task_id} url={remote_url} db={getattr(memory, 'db_path', '<no-db>')}")
    created = memory.create_task(task_id, temp_file_path, task_metadata)
    print(f"[api] analyze_remote_image create_task returned {created} for {task_id}")
    
    # Debug: verify task was created
    if created:
        verify_task = memory.get_task(task_id)
        print(f"[api] verify_task after create: {verify_task}")
    
    if not created:
        raise HTTPException(status_code=500, detail="تعذر حفظ سجل المهمة في قاعدة البيانات")

    launch_background_processing(task_id, temp_file_path)

    return {
        "message": "تم بدء استيراد الملف من الرابط وبدء المهمة.",
        "task_id": task_id,
        "status": "PENDING"
    }


# --- نهايات الاتصال الخاصة بالوكلاء (Agent Swarm Endpoints) ---


@app.get('/tasks/{task_id}/messages', summary='Get task messages')
def get_task_messages(task_id: str):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail='Task not found')
    msgs = memory.get_messages(task_id)
    return {"task_id": task_id, "messages": msgs}

@app.post('/tasks/{task_id}/retry', summary='Retry processing for a failed task')
def retry_task_processing(task_id: str, background_tasks: BackgroundTasks):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail='Task not found')

    if task.get('status') != 'FAILED':
        raise HTTPException(status_code=400, detail='يمكن إعادة المحاولة فقط للمهمات التي فشلت سابقاً.')

    image_path = task.get('image_path')
    if not image_path or not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail='الصورة المرفوعة للمهمة غير موجودة.')

    memory.log_message(task_id, 'system', 'RETRY', 'إعادة محاولة معالجة المهمة بعد الفشل.', {})
    memory.update_task_status(task_id, 'PENDING')
    launch_background_processing(task_id, image_path)

    return {
        'task_id': task_id,
        'status': 'PENDING',
        'message': 'تمت إعادة محاولة معالجة المهمة بنجاح.'
    }


@app.get('/tasks/debug', summary='Debug current task storage')
def debug_task_storage(limit: int = 20):
    print(f"[api] debug_task_storage request db={getattr(memory, 'db_path', '<no-db>')} limit={limit}")
    tasks = memory.get_tasks(limit=limit)
    return {
        "db_path": memory.db_path,
        "task_count": len(tasks),
        "tasks": tasks
    }

@app.post("/tasks/analyze", summary="1. بدء تحليل الصورة عبر فريق الوكلاء")
async def analyze_image_with_agents(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="الصورة الجوية المراد تحليلها"),
    image_type: str = Form('regular', description='نوع الصورة: regular أو geospatial'),
    geospatial_crs: str = Form('EPSG:4326', description='نظام الإحداثيات إذا كانت الصورة جغرافية'),
    use_geo_metadata: bool = Form(False, description='محاولة قراءة بيانات GeoTIFF المضمنة إذا كانت متاحة'),
    pixel_scale_meters: float = Form(0.5, description="مقياس الرسم: كم متر يمثله البكسل الواحد (GSD)"),
    ref_latitude: float = Form(15.3694, description="إحداثي خط العرض لنقطة المرجع المساحية"),
    ref_longitude: float = Form(44.1910, description="إحداثي خط الطول لنقطة المرجع المساحية"),
    sam_use_fallback: bool = Form(False, description='تمكين التراجع في SAM إذا كانت النتائج قليلة'),
    sam_min_mask_region_area: int = Form(500, description='أدنى مساحة منطقة قناع SAM بالبكسل للاحتفاظ بها'),
    sam_points_per_side: int = Form(8, description='عدد نقاط SAM لكل جانب لإنشاء الأقنعة'),
    sam_pred_iou_thresh: float = Form(0.86, description='عتبة IoU لنموذج SAM'),
    sam_stability_score_thresh: float = Form(0.85, description='عتبة ثبات قناع SAM'),
    tfw_content: Optional[str] = Form(None, description='محتوى ملف TFW الجغرافي الاختياري')
):
    """
    نقطة انطلاق التحليل:
    ترفع الصورة الجوية وتدخل معاملات الإسقاط، فيقوم النظام بإنشاء مهمة فريدة
    وإطلاق فريق الوكلاء للعمل في الخلفية (Async Task).
    """
    # 1. توليد معرف مهمة فريد
    task_id = f"task_{uuid.uuid4().hex[:8]}"
    
    # 2. حفظ ملف الصورة مؤقتاً على القرص
    file_extension = os.path.splitext(file.filename)[1]
    temp_file_name = f"{task_id}{file_extension}"
    temp_file_path = os.path.join(UPLOAD_DIR, temp_file_name)
    
    # Stream-write the uploaded file in chunks, enforce a max upload size, and compute hash
    MAX_UPLOAD_BYTES = 1 * 1024 * 1024 * 1024  # 1 GB
    size = 0
    sha256_hash = hashlib.sha256()
    try:
        with open(temp_file_path, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)  # 1 MB chunks
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    try:
                        f.close()
                        os.remove(temp_file_path)
                    except Exception:
                        pass
                    raise HTTPException(status_code=413, detail="الملف أكبر من الحد المسموح (1 GB)")
                f.write(chunk)
                sha256_hash.update(chunk)
    except HTTPException:
        raise
    except Exception as e:
        # cleanup partial file
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"تعذر حفظ الملف المرفوع: {str(e)}")
    # حفظ ملف الإحداثيات المصاحب (TFW) إذا تم تمريره
    if tfw_content:
        base_path, ext = os.path.splitext(temp_file_path)
        world_ext_map = {
            '.tif': '.tfw', '.tiff': '.tfw', '.geotiff': '.tfw',
            '.jpg': '.jgw', '.jpeg': '.jgw',
            '.png': '.pgw'
        }
        world_ext = world_ext_map.get(ext.lower(), '.tfw')
        with open(base_path + world_ext, "w", encoding="utf-8") as wf:
            wf.write(tfw_content)

    file_hash = sha256_hash.hexdigest()
    
    # تحقق مما إذا كانت الصورة قد تم تحليلها مسبقاً بنجاح
    existing_task = memory.get_completed_task_by_hash(file_hash)
    if existing_task:
        # تنظيف الملف المؤقت لأننا لن نحتاجه
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except Exception:
            pass
            
        print(f"[api] analyze_image_with_agents: found cached task {existing_task['task_id']} for hash {file_hash}")
        return {
            "message": "تم العثور على نتيجة سابقة لنفس الصورة.",
            "task_id": existing_task['task_id'],
            "status": "COMPLETED"
        }
        
    # 3. تسجيل المهمة في قاعدة بيانات الذاكرة المشتركة (SQLite) بوضعية PENDING
    task_metadata = {
        "image_type": image_type,
        "geospatial_crs": geospatial_crs,
        "use_geo_metadata": use_geo_metadata,
        "pixel_scale_meters": pixel_scale_meters,
        "ref_latitude": ref_latitude,
        "ref_longitude": ref_longitude,
        "sam_use_fallback": sam_use_fallback,
        "sam_min_mask_region_area": sam_min_mask_region_area,
        "sam_points_per_side": sam_points_per_side,
        "sam_pred_iou_thresh": sam_pred_iou_thresh,
        "sam_stability_score_thresh": sam_stability_score_thresh,
        "tfw_content": tfw_content
    }

    # Auto-detect GeoTIFF metadata if the file ends with .tif/.tiff/.geotiff, regardless of user input
    if temp_file_path.lower().endswith(('.tif', '.tiff', '.geotiff')):
        geo_metadata = get_geotiff_metadata(temp_file_path)
        if geo_metadata and geo_metadata.get('transform') and geo_metadata.get('crs'):
            image_type = 'geospatial'
            use_geo_metadata = True
            task_metadata['image_type'] = 'geospatial'
            task_metadata['use_geo_metadata'] = True
            task_metadata['geo_metadata'] = geo_metadata
            print(f"[api] Auto-detected valid GeoTIFF metadata for {temp_file_path}. Promoted to geospatial.")

    print(f"[api] analyze_image_with_agents request task_id={task_id} file={file.filename} db={getattr(memory, 'db_path', '<no-db>')}")
    created = memory.create_task(task_id, temp_file_path, task_metadata, image_hash=file_hash)
    print(f"[api] analyze_image_with_agents create_task returned {created} for {task_id}")
    
    # Debug: verify task was created
    if created:
        verify_task = memory.get_task(task_id)
        print(f"[api] verify_task after create: {verify_task}")
    
    if not created:
        raise HTTPException(status_code=500, detail="تعذر حفظ سجل المهمة في قاعدة البيانات")
    
    # 4. إطلاق تدفق الوكلاء كعملية في الخلفية لمنع تعليق الطلب
    launch_background_processing(task_id, temp_file_path)
    
    return {
        "message": "تم استلام الطلب وبدء تشغيل فريق الوكلاء بنجاح.",
        "task_id": task_id,
        "status": "PENDING"
    }

@app.get("/tasks/{task_id}/status", summary="Get task status - الاستعلام عن حالة المهمة")
def get_task_status(task_id: str):
    """
    Get the status of a task to check if it is pending, in progress, completed, or failed.
    الاستعلام عن حالة المهمة لمعرفة ما إذا كانت معلقة، قيد التنفيذ، مكتملة، أو فشلت.
    يتضمن أيضاً إحصائيات تقدم القطع (tiles).
    """
    import traceback
    print(f"[api] get_task_status request for task_id={task_id} db={getattr(memory, 'db_path', '<no-db>')}")

    try:
        task = memory.get_task(task_id)
        if not task:
            print(f"[SharedMemory] get_task: NOT FOUND {task_id} in {getattr(memory, 'db_path', '<no-db>')}")
            return {
                "task_id": task_id,
                "status": "NOT_FOUND",
                "exists": False,
                "message": "المهمة غير موجودة في قاعدة البيانات"
            }

        print(f"[SharedMemory] get_task: found {task_id} in {getattr(memory, 'db_path', '<no-db>')}")

        # إحصائيات تقدم القطع (tiles)
        tile_stats = {"total": 0, "completed": 0, "failed": 0, "pending": 0}
        try:
            from agent_system.db_config import get_db_connection, format_query
            db_path = getattr(memory, 'db_path', 'shared_memory.db')
            with get_db_connection(db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(format_query("SELECT COUNT(*) FROM task_tiles WHERE task_id = %s"), (task_id,))
                total = cursor.fetchone()[0]
                cursor.execute(format_query("SELECT COUNT(*) FROM task_tiles WHERE task_id = %s AND status = 'COMPLETED'"), (task_id,))
                completed = cursor.fetchone()[0]
                cursor.execute(format_query("SELECT COUNT(*) FROM task_tiles WHERE task_id = %s AND status = 'FAILED'"), (task_id,))
                failed = cursor.fetchone()[0]
                
                tile_stats = {
                    "total": total,
                    "completed": completed,
                    "failed": failed,
                    "pending": total - completed - failed
                }
        except Exception as tile_err:
            print(f"[api] tile_stats error: {tile_err}")

        # إحصائيات الذاكرة العشوائية (RAM)
        memory_info = {"total_gb": 0.0, "used_gb": 0.0, "free_gb": 0.0, "process_rss_gb": 0.0, "percent": 0.0}
        try:
            import psutil
            import os
            vm = psutil.virtual_memory()
            process = psutil.Process(os.getpid())
            memory_info = {
                "total_gb": round(vm.total / (1024**3), 2),
                "used_gb": round(vm.used / (1024**3), 2),
                "free_gb": round(vm.available / (1024**3), 2),
                "process_rss_gb": round(process.memory_info().rss / (1024**3), 2),
                "percent": vm.percent
            }
        except Exception as mem_err:
            print(f"[api] memory_info error: {mem_err}")
            # محاولة قراءة مبسطة من ملف النظام في Linux كبديل
            try:
                with open('/proc/self/status') as f:
                    for line in f:
                        if line.startswith('VmRSS:'):
                            parts = line.split()
                            rss_gb = round(float(parts[1]) / (1024 * 1024), 2)
                            memory_info["process_rss_gb"] = rss_gb
                            break
            except Exception:
                pass

        return {
            "task_id": task_id,
            "status": task.get("status", "UNKNOWN"),
            "exists": True,
            "created_at": task.get("created_at"),
            "updated_at": task.get("updated_at"),
            "tile_stats": tile_stats,
            "memory_info": memory_info
        }
    except Exception as e:
        error_msg = f"Error in get_task_status: {str(e)}"
        print(error_msg)
        traceback.print_exc()
        return {
            "task_id": task_id,
            "status": "ERROR",
            "exists": False,
            "message": error_msg
        }


# ============================================================
# 🔍 endpoint جديد: جلب سجلات وكلاء المعالجة بالتفصيل
# ============================================================
@app.get("/tasks/{task_id}/logs", summary="جلب سجلات وكلاء المعالجة بالتفصيل")
def get_task_logs(task_id: str):
    """
    يُعيد جميع رسائل وكلاء المعالجة خطوة بخطوة.
    يُستخدم لتشخيص مكان توقف المعالجة أو حدوث خطأ.
    """
    import traceback
    print(f"[api] get_task_logs request for task_id={task_id} db={getattr(memory, 'db_path', '<no-db>')}")
    
    try:
        # التحقق من وجود المهمة
        task = memory.get_task(task_id)
        if not task:
            return {
                "task_id": task_id,
                "exists": False,
                "message": "المهمة غير موجودة في قاعدة البيانات",
                "logs": []
            }
        
        # جلب جميع رسائل وكلاء المعالجة
        messages = memory.get_messages(task_id)
    
    # تحليل السجلات وتصنيفها
        log_summary = {
            "total_messages": len(messages),
            "by_type": {},
            "by_agent": {},
            "first_message": None,
            "last_message": None
        }
        
        for msg in messages:
            #统计حسب النوع
            msg_type = msg.get("message_type", "UNKNOWN")
            log_summary["by_type"][msg_type] = log_summary["by_type"].get(msg_type, 0) + 1
            
            #统计حسب الوكيل
            sender = msg.get("sender", "unknown")
            log_summary["by_agent"][sender] = log_summary["by_agent"].get(sender, 0) + 1
        
        if messages:
            log_summary["first_message"] = {
                "created_at": messages[0].get("created_at"),
                "sender": messages[0].get("sender"),
                "message_type": messages[0].get("message_type"),
                "content": messages[0].get("content", "")[:100]
            }
            log_summary["last_message"] = {
                "created_at": messages[-1].get("created_at"),
                "sender": messages[-1].get("sender"),
                "message_type": messages[-1].get("message_type"),
                "content": messages[-1].get("content", "")[:100]
            }
        
        return {
            "task_id": task_id,
            "exists": True,
            "task_status": task.get("status"),
            "log_summary": log_summary,
            "logs": [
                {
                    "id": msg.get("message_id"),
                    "created_at": msg.get("created_at"),
                    "sender": msg.get("sender"),
                    "type": msg.get("message_type"),
                    "content": msg.get("content"),
                    "payload": msg.get("payload", {})
                }
                for msg in messages
            ]
        }
    except Exception as e:
        error_msg = f"Error in get_task_logs: {str(e)}"
        print(error_msg)
        traceback.print_exc()
        return {
            "task_id": task_id,
            "exists": False,
            "message": f"خطأ في جلب السجلات: {str(e)}",
            "logs": []
        }


@app.get("/tasks/{task_id}/report", summary="3. جلب التقرير المساحي النهائي والطبقات")
def get_task_report(task_id: str):
    """
    جلب التقرير الهندسي والمساحي النهائي للطبقات المستخرجة بالفدان والقيراط والسهم والتسميات المحلية.
    """
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
        
    layers = memory.get_task_layers(task_id)
    
    # تجهيز كائن التقرير
    report_layers = []
    for ly in layers:
        report_layers.append({
            "layer_name": ly["layer_name"],
            "area_sq_meters": ly["area_sq_meters"],
            "area_agricultural": f"{ly['area_feddan']} فدان، {ly['area_qirat']} قيراط، {ly['area_sahm']:.2f} سهم",
            "local_classification": ly["metadata"].get("local_classification", {}),
            "description": ly["metadata"].get("description", ""),
            "polygons_count": len(ly["polygons"]),
            # إرسال إحداثيات الإسقاط الجغرافي للخرائط التفاعلية
            "geo_polygons": ly["geo_polygons"]
        })
        
    # Build GeoJSON FeatureCollection for frontend convenience
    features = []
    sum_lon = 0.0
    sum_lat = 0.0
    count_coords = 0
    for ly in layers:
        layer_name = ly.get('layer_name')
        metadata = ly.get('metadata') or {}
        geo_polygons = ly.get('geo_polygons') or []
        for polygon in geo_polygons:
            # polygon may be a ring or nested [[ring]]; normalize to ring
            ring = polygon
            if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                ring = polygon[0]

            # ensure coordinates are [lon, lat] and closed
            norm_ring = []
            for pt in ring:
                if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                    continue
                lon = float(pt[0])
                lat = float(pt[1])
                norm_ring.append([lon, lat])
                sum_lon += lon
                sum_lat += lat
                count_coords += 1

            if len(norm_ring) >= 3:
                # close ring
                if norm_ring[0] != norm_ring[-1]:
                    norm_ring.append(norm_ring[0])

                feature = {
                    "type": "Feature",
                    "properties": {
                        "name": layer_name,
                        "layer_name": layer_name,
                        "metadata": metadata
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [norm_ring]
                    }
                }
                features.append(feature)

    geojson = {"type": "FeatureCollection", "features": features}
    map_center = None
    map_zoom = None
    if count_coords > 0:
        avg_lon = sum_lon / count_coords
        avg_lat = sum_lat / count_coords
        # MapViewer/Leaflet expects [lat, lon] for center
        map_center = [avg_lat, avg_lon]
        map_zoom = 17

    processed_image_url = None
    if task.get("processed_image_path") and os.path.exists(task["processed_image_path"]):
        processed_image_url = f"/tasks/{task_id}/image/processed"

    return {
        "task_id": task_id,
        "status": task["status"],
        "created_at": task["created_at"],
        "updated_at": task["updated_at"],
        "image_path": task["image_path"],
        "image_url": f"/tasks/{task_id}/image",
        "processed_image_url": processed_image_url,
        "metadata": task["metadata"],
        "layers": report_layers,
        "geojson": geojson,
        "map_center": map_center,
        "map_zoom": map_zoom
    }

def remove_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass

@app.get("/tasks/{task_id}/export", summary="تصدير طبقات المهمة بصيغ جغرافية مختلفة")
def export_task_layers(task_id: str, format: str = "geojson", background_tasks: BackgroundTasks = None):
    """
    يصدر الطبقات الجغرافية المستخرجة للمهمة بصيغ: geojson, kml, kmz, shp, csv
    """
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
        
    layers = memory.get_task_layers(task_id)
    if not layers:
        raise HTTPException(status_code=400, detail="لا توجد طبقات جغرافية لهذه المهمة لتصديرها.")
        
    format = format.lower()
    
    # 1. تصدير GeoJSON
    if format == "geojson":
        features = []
        for ly in layers:
            layer_name = ly.get('layer_name', 'unknown')
            metadata = ly.get('metadata') or {}
            geo_polygons = ly.get('geo_polygons') or []
            for polygon in geo_polygons:
                ring = polygon
                if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                    ring = polygon[0]
                norm_ring = [[float(pt[0]), float(pt[1])] for pt in ring if isinstance(pt, (list, tuple)) and len(pt) >= 2]
                if len(norm_ring) >= 3:
                    if norm_ring[0] != norm_ring[-1]:
                        norm_ring.append(norm_ring[0])
                    features.append({
                        "type": "Feature",
                        "properties": {
                            "layer_name": layer_name,
                            "area_sq_meters": ly["area_sq_meters"],
                            "area_agricultural": f"{ly['area_feddan']} فدان، {ly['area_qirat']} قيراط، {ly['area_sahm']:.2f} سهم",
                            "metadata": metadata
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [norm_ring]
                        }
                    })
        geojson_data = {"type": "FeatureCollection", "features": features}
        
        fd, path = tempfile.mkstemp(suffix=".geojson")
        os.close(fd)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, ensure_ascii=False, indent=2)
            
        if background_tasks:
            background_tasks.add_task(remove_file, path)
        return FileResponse(path, media_type="application/geo+json", filename=f"export_{task_id}.geojson")
        
    # 2. تصدير KML / KMZ
    elif format in ["kml", "kmz"]:
        try:
            import simplekml
            kml = simplekml.Kml(name=f"Layers for {task_id}")
            
            styles = {
                "buildings": {"color": "7f0000ff", "width": 2},
                "roads": {"color": "7f00ffff", "width": 3},
                "vegetation": {"color": "7f00ff00", "width": 2},
                "agricultural": {"color": "7f00ff00", "width": 2},
                "water_bodies": {"color": "7fff0000", "width": 2},
            }
            
            for ly in layers:
                layer_name = ly.get('layer_name', 'unknown')
                geo_polygons = ly.get('geo_polygons') or []
                fol = kml.newfolder(name=layer_name)
                
                for idx, polygon in enumerate(geo_polygons):
                    ring = polygon
                    if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                        ring = polygon[0]
                    coords = [(float(pt[0]), float(pt[1])) for pt in ring if isinstance(pt, (list, tuple)) and len(pt) >= 2]
                    if len(coords) >= 3:
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])
                        pol = fol.newpolygon(name=f"{layer_name}_{idx}")
                        pol.outerboundaryis = coords
                        
                        style_cfg = styles.get(layer_name.lower())
                        if style_cfg:
                            pol.style.linestyle.color = style_cfg["color"]
                            pol.style.linestyle.width = style_cfg["width"]
                            pol.style.polystyle.color = style_cfg["color"]
                        else:
                            pol.style.linestyle.color = "7fcccccc"
                            pol.style.polystyle.color = "33cccccc"
                        
                        # تعطيل تعبئة المضلعات تماماً ورسم الحدود الخارجية فقط لرؤية الأرض بوضوح
                        pol.style.polystyle.fill = 0
                        pol.style.polystyle.outline = 1
                            
            fd, path = tempfile.mkstemp(suffix=f".{format}")
            os.close(fd)
            
            if format == "kml":
                kml.save(path)
                if background_tasks:
                    background_tasks.add_task(remove_file, path)
                return FileResponse(path, media_type="application/vnd.google-earth.kml+xml", filename=f"export_{task_id}.kml")
            else:
                kml.savekmz(path)
                if background_tasks:
                    background_tasks.add_task(remove_file, path)
                return FileResponse(path, media_type="application/vnd.google-earth.kmz", filename=f"export_{task_id}.kmz")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"فشل إنشاء ملف KML/KMZ: {str(e)}")
            
    # 3. تصدير Shapefile (Zipped SHP folder)
    elif format == "shp":
        try:
            import geopandas as gpd
            from shapely.geometry import Polygon as ShapelyPolygon
            
            features = []
            for ly in layers:
                layer_name = ly.get('layer_name', 'unknown')
                geo_polygons = ly.get('geo_polygons') or []
                for polygon in geo_polygons:
                    ring = polygon
                    if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                        ring = polygon[0]
                    coords = [(float(pt[0]), float(pt[1])) for pt in ring if isinstance(pt, (list, tuple)) and len(pt) >= 2]
                    if len(coords) >= 3:
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])
                        geom = ShapelyPolygon(coords)
                        features.append({
                            "geometry": geom,
                            "layer_name": layer_name,
                            "area_sqm": float(ly["area_sq_meters"]),
                            "feddan": int(ly["area_feddan"]),
                            "qirat": int(ly["area_qirat"]),
                            "sahm": float(ly["area_sahm"])
                        })
                        
            if not features:
                raise ValueError("لا توجد مضلعات صالحة لتصديرها كـ Shapefile")
                
            gdf = gpd.GeoDataFrame(features, crs="EPSG:4326")
            
            temp_dir = tempfile.mkdtemp()
            shp_base_name = f"export_{task_id}"
            shp_path = os.path.join(temp_dir, f"{shp_base_name}.shp")
            gdf.to_file(shp_path, driver="ESRI Shapefile", encoding="utf-8")
            
            fd, path = tempfile.mkstemp(suffix=".zip")
            os.close(fd)
            
            with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        zipf.write(file_path, arcname=file)
                        
            shutil.rmtree(temp_dir)
            if background_tasks:
                background_tasks.add_task(remove_file, path)
            return FileResponse(path, media_type="application/zip", filename=f"export_{task_id}.zip")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"فشل إنشاء ملف Shapefile: {str(e)}")
            
    # 4. تصدير CSV (إحداثيات المضلعات)
    elif format == "csv":
        import csv
        fd, path = tempfile.mkstemp(suffix=".csv")
        os.close(fd)
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["layer_name", "area_sq_meters", "area_agricultural", "polygon_index", "longitude", "latitude"])
            for ly in layers:
                layer_name = ly.get('layer_name', 'unknown')
                geo_polygons = ly.get('geo_polygons') or []
                area_agri = f"{ly['area_feddan']} فدان، {ly['area_qirat']} قيراط، {ly['area_sahm']:.2f} سهم"
                for idx, polygon in enumerate(geo_polygons):
                    ring = polygon
                    if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                        ring = polygon[0]
                    for pt in ring:
                        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                            writer.writerow([layer_name, ly["area_sq_meters"], area_agri, idx, pt[0], pt[1]])
        if background_tasks:
            background_tasks.add_task(remove_file, path)
        return FileResponse(path, media_type="text/csv", filename=f"export_{task_id}.csv")
        
    else:
        raise HTTPException(status_code=400, detail=f"صيغة التصدير '{format}' غير مدعومة.")

@app.get("/tasks/{task_id}/image", summary="4. جلب صورة المهمة الأصلية")
def get_task_image(task_id: str):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
    image_path = task["image_path"]
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="الصورة غير موجودة على الخادم.")
    _, ext = os.path.splitext(image_path)
    ext = ext.lower()
    if ext in ['.tif', '.tiff', '.geotiff']:
        try:
            image = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
            if image is None:
                raise ValueError("تعذر قراءة الصورة الجغرافية")
            if len(image.shape) == 2:
                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
            elif image.shape[2] == 4:
                image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
            _, buffer = cv2.imencode('.png', image)
            return StreamingResponse(io.BytesIO(buffer.tobytes()), media_type='image/png')
        except Exception:
            return FileResponse(image_path, filename=os.path.basename(image_path))

    return FileResponse(image_path, filename=os.path.basename(image_path))

@app.get("/tasks/{task_id}/image/processed", summary="4b. جلب الصورة النهائية المعالجة")
def get_task_processed_image(task_id: str):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")

    processed_path = task.get("processed_image_path")
    if not processed_path or not os.path.exists(processed_path):
        raise HTTPException(status_code=404, detail="الصورة النهائية غير متاحة.")

    _, ext = os.path.splitext(processed_path)
    ext = ext.lower()
    if ext in ['.tif', '.tiff', '.geotiff']:
        try:
            image = cv2.imread(processed_path, cv2.IMREAD_UNCHANGED)
            if image is None:
                raise ValueError("تعذر قراءة الصورة النهائية")
            if len(image.shape) == 2:
                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
            elif image.shape[2] == 4:
                image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
            _, buffer = cv2.imencode('.png', image)
            return StreamingResponse(io.BytesIO(buffer.tobytes()), media_type='image/png')
        except Exception:
            return FileResponse(processed_path, filename=os.path.basename(processed_path))

    return FileResponse(processed_path, filename=os.path.basename(processed_path))

@app.get("/tasks/{task_id}/crop", summary="7. قص صورة المهمة الجغرافية حسب حدود الإحداثيات")
def crop_task_image(
    task_id: str,
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float
):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")

    image_path = task["image_path"]
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="الصورة غير موجودة على الخادم.")

    if rasterio is None or transform_bounds is None or from_bounds is None:
        raise HTTPException(status_code=500, detail="Rasterio مطلوب لتنفيذ القص الجغرافي.")

    task_meta = task.get("metadata", {}) or {}
    geo_metadata = task_meta.get("geo_metadata") if task_meta.get("image_type") == "geospatial" else None

    try:
        with rasterio.open(image_path) as src:
            if src.crs is None:
                raise ValueError("مصدر الصورة لا يحتوي على CRS صالح.")
            if not geo_metadata or not geo_metadata.get("crs"):
                # إذا لم تكن metadata محفوظة أثناء التحميل، نعتمد على CRS من الملف نفسه
                geo_metadata = {
                    "crs": str(src.crs)
                }

            min_lon_val = min(min_lon, max_lon)
            max_lon_val = max(min_lon, max_lon)
            min_lat_val = min(min_lat, max_lat)
            max_lat_val = max(min_lat, max_lat)

            src_min_lon, src_min_lat, src_max_lon, src_max_lat = transform_bounds(
                "EPSG:4326",
                src.crs,
                min_lon_val,
                min_lat_val,
                max_lon_val,
                max_lat_val,
                densify_pts=21
            )

            window = from_bounds(
                min(src_min_lon, src_max_lon),
                min(src_min_lat, src_max_lat),
                max(src_min_lon, src_max_lon),
                max(src_min_lat, src_max_lat),
                transform=src.transform,
                width=src.width,
                height=src.height
            )
            window = window.round_offsets().round_shape()
            if window.width <= 0 or window.height <= 0:
                raise ValueError("المنطقة المحددة خارج نطاق الصورة الجغرافية.")

            data = src.read(window=window, boundless=True, fill_value=0)
            out_transform = rasterio.windows.transform(window, src.transform)
            out_name = f"{task_id}_crop_{uuid.uuid4().hex[:8]}.tiff"
            out_path = os.path.join(UPLOAD_DIR, out_name)

            profile = src.profile.copy()
            profile.update({
                "driver": "GTiff",
                "height": data.shape[1],
                "width": data.shape[2],
                "transform": out_transform,
                "count": data.shape[0]
            })

            with rasterio.open(out_path, "w", **profile) as dst:
                dst.write(data)

        return FileResponse(out_path, media_type='image/tiff', filename=out_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل تصدير القص الجغرافي: {str(e)}")


@app.get("/crop/from_tiles", summary="قص من مصدر بلاطات (XYZ/WMTS) عبر تركيب البلاطات")
def crop_from_tiles(
    tile_template: str,
    zoom: int,
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    tile_size: int = 256
):
    """
    يحمّل البلاطات من قالب URL مثل https://.../{z}/{x}/{y}.png عند مستوى zoom ويقوم بتركيبها
    ثم يُخرج GeoTIFF يحتوي CRS=EPSG:3857 يغطي المنطقة المطلوبة.
    تحذير: قد تنطبق قيود ترخيص عند استخدام مزودين مثل Google — تأكد من الصلاحيات.
    """
    if rasterio is None:
        raise HTTPException(status_code=500, detail="Rasterio مطلوب لإنشاء GeoTIFF من البلاطات.")

    try:
        # Normalize bbox
        min_lon_val = min(min_lon, max_lon)
        max_lon_val = max(min_lon, max_lon)
        min_lat_val = min(min_lat, max_lat)
        max_lat_val = max(min_lat, max_lat)

        # Compute tiles covering bbox
        tile_list = list(mercantile.tiles(min_lon_val, min_lat_val, max_lon_val, max_lat_val, zoom))
        if not tile_list:
            raise ValueError("لم يتم العثور على بلاطات تغطي المنطقة عند zoom المحدد.")

        xs = [t.x for t in tile_list]
        ys = [t.y for t in tile_list]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        cols = max_x - min_x + 1
        rows = max_y - min_y + 1

        # Create canvas
        canvas_w = cols * tile_size
        canvas_h = rows * tile_size
        from PIL import Image as PILImage
        canvas = PILImage.new('RGBA', (canvas_w, canvas_h))

        # Download and paste tiles
        for tile in tile_list:
            # Build URL (support both {x}/{y}/{z} and {z}/{x}/{y})
            url = tile_template.format(z=zoom, x=tile.x, y=tile.y)
            try:
                resp = requests.get(url, timeout=10)
                resp.raise_for_status()
                img = PILImage.open(io.BytesIO(resp.content)).convert('RGBA')
            except Exception:
                # missing tile or error -> use transparent tile
                img = PILImage.new('RGBA', (tile_size, tile_size), (0, 0, 0, 0))

            px = (tile.x - min_x) * tile_size
            py = (tile.y - min_y) * tile_size
            canvas.paste(img, (px, py))

        # Transform target user bounding box from EPSG:4326 to EPSG:3857
        transformer = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
        x_min, y_min = transformer.transform(min_lon_val, min_lat_val)
        x_max, y_max = transformer.transform(max_lon_val, max_lat_val)

        # Get exact Web Mercator bounds of stitched tiles using mercantile.xy_bounds
        b_min = mercantile.xy_bounds(min_x, max_y, zoom)
        b_max = mercantile.xy_bounds(max_x, min_y, zoom)
        
        tile_left = b_min.left
        tile_bottom = b_min.bottom
        tile_right = b_max.right
        tile_top = b_max.top

        res_x = (tile_right - tile_left) / canvas_w
        res_y = (tile_top - tile_bottom) / canvas_h

        # Compute exact pixel offsets corresponding to user selected bounding box
        px_left = max(0, int(round((x_min - tile_left) / res_x)))
        px_right = min(canvas_w, int(round((x_max - tile_left) / res_x)))
        px_top = max(0, int(round((tile_top - y_max) / res_y)))
        px_bottom = min(canvas_h, int(round((tile_top - y_min) / res_y)))

        # Ensure valid crop box dimensions (at least 1 pixel wide/high)
        if px_right <= px_left:
            px_right = px_left + 1
        if px_bottom <= px_top:
            px_bottom = px_top + 1

        # Crop the canvas to the user's exact bounding box
        cropped_canvas = canvas.crop((px_left, px_top, px_right, px_bottom))
        out_w, out_h = cropped_canvas.size

        # Compute exact Web Mercator bounds of cropped area
        left = tile_left + px_left * res_x
        top = tile_top - px_top * res_y
        right = tile_left + px_right * res_x
        bottom = tile_top - px_bottom * res_y

        res_x_cropped = (right - left) / out_w
        res_y_cropped = (top - bottom) / out_h
        out_transform = rasterio.transform.from_origin(left, top, res_x_cropped, res_y_cropped)

        # Convert cropped canvas to numpy array and write as GeoTIFF (RGB)
        arr = np.array(cropped_canvas)
        # arr shape: (h,w,4) RGBA -> take RGB, ignore alpha
        if arr.ndim == 3 and arr.shape[2] >= 3:
            rgb = arr[:, :, :3]
        else:
            rgb = np.stack([arr, arr, arr], axis=-1)

        # move axis to (bands, rows, cols)
        rgb = np.moveaxis(rgb, -1, 0)

        out_name = f"tiles_crop_{uuid.uuid4().hex[:8]}.tiff"
        out_path = os.path.join(UPLOAD_DIR, out_name)

        profile = {
            'driver': 'GTiff',
            'dtype': 'uint8',
            'count': rgb.shape[0],
            'height': out_h,
            'width': out_w,
            'transform': out_transform,
            'crs': 'EPSG:3857',
            'compress': 'LZW',
            'tiled': True
        }

        with rasterio.open(out_path, 'w', **profile) as dst:
            dst.write(rgb)

        return FileResponse(out_path, media_type='image/tiff', filename=out_name)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل تركيب البلاطات وتصدير GeoTIFF: {str(e)}")

@app.get("/tasks/{task_id}/logs", summary="5. جلب السجل الحقيقي للمراسلات بين الوكلاء")
def get_task_logs(task_id: str):
    """
    جلب كافة سجلات التخاطب والخطوات التي قام بها الوكلاء بالتفصيل والزمن الفعلي.
    """
    messages = memory.get_messages(task_id)
    if not messages:
        # التحقق من وجود المهمة
        task = memory.get_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
        return {"task_id": task_id, "logs": []}
        
    log_entries = []
    for msg in messages:
        log_entries.append({
            "timestamp": msg["created_at"],
            "agent": msg["sender"].upper(),
            "type": msg["message_type"].upper(),
            "content": msg["content"],
            "data": msg["payload_json"]
        })
        
    return {
        "task_id": task_id,
        "logs": log_entries
    }

@app.get("/tasks", summary="6. جلب قائمة المهام السابقة")
def list_tasks(limit: int = 10):
    """استرجاع ملخص المهام الأخيرة لعرضها في واجهة المستخدم."""
    tasks = memory.get_tasks(limit=limit)
    return {"tasks": tasks}

# --- نهايات الاتصال الأساسية الموروثة (Legacy Endpoints) ---

@app.get("/", response_class=HTMLResponse, summary="الصفحة الترحيبية للواجهة")
def home():
    html = """
    <html>
        <head>
            <title>SAM & Geo-AI Swarm</title>
            <meta charset="utf-8">
        </head>
        <body style="font-family: Arial, sans-serif; margin: 40px; text-align: center;">
            <h2>مرحباً بك في نظام Geo-AI Swarm للتحليل الجغرافي الذكي</h2>
            <p>يمكنك تجربة واجهة الاستخدام وفحص وتجربة فريق الوكلاء التفاعلي مباشرة عبر الرابط أدناه:</p>
            <a href="/docs" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">انتقل إلى Swagger API Docs</a>
        </body>
    </html>
    """
    return HTMLResponse(html)

@app.post("/segment", summary="استخراج الحدود عبر SAM المباشر (تلوين أخضر)")
async def segment_image(file: UploadFile = File(...)):
    image_bytes = await file.read()
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    
    if img is None:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image")

    # استخراج القطع من SAM
    seg = ensure_segmenter()
    if seg is None:
        raise HTTPException(status_code=503, detail="SAM model not available")

    segments = seg.segment_image(img)

    # رسم الحدود على الصورة (نتيجة segment_image قد تكون قائمة قواميس تحتوي 'polygons')
    for seg_item in segments:
        polys = None
        if isinstance(seg_item, dict):
            polys = seg_item.get('polygons', [])
        elif isinstance(seg_item, (list, tuple)):
            polys = seg_item
        else:
            continue

        for poly in polys:
            try:
                pts = np.array(poly, dtype=np.int32)
                cv2.polylines(img, [pts], True, (0, 255, 0), 2)
            except Exception:
                continue

    # إخراج الصورة
    _, buffer = cv2.imencode(".png", img)
    return StreamingResponse(io.BytesIO(buffer.tobytes()), media_type="image/png")

@app.post("/gis/convert-shp-zip", summary="تحويل ملف Shapefile ZIP إلى GeoJSON")
async def convert_shp_zip_to_geojson(file: UploadFile = File(...)):
    """
    يستقبل ملف Shapefile مضغوط بصيغة ZIP، ويقوم بتحويله إلى GeoJSON باستخدام Geopandas و Shapely.
    """
    if not file.filename.lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail="يجب أن يكون الملف بصيغة ZIP مضغوطة.")
        
    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, file.filename)
    
    try:
        # 1. حفظ ملف الـ ZIP مؤقتاً
        with open(zip_path, "wb") as f:
            content = await file.read()
            f.write(content)
            
        # 2. فك ضغط ملف الـ ZIP
        extract_dir = os.path.join(temp_dir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
            
        # 3. البحث عن ملف .shp داخل المجلد
        shp_file = None
        for root, dirs, files in os.walk(extract_dir):
            for f_name in files:
                if f_name.lower().endswith('.shp'):
                    shp_file = os.path.join(root, f_name)
                    break
            if shp_file:
                break
                
        if not shp_file:
            raise HTTPException(status_code=400, detail="لم يتم العثور على ملف بصيغة .shp داخل مجلد الـ ZIP.")
            
        # 4. قراءة ملف الـ Shapefile باستخدام Geopandas وتحويله إلى EPSG:4326
        import geopandas as gpd
        gdf = gpd.read_file(shp_file)
        if gdf.crs is None:
            gdf.crs = "EPSG:4326"
        elif gdf.crs != "EPSG:4326":
            gdf = gdf.to_crs("EPSG:4326")
            
        # 5. تحويل البيانات إلى تنسيق GeoJSON
        geojson_str = gdf.to_json()
        geojson_data = json.loads(geojson_str)
        
        return geojson_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء معالجة ملف Shapefile: {str(e)}")
    finally:
        # تنظيف المجلدات المؤقتة
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass

# --- نقاط الاتصال الجغرافية المرجعية (Reference GIS Data Endpoints) ---

@app.get("/gis/reference/layers", summary="جلب المعالم الجغرافية المرجعية (OSM) من قاعدة البيانات")
def get_gis_reference_layers(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    city: str = "Sanaa",
    category: str = "building"
):
    try:
        features = memory.get_reference_features(city, category, min_lon, min_lat, max_lon, max_lat)
        return {
            "status": "success",
            "type": "FeatureCollection",
            "features": features
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل جلب المعالم المرجعية: {str(e)}")

@app.post("/gis/reference/fetch-bounds", summary="جلب وتخزين معالم جديدة يدويًا من خريطة الشارع المفتوحة لليمن")
def fetch_gis_reference_bounds(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    city: str = "Sanaa"
):
    try:
        from utils_osm import fetch_and_save_osm_reference
        saved_count = fetch_and_save_osm_reference(city, min_lon, min_lat, max_lon, max_lat)
        return {
            "status": "success",
            "message": f"تم جلب وحفظ {saved_count} معلم مرجعي لمدينة {city} بنجاح.",
            "saved_count": saved_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل استدعاء وحفظ معالم خريطة الشارع المفتوحة: {str(e)}")

if __name__ == "__main__":
    use_reload = os.getenv("BACKEND_RELOAD", "false").lower() in {"1", "true", "yes"}
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8000,
        reload=use_reload,
    )
    