from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
import os
import io
import json
import uuid
import hashlib
import requests
import mercantile
from PIL import Image as PILImage
import numpy as np
from pyproj import Transformer
from urllib.parse import urlparse, parse_qs, urljoin, urlencode

from routes.shared import memory, UPLOAD_DIR, CHUNK_UPLOAD_DIR, launch_background_processing
from routes.shared import rasterio

upload_router = APIRouter(prefix="", tags=["upload"])

DEFAULT_CHUNK_SIZE_BYTES = 4 * 1024 * 1024
DEFAULT_CHUNK_UPLOAD_CONCURRENCY = 2

def get_chunk_upload_config() -> dict:
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

def get_chunk_dir(upload_id: str) -> str:
    return os.path.join(CHUNK_UPLOAD_DIR, upload_id)

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
                return filename

    parsed = urlparse(remote_url)
    path = parsed.path
    if path:
        filename = os.path.basename(path)
        if filename and "." in filename:
            return filename
    return None

import re

# --- Chunk upload endpoints ---

@upload_router.get("/tasks/analyze/chunk/config", summary="Get safe chunk upload configuration")
def chunk_upload_config():
    return get_chunk_upload_config()

@upload_router.get("/tasks/analyze/chunk/status", summary="Check which chunks are already stored for a resumable upload")
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

    chunk_dir = get_chunk_dir(upload_id)
    uploaded = []
    total = metadata.get("total_chunks", 0)
    for i in range(total):
        chunk_file = os.path.join(chunk_dir, f"chunk_{i}")
        if os.path.exists(chunk_file):
            uploaded.append(i)

    return {
        "upload_id": upload_id,
        "exists": True,
        "uploaded_chunks": uploaded,
        "total_chunks": total,
        "filename": metadata.get("filename"),
    }

@upload_router.post("/tasks/analyze/chunk", summary="Upload a file chunk for a large task image")
async def upload_task_chunk(
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    filename: str = Form(...),
    file: UploadFile = File(...)
):
    chunk_dir = get_chunk_dir(upload_id)
    os.makedirs(chunk_dir, exist_ok=True)

    metadata = read_chunk_metadata(upload_id)
    if not metadata:
        metadata = {
            "upload_id": upload_id,
            "total_chunks": total_chunks,
            "filename": filename,
        }
        write_chunk_metadata(upload_id, metadata)

    chunk_file = os.path.join(chunk_dir, f"chunk_{chunk_index}")
    content = await file.read()
    with open(chunk_file, "wb") as f:
        f.write(content)

    return {"message": f"Chunk {chunk_index} uploaded successfully."}

@upload_router.options("/tasks/analyze/chunk")
def options_chunk():
    return JSONResponse(content={"message": "OK"})

