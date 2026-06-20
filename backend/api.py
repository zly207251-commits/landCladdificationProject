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

rasterio_spec = importlib.util.find_spec('rasterio')
rasterio = importlib.import_module('rasterio') if rasterio_spec is not None else None

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
    ref_longitude: float = Form(44.1910, description="إحداثي خط الطول لنقطة المرجع المساحية")
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
    
    try:
        content = await file.read()
        with open(temp_file_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"تعذر حفظ الملف المرفوع: {str(e)}")
        
    # 3. تسجيل المهمة في قاعدة بيانات الذاكرة المشتركة (SQLite) بوضعية PENDING
    task_metadata = {
        "image_type": image_type,
        "geospatial_crs": geospatial_crs,
        "use_geo_metadata": use_geo_metadata,
        "pixel_scale_meters": pixel_scale_meters,
        "ref_latitude": ref_latitude,
        "ref_longitude": ref_longitude
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
    