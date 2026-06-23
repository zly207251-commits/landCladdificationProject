from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse, FileResponse
import uvicorn
import numpy as np
import cv2
import io
import uuid
import os
import mimetypes
import importlib.util
from pydantic import BaseModel
from PIL import Image
import requests
import mercantile
from pyproj import Transformer

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

app = FastAPI(
    title="نظام فريق وكلاء التحليل الجغرافي (Geo-AI Swarm)",
    description="واجهة برمجية للتحليل المساحي الذكي للصور الجوية وإسقاط المساحات بالفدان والقيراط والسهم.",
    version="2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# تهيئة قاعدة بيانات الذاكرة المشتركة وباص الرسائل
DB_PATH = "shared_memory.db"
memory = SharedMemory(db_path=DB_PATH)
message_bus = MessageBus(memory)

# تهيئة وكيل SAM الموروث (سيتم استدعاؤه بشكل منفصل)
segmenter = LandSegmenterSAM()

# إنشاء مجلد مؤقت لحفظ الصور المرفوعة للتحليل
UPLOAD_DIR = "temp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


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


def run_agent_swarm_background(task_id: str, image_path: str):
    """دالة تُنفذ في الخلفية لتشغيل تدفق الوكلاء عبر LangGraph دون إيقاف الواجهة."""
    try:
        # بناء وتشغيل الرسم البياني للوكلاء
        compiled_graph = create_swarm_graph(memory, message_bus, segmenter)
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
        message_bus.publish(
            task_id=task_id,
            sender="system",
            message_type="ERROR",
            content=f"حدث خطأ أثناء تشغيل تدفق الوكلاء: {str(e)}"
        )
        memory.update_task_status(task_id, "FAILED")

# --- نهايات الاتصال الخاصة بالوكلاء (Agent Swarm Endpoints) ---

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
    sam_points_per_side: int = Form(16, description='عدد نقاط SAM لكل جانب لإنشاء الأقنعة'),
    sam_pred_iou_thresh: float = Form(0.45, description='عتبة IoU لنموذج SAM'),
    sam_stability_score_thresh: float = Form(0.30, description='عتبة ثبات قناع SAM')
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
    
    # Stream-write the uploaded file in chunks and enforce a max upload size
    MAX_UPLOAD_BYTES = 1 * 1024 * 1024 * 1024  # 1 GB
    size = 0
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
    }

    if image_type == 'geospatial' and use_geo_metadata:
        geo_metadata = get_geotiff_metadata(temp_file_path)
        if geo_metadata:
            task_metadata['geo_metadata'] = geo_metadata

    memory.create_task(task_id, temp_file_path, task_metadata)
    
    # 4. إطلاق تدفق الوكلاء كعملية في الخلفية لمنع تعليق الطلب
    background_tasks.add_task(run_agent_swarm_background, task_id, temp_file_path)
    
    return {
        "message": "تم استلام الطلب وبدء تشغيل فريق الوكلاء بنجاح.",
        "task_id": task_id,
        "status": "PENDING"
    }

@app.get("/tasks/{task_id}/status", summary="2. الاستعلام عن حالة المهمة")
def get_task_status(task_id: str):
    """
    الاستعلام عن حالة المهمة لمعرفة ما إذا كانت معلقة، قيد التنفيذ، مكتملة، أو فشلت.
    """
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
    return {
        "task_id": task_id,
        "status": task["status"],
        "updated_at": task["updated_at"]
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

        # Compute bounds in EPSG:3857 by transforming tile corner bounds
        transformer = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
        lefts = []
        rights = []
        bottoms = []
        tops = []
        for tx in (min_x, max_x + 1):
            for ty in (min_y, max_y + 1):
                b = mercantile.bounds(tx, ty, zoom)
                # bounds returns west,south,east,north in lon/lat
                west, south, east, north = b.west, b.south, b.east, b.north
                x1, y1 = transformer.transform(west, south)
                x2, y2 = transformer.transform(east, north)
                lefts.append(min(x1, x2))
                rights.append(max(x1, x2))
                bottoms.append(min(y1, y2))
                tops.append(max(y1, y2))

        left = min(lefts)
        right = max(rights)
        bottom = min(bottoms)
        top = max(tops)

        # Compute transform
        res_x = (right - left) / canvas_w
        res_y = (top - bottom) / canvas_h
        out_transform = rasterio.transform.from_origin(left, top, res_x, res_y)

        # Convert canvas to numpy array and write as GeoTIFF (RGB)
        arr = np.array(canvas)
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
            'height': canvas_h,
            'width': canvas_w,
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
    polygons = segmenter.segment_image(img)

    # رسم الحدود على الصورة
    for poly in polygons:
        pts = poly.astype(np.int32)
        cv2.polylines(img, [pts], True, (0, 255, 0), 2)

    # إخراج الصورة
    _, buffer = cv2.imencode(".png", img)
    return StreamingResponse(io.BytesIO(buffer.tobytes()), media_type="image/png")

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
    