@upload_router.post("/tasks/analyze/chunk/complete", summary="Finalize chunked task upload and start analysis")
async def complete_chunk_upload(
    background_tasks: BackgroundTasks,
    upload_id: str = Form(...),
    image_type: str = Form("regular"),
    geospatial_crs: str = Form("EPSG:4326"),
    use_geo_metadata: bool = Form(False),
    pixel_scale_meters: float = Form(1.0),
    ref_latitude: float = Form(0.0),
    ref_longitude: float = Form(0.0),
    sam_use_fallback: bool = Form(False),
    sam_min_mask_region_area: int = Form(500),
    sam_points_per_side: int = Form(16),
    sam_pred_iou_thresh: float = Form(0.86),
    sam_stability_score_thresh: float = Form(0.85),
    tfw_content: str = Form("")
):
    metadata = read_chunk_metadata(upload_id)
    if not metadata:
        raise HTTPException(status_code=404, detail="Upload session not found.")

    filename = metadata["filename"]
    _, ext = os.path.splitext(filename)
    task_id = f"task_{uuid.uuid4().hex[:8]}"
    temp_file_name = f"task_{task_id}{ext}"
    temp_file_path = os.path.join(UPLOAD_DIR, temp_file_name)

    chunk_dir = get_chunk_dir(upload_id)
    total_chunks = metadata["total_chunks"]

    sha256_hash = hashlib.sha256()
    try:
        with open(temp_file_path, "wb") as outfile:
            for i in range(total_chunks):
                chunk_file = os.path.join(chunk_dir, f"chunk_{i}")
                if not os.path.exists(chunk_file):
                    raise HTTPException(status_code=400, detail=f"Missing chunk index {i}")
                with open(chunk_file, "rb") as infile:
                    chunk_data = infile.read()
                    outfile.write(chunk_data)
                    sha256_hash.update(chunk_data)
    except Exception as e:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        raise HTTPException(status_code=500, detail=f"Failed to assemble file chunks: {str(e)}")

    if tfw_content:
        base_path, _ = os.path.splitext(temp_file_path)
        with open(base_path + ".tfw", "w", encoding="utf-8") as wf:
            wf.write(tfw_content)

    file_hash = sha256_hash.hexdigest()
    
    existing_task = memory.get_completed_task_by_hash(file_hash)
    if existing_task:
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except Exception:
            pass
        return {
            "message": "تم العثور على نتيجة سابقة لنفس الصورة.",
            "task_id": existing_task["task_id"],
            "status": "COMPLETED",
            "cached": True
        }

    # Auto-detect GeoTIFF CRS if possible
    final_image_type = image_type
    detected_crs = geospatial_crs
    if rasterio is not None and ext.lower() in [".tif", ".tiff", ".geotiff"]:
        try:
            with rasterio.open(temp_file_path) as dataset:
                if dataset.crs is not None:
                    final_image_type = "geospatial"
                    detected_crs = str(dataset.crs)
        except Exception:
            pass

    task_metadata = {
        "image_type": final_image_type,
        "geospatial_crs": detected_crs,
        "use_geo_metadata": use_geo_metadata,
        "pixel_scale_meters": pixel_scale_meters,
        "ref_latitude": ref_latitude,
        "ref_longitude": ref_longitude,
        "sam_use_fallback": sam_use_fallback,
        "sam_min_mask_region_area": sam_min_mask_region_area,
        "sam_points_per_side": sam_points_per_side,
        "sam_pred_iou_thresh": sam_pred_iou_thresh,
        "sam_stability_score_thresh": sam_stability_score_thresh
    }

    created = memory.create_task(task_id, temp_file_path, task_metadata, image_hash=file_hash)
    if not created:
        raise HTTPException(status_code=500, detail="Failed to create task in DB.")

    launch_background_processing(task_id, temp_file_path)

    # Clean up chunk directory
    try:
        shutil.rmtree(chunk_dir)
    except Exception:
        pass

    return {
        "message": "تم تجميع الأجزاء وبدء تحليل الصورة بالذكاء الاصطناعي في الخلفية.",
        "task_id": task_id,
        "status": "PENDING"
    }

@upload_router.options("/tasks/analyze/chunk/complete")
def options_chunk_complete():
    return JSONResponse(content={"message": "OK"})

@upload_router.options("/tasks/analyze/remote")
def options_remote():
    return JSONResponse(content={"message": "OK"})

