from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse
import uvicorn
import numpy as np
import cv2
import io
import uuid
import os

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
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
        "pixel_scale_meters": pixel_scale_meters,
        "ref_latitude": ref_latitude,
        "ref_longitude": ref_longitude
    }
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
        
    return {
        "task_id": task_id,
        "status": task["status"],
        "image_path": task["image_path"],
        "metadata": task["metadata"],
        "layers": report_layers
    }

@app.get("/tasks/{task_id}/logs", summary="4. جلب السجل الحقيقي للمراسلات بين الوكلاء")
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