@upload_router.post("/tasks/analyze/remote", summary="Start analysis from a remote image URL")
async def analyze_remote_image(
    background_tasks: BackgroundTasks,
    remote_url: str = Form(...),
    image_type: str = Form("regular"),
    geospatial_crs: str = Form("EPSG:4326"),
    use_geo_metadata: bool = Form(False),
    pixel_scale_meters: float = Form(1.0),
    ref_latitude: float = Form(0.0),
    ref_longitude: float = Form(0.0),
    sam_use_fallback: bool = Form(False),
    sam_min_mask_region_area: int = Form(500),
    sam_points_per_side: int = Form(16),
    sam_pred_iou_thresh: float = Form(0.86),
    sam_stability_score_thresh: float = Form(0.85)
):
    try:
        download_url = normalize_remote_url(remote_url)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        response = requests.get(download_url, stream=True, headers=headers, timeout=30)
        
        # Google Drive confirm token prompt handling
        if response.ok and "txt/html" in response.headers.get("content-type", "").lower():
            confirm_url = _extract_google_drive_download_url(response.text, download_url)
            if confirm_url:
                response = requests.get(confirm_url, stream=True, headers=headers, timeout=30)
                
        if not response.ok:
            raise HTTPException(status_code=400, detail=f"Failed to fetch image from URL. Status: {response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error accessing remote URL: {str(e)}")

    remote_filename = choose_remote_filename(remote_url, response) or "remote_image.png"
    _, ext = os.path.splitext(remote_filename)
    
    task_id = f"task_{uuid.uuid4().hex[:8]}"
    temp_file_name = f"task_{task_id}{ext}"
    temp_file_path = os.path.join(UPLOAD_DIR, temp_file_name)

    sha256_hash = hashlib.sha256()
    try:
        with open(temp_file_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    sha256_hash.update(chunk)
    except Exception as e:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        raise HTTPException(status_code=500, detail=f"Failed to save remote image: {str(e)}")

    file_hash = sha256_hash.hexdigest()
    existing_task = memory.get_completed_task_by_hash(file_hash)
    if existing_task:
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except Exception:
            pass
        return {
            "message": "تم العثور على نتيجة سابقة لنفس الصورة.",
            "task_id": existing_task["task_id"],
            "status": "COMPLETED",
            "cached": True
        }

    final_image_type = image_type
    detected_crs = geospatial_crs
    if rasterio is not None and ext.lower() in [".tif", ".tiff", ".geotiff"]:
        try:
            with rasterio.open(temp_file_path) as dataset:
                if dataset.crs is not None:
                    final_image_type = "geospatial"
                    detected_crs = str(dataset.crs)
        except Exception:
            pass

    task_metadata = {
        "image_type": final_image_type,
        "geospatial_crs": detected_crs,
        "use_geo_metadata": use_geo_metadata,
        "pixel_scale_meters": pixel_scale_meters,
        "ref_latitude": ref_latitude,
        "ref_longitude": ref_longitude,
        "sam_use_fallback": sam_use_fallback,
        "sam_min_mask_region_area": sam_min_mask_region_area,
        "sam_points_per_side": sam_points_per_side,
        "sam_pred_iou_thresh": sam_pred_iou_thresh,
        "sam_stability_score_thresh": sam_stability_score_thresh
    }

    created = memory.create_task(task_id, temp_file_path, task_metadata, image_hash=file_hash)
    if not created:
        raise HTTPException(status_code=500, detail="Failed to create task record.")

    launch_background_processing(task_id, temp_file_path)

    return {
        "message": "تم سحب الصورة من الرابط بنجاح وجاري تحليلها بالذكاء الاصطناعي.",
        "task_id": task_id,
        "status": "PENDING"
    }

@upload_router.post("/tasks/analyze", summary="1. بدء تحليل الصورة عبر فريق الوكلاء")
async def analyze_image_with_agents(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="الصورة الجوية المراد تحليلها"),
    image_type: str = Form("regular"),
    geospatial_crs: str = Form("EPSG:4326"),
    use_geo_metadata: bool = Form(False),
    pixel_scale_meters: float = Form(1.0),
    ref_latitude: float = Form(0.0),
    ref_longitude: float = Form(0.0),
    sam_use_fallback: bool = Form(False),
    sam_min_mask_region_area: int = Form(500),
    sam_points_per_side: int = Form(16),
    sam_pred_iou_thresh: float = Form(0.86),
    sam_stability_score_thresh: float = Form(0.85),
    tfw_content: str = Form("")
):
    _, ext = os.path.splitext(file.filename)
    task_id = f"task_{uuid.uuid4().hex[:8]}"
    temp_file_name = f"task_{task_id}{ext}"
    temp_file_path = os.path.join(UPLOAD_DIR, temp_file_name)

    sha256_hash = hashlib.sha256()
    try:
        with open(temp_file_path, "wb") as f:
            while chunk := await file.read(8192):
                f.write(chunk)
                sha256_hash.update(chunk)
    except Exception as e:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        raise HTTPException(status_code=500, detail=f"تعذر حفظ الملف المرفوع: {str(e)}")

    if tfw_content:
        base_path, _ = os.path.splitext(temp_file_path)
        with open(base_path + ".tfw", "w", encoding="utf-8") as wf:
            wf.write(tfw_content)

    file_hash = sha256_hash.hexdigest()
    
    existing_task = memory.get_completed_task_by_hash(file_hash)
    if existing_task:
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except Exception:
            pass
        return {
            "message": "تم العثور على نتيجة سابقة لنفس الصورة.",
            "task_id": existing_task["task_id"],
            "status": "COMPLETED",
            "cached": True
        }

    final_image_type = image_type
    detected_crs = geospatial_crs
    if rasterio is not None and ext.lower() in [".tif", ".tiff", ".geotiff"]:
        try:
            with rasterio.open(temp_file_path) as dataset:
                if dataset.crs is not None:
                    final_image_type = "geospatial"
                    detected_crs = str(dataset.crs)
        except Exception:
            pass

    task_metadata = {
        "image_type": final_image_type,
        "geospatial_crs": detected_crs,
        "use_geo_metadata": use_geo_metadata,
        "pixel_scale_meters": pixel_scale_meters,
        "ref_latitude": ref_latitude,
        "ref_longitude": ref_longitude,
        "sam_use_fallback": sam_use_fallback,
        "sam_min_mask_region_area": sam_min_mask_region_area,
        "sam_points_per_side": sam_points_per_side,
        "sam_pred_iou_thresh": sam_pred_iou_thresh,
        "sam_stability_score_thresh": sam_stability_score_thresh
    }

    created = memory.create_task(task_id, temp_file_path, task_metadata, image_hash=file_hash)
    if not created:
        raise HTTPException(status_code=500, detail="Failed to create task.")

    launch_background_processing(task_id, temp_file_path)

    return {
        "message": "تم استلام الصورة وجاري تحليلها بالذكاء الاصطناعي في الخلفية.",
        "task_id": task_id,
        "status": "PENDING"
    }

# --- Tiles and KML endpoints ---

@upload_router.get("/crop/from_tiles", summary="قص من مصدر بلاطات (XYZ/WMTS) عبر تركيب البلاطات")
def crop_from_tiles(
    tile_template: str,
    zoom: int,
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    tile_size: int = 256
):
    if rasterio is None:
        raise HTTPException(status_code=500, detail="Rasterio مطلوب لإنشاء GeoTIFF من البلاطات.")

    try:
        min_lon_val = min(min_lon, max_lon)
        max_lon_val = max(min_lon, max_lon)
        min_lat_val = min(min_lat, max_lat)
        max_lat_val = max(min_lat, max_lat)

        tile_list = list(mercantile.tiles(min_lon_val, min_lat_val, max_lon_val, max_lat_val, zoom))
        if not tile_list:
            raise ValueError("لم يتم العثور على بلاطات تغطي المنطقة عند zoom المحدد.")

        xs = [t.x for t in tile_list]
        ys = [t.y for t in tile_list]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        cols = max_x - min_x + 1
        rows = max_y - min_y + 1

        canvas_w = cols * tile_size
        canvas_h = rows * tile_size
        canvas = PILImage.new("RGBA", (canvas_w, canvas_h))

        for tile in tile_list:
            url = tile_template.format(z=zoom, x=tile.x, y=tile.y)
            try:
                headers = {"User-Agent": "Mozilla/5.0"}
                resp = requests.get(url, headers=headers, timeout=10)
                resp.raise_for_status()
                img = PILImage.open(io.BytesIO(resp.content)).convert("RGBA")
            except Exception:
                img = PILImage.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))

            px = (tile.x - min_x) * tile_size
            py = (tile.y - min_y) * tile_size
            canvas.paste(img, (px, py))

        transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
        x_min, y_min = transformer.transform(min_lon_val, min_lat_val)
        x_max, y_max = transformer.transform(max_lon_val, max_lat_val)

        b_min = mercantile.xy_bounds(min_x, max_y, zoom)
        b_max = mercantile.xy_bounds(max_x, min_y, zoom)
        
        tile_left = b_min.left
        tile_bottom = b_min.bottom
        tile_right = b_max.right
        tile_top = b_max.top

        res_x = (tile_right - tile_left) / canvas_w
        res_y = (tile_top - tile_bottom) / canvas_h

        px_left = max(0, int(round((x_min - tile_left) / res_x)))
        px_right = min(canvas_w, int(round((x_max - tile_left) / res_x)))
        px_top = max(0, int(round((tile_top - y_max) / res_y)))
        px_bottom = min(canvas_h, int(round((tile_top - y_min) / res_y)))

        if px_right <= px_left:
            px_right = px_left + 1
        if px_bottom <= px_top:
            px_bottom = px_top + 1

        cropped_canvas = canvas.crop((px_left, px_top, px_right, px_bottom))
        out_w, out_h = cropped_canvas.size

        left = tile_left + px_left * res_x
        top = tile_top - px_top * res_y
        right = tile_left + px_right * res_x
        bottom = tile_top - px_bottom * res_y

        res_x_cropped = (right - left) / out_w
        res_y_cropped = (top - bottom) / out_h
        out_transform = rasterio.transform.from_origin(left, top, res_x_cropped, res_y_cropped)

        arr = np.array(cropped_canvas)
        if arr.ndim == 3 and arr.shape[2] >= 3:
            rgb = arr[:, :, :3]
        else:
            rgb = np.stack([arr, arr, arr], axis=-1)

        rgb = np.moveaxis(rgb, -1, 0)

        out_name = f"tiles_crop_{uuid.uuid4().hex[:8]}.tiff"
        out_path = os.path.join(UPLOAD_DIR, out_name)

        profile = {
            "driver": "GTiff",
            "dtype": "uint8",
            "count": rgb.shape[0],
            "height": out_h,
            "width": out_w,
            "transform": out_transform,
            "crs": "EPSG:3857",
            "compress": "LZW",
            "tiled": True
        }

        with rasterio.open(out_path, "wb", **profile) as dst:
            dst.write(rgb)

        return FileResponse(out_path, media_type="image/tiff", filename=out_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل تركيب البلاطات وتصدير GeoTIFF: {str(e)}")

@upload_router.get("/crop/analyze_from_tiles", summary="تحليل من مصدر بلاطات (XYZ/WMTS) عبر تركيب البلاطات وتوليد ملف GeoJSON للمستخدم")
def analyze_from_tiles(
    tile_template: str,
    zoom: int,
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    tile_size: int = 256
):
    if rasterio is None:
        raise HTTPException(status_code=500, detail="Rasterio مطلوب لإنشاء GeoTIFF من البلاطات.")

    try:
        min_lon_val = min(min_lon, max_lon)
        max_lon_val = max(min_lon, max_lon)
        min_lat_val = min(min_lat, max_lat)
        max_lat_val = max(min_lat, max_lat)

        tile_list = list(mercantile.tiles(min_lon_val, min_lat_val, max_lon_val, max_lat_val, zoom))
        if not tile_list:
            raise ValueError("لم يتم العثور على بلاطات تغطي المنطقة عند zoom المحدد.")

        xs = [t.x for t in tile_list]
        ys = [t.y for t in tile_list]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        cols = max_x - min_x + 1
        rows = max_y - min_y + 1

        canvas_w = cols * tile_size
        canvas_h = rows * tile_size
        canvas = PILImage.new("RGBA", (canvas_w, canvas_h))

        for tile in tile_list:
            url = tile_template.format(z=zoom, x=tile.x, y=tile.y)
            try:
                headers = {"User-Agent": "Mozilla/5.0"}
                resp = requests.get(url, headers=headers, timeout=10)
                resp.raise_for_status()
                img = PILImage.open(io.BytesIO(resp.content)).convert("RGBA")
            except Exception:
                img = PILImage.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))

            px = (tile.x - min_x) * tile_size
            py = (tile.y - min_y) * tile_size
            canvas.paste(img, (px, py))

        transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
        x_min, y_min = transformer.transform(min_lon_val, min_lat_val)
        x_max, y_max = transformer.transform(max_lon_val, max_lat_val)

        b_min = mercantile.xy_bounds(min_x, max_y, zoom)
        b_max = mercantile.xy_bounds(max_x, min_y, zoom)
        
        tile_left = b_min.left
        tile_bottom = b_min.bottom
        tile_right = b_max.right
        tile_top = b_max.top

        res_x = (tile_right - tile_left) / canvas_w
        res_y = (tile_top - tile_bottom) / canvas_h

        px_left = max(0, int(round((x_min - tile_left) / res_x)))
        px_right = min(canvas_w, int(round((x_max - tile_left) / res_x)))
        px_top = max(0, int(round((tile_top - y_max) / res_y)))
        px_bottom = min(canvas_h, int(round((tile_top - y_min) / res_y)))

        if px_right <= px_left:
            px_right = px_left + 1
        if px_bottom <= px_top:
            px_bottom = px_top + 1

        cropped_canvas = canvas.crop((px_left, px_top, px_right, px_bottom))
        out_w, out_h = cropped_canvas.size

        left = tile_left + px_left * res_x
        top = tile_top - px_top * res_y
        right = tile_left + px_right * res_x
        bottom = tile_top - px_bottom * res_y

        res_x_cropped = (right - left) / out_w
        res_y_cropped = (top - bottom) / out_h
        out_transform = rasterio.transform.from_origin(left, top, res_x_cropped, res_y_cropped)

        arr = np.array(cropped_canvas)
        if arr.ndim == 3 and arr.shape[2] >= 3:
            rgb = arr[:, :, :3]
        else:
            rgb = np.stack([arr, arr, arr], axis=-1)

        rgb = np.moveaxis(rgb, -1, 0)

        out_name = f"tiles_crop_{uuid.uuid4().hex[:8]}.tiff"
        out_path = os.path.join(UPLOAD_DIR, out_name)

        profile = {
            "driver": "GTiff",
            "dtype": "uint8",
            "count": rgb.shape[0],
            "height": out_h,
            "width": out_w,
            "transform": out_transform,
            "crs": "EPSG:3857",
            "compress": "LZW",
            "tiled": True
        }

        with rasterio.open(out_path, "wb", **profile) as dst:
            dst.write(rgb)

        task_id = "task_" + uuid.uuid4().hex[:8]
        file_hash = hashlib.sha256(open(out_path, "rb").read()).hexdigest()
        
        task_metadata = {
            "image_type": "geospatial",
            "geospatial_crs": "EPSG:3857",
            "use_geo_metadata": True,
            "pixel_scale_meters": 0.5,
            "ref_latitude": min_lat,
            "ref_longitude": min_lon
        }
        
        created = memory.create_task(task_id, out_path, task_metadata, image_hash=file_hash)
        if created:
            memory.update_task_status(task_id, "PENDING")
            launch_background_processing(task_id, out_path)
            return {"task_id": task_id, "status": "PENDING"}
        else:
            raise HTTPException(status_code=500, detail="Failed to create task")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل تركيب البلاطات وتصدير GeoTIFF: {str(e)}")

def extract_coords_from_geojson(obj, lons, lats):
    if isinstance(obj, list):
        if len(obj) == 2 and isinstance(obj[0], (int, float)) and isinstance(obj[1], (int, float)):
            lons.append(float(obj[0]))
            lats.append(float(obj[1]))
        else:
            for item in obj:
                extract_coords_from_geojson(item, lons, lats)
    elif isinstance(obj, dict):
        for val in obj.values():
            extract_coords_from_geojson(val, lons, lats)

def extract_bbox_from_file(filename: str, content: bytes) -> tuple:
    ext = os.path.splitext(filename)[1].lower()
    lons = []
    lats = []
    
    if ext == ".geojson" or ext == ".json":
        try:
            import json
            data = json.loads(content.decode("utf-8", errors="ignore"))
            extract_coords_from_geojson(data, lons, lats)
        except Exception as e:
            raise ValueError(f"فشل قراءة ملف GeoJSON: {str(e)}")
    elif ext in [".kml", ".xml"]:
        try:
            text = content.decode("utf-8", errors="ignore")
            import re
            coords_text = re.findall(r"<coordinates>(.*?)</coordinates>", text, re.DOTALL)
            for block in coords_text:
                for pt_str in block.strip().split():
                    parts = pt_str.split(",")
                    if len(parts) >= 2:
                        try:
                            lons.append(float(parts[0]))
                            lats.append(float(parts[1]))
                        except ValueError:
                            continue
        except Exception as e:
            raise ValueError(f"فشل قراءة ملف KML: {str(e)}")
    else:
        raise ValueError("صيغة الملف غير مدعومة. يجب أن يكون .kml أو .geojson")
        
    if not lons or not lats:
        raise ValueError("لم يتم العثور على أي إحداثيات صالحة في الملف المرفوع.")
        
    return min(lons), min(lats), max(lons), max(lats)

@upload_router.post("/tasks/analyze/kml", summary="إنشاء مهمة تحليل جديدة عبر رفع ملف KML أو GeoJSON")
async def analyze_from_kml(
    file: UploadFile = File(...),
    zoom: int = Form(18),
    tile_template: str = Form("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"),
    country: str = Form("Yemen"),
    sam_use_fallback: bool = Form(True),
    sam_min_mask_region_area: int = Form(150),
    sam_points_per_side: int = Form(32),
    sam_pred_iou_thresh: float = Form(0.60),
    sam_stability_score_thresh: float = Form(0.50)
):
    if rasterio is None:
        raise HTTPException(status_code=500, detail="Rasterio غير متوفر على الخادم.")
        
    try:
        content = await file.read()
        min_lon, min_lat, max_lon, max_lat = extract_bbox_from_file(file.filename, content)
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء قراءة الملف الجغرافي: {str(e)}")

    task_id = f"task_{uuid.uuid4().hex[:8]}"
    
    try:
        tile_list = list(mercantile.tiles(min_lon, min_lat, max_lon, max_lat, zoom))
        if not tile_list:
            raise ValueError("لم يتم العثور على بلاطات تغطي المنطقة المحددة عند هذا الزوم.")
            
        MAX_TILES = 500
        if len(tile_list) > MAX_TILES:
            raise ValueError(f"المنطقة المحددة كبيرة جداً (تحتوي على {len(tile_list)} بلاطة، الحد الأقصى هو {MAX_TILES}). يرجى تقليل الزوم أو اختيار منطقة أصغر.")

        xs = [t.x for t in tile_list]
        ys = [t.y for t in tile_list]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        cols = max_x - min_x + 1
        rows = max_y - min_y + 1
        tile_size = 256

        canvas_w = cols * tile_size
        canvas_h = rows * tile_size
        
        canvas = PILImage.new("RGBA", (canvas_w, canvas_h))

        for tile in tile_list:
            url = tile_template.format(z=zoom, x=tile.x, y=tile.y)
            try:
                headers = {"User-Agent": "Mozilla/5.0"}
                resp = requests.get(url, headers=headers, timeout=10)
                resp.raise_for_status()
                img = PILImage.open(io.BytesIO(resp.content)).convert("RGBA")
            except Exception:
                img = PILImage.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))

            px = (tile.x - min_x) * tile_size
            py = (tile.y - min_y) * tile_size
            canvas.paste(img, (px, py))

        from pyproj import Transformer
        transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
        x_min, y_min = transformer.transform(min_lon, min_lat)
        x_max, y_max = transformer.transform(max_lon, max_lat)

        b_min = mercantile.xy_bounds(min_x, max_y, zoom)
        b_max = mercantile.xy_bounds(max_x, min_y, zoom)
        
        tile_left = b_min.left
        tile_bottom = b_min.bottom
        tile_right = b_max.right
        tile_top = b_max.top

        res_x = (tile_right - tile_left) / canvas_w
        res_y = (tile_top - tile_bottom) / canvas_h

        px_left = max(0, int(round((x_min - tile_left) / res_x)))
        px_right = min(canvas_w, int(round((x_max - tile_left) / res_x)))
        px_top = max(0, int(round((tile_top - y_max) / res_y)))
        px_bottom = min(canvas_h, int(round((tile_top - y_min) / res_y)))

        if px_right <= px_left:
            px_right = px_left + 1
        if px_bottom <= px_top:
            px_bottom = px_top + 1

        cropped_canvas = canvas.crop((px_left, px_top, px_right, px_bottom))
        out_w, out_h = cropped_canvas.size

        left = tile_left + px_left * res_x
        top = tile_top - px_top * res_y
        right = tile_left + px_right * res_x
        bottom = tile_top - px_bottom * res_y

        res_x_cropped = (right - left) / out_w
        res_y_cropped = (top - bottom) / out_h
        out_transform = rasterio.transform.from_origin(left, top, res_x_cropped, res_y_cropped)

        arr = np.array(cropped_canvas)
        if arr.ndim == 3 and arr.shape[2] >= 3:
            rgb = arr[:, :, :3]
        else:
            rgb = np.stack([arr, arr, arr], axis=-1)

        rgb = np.moveaxis(rgb, -1, 0)

        out_name = f"task_{task_id}.tiff"
        out_path = os.path.join(UPLOAD_DIR, out_name)

        profile = {
            "driver": "GTiff",
            "dtype": "uint8",
            "count": rgb.shape[0],
            "height": out_h,
            "width": out_w,
            "transform": out_transform,
            "crs": "EPSG:3857",
            "compress": "LZW",
            "tiled": True
        }

        with rasterio.open(out_path, "w", **profile) as dst:
            dst.write(rgb)

    except Exception as stitch_err:
        raise HTTPException(status_code=500, detail=f"فشل تنزيل أو تركيب بلاطات القمر الصناعي: {str(stitch_err)}")

    task_metadata = {
        "image_type": "geospatial",
        "geospatial_crs": "EPSG:3857",
        "use_geo_metadata": True,
        "pixel_scale_meters": 0.5,
        "ref_latitude": float((min_lat + max_lat) / 2),
        "ref_longitude": float((min_lon + max_lon) / 2),
        "sam_use_fallback": sam_use_fallback,
        "sam_min_mask_region_area": sam_min_mask_region_area,
        "sam_points_per_side": sam_points_per_side,
        "sam_pred_iou_thresh": sam_pred_iou_thresh,
        "sam_stability_score_thresh": sam_stability_score_thresh,
        "zoom": zoom,
        "tile_template": tile_template
    }

    created = memory.create_task(task_id, out_path, task_metadata, image_hash=None)
    if not created:
        raise HTTPException(status_code=500, detail="فشل إنشاء سجل المهمة في قاعدة البيانات.")

    launch_background_processing(task_id, out_path)

    return {
        "message": "تم استلام الملف الجغرافي وجلب صور المنطقة وجاري معالجتها بالذكاء الاصطناعي في الخلفية.",
        "task_id": task_id,
        "status": "PENDING",
        "bbox": {
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat
        }
    }
