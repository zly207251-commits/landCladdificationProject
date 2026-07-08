import os
from celery_app import celery_app
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.graph import create_swarm_graph
from land_classifier import LandSegmenterSAM

# تحميل الكاش الجغرافي بشكل كسول (Lazy loading) لتخفيف استهلاك الذاكرة عند الاستيراد
_segmenter = None

def get_segmenter():
    global _segmenter
    if _segmenter is None:
        _segmenter = LandSegmenterSAM()
    return _segmenter

@celery_app.task(name="tasks.process_image_segmentation")
def process_image_segmentation(task_id: str, image_path: str):
    """مهمة Celery موزعة لتشغيل معالجة SAM وإسقاط الأراضي في الخلفية."""
    print(f"🚀 [Celery] البدء في معالجة المهمة الموزعة: {task_id}")
    
    # تهيئة اتصال الذاكرة الجغرافية المكانية وباص الرسائل
    db_path = os.getenv("BACKEND_DB_PATH", "shared_memory.db")
    memory = SharedMemory(db_path=db_path)
    message_bus = MessageBus(memory)
    
    try:
        # تشغيل الوكيل وتمرير معالج SAM الموزع
        compiled_graph = create_swarm_graph(memory, message_bus, get_segmenter())
        initial_state = {
            "task_id": task_id,
            "image_path": image_path,
            "messages": [],
            "completed_specialists": [],
            "next_agent": "coordinator"
        }
        
        # تنفيذ الخطوات المكانية والإسقاط
        compiled_graph.invoke(initial_state)
        print(f"✔️ [Celery] تم الانتهاء بنجاح من معالجة المهمة: {task_id}")
        return {"status": "SUCCESS", "task_id": task_id}
        
    except Exception as e:
        error_msg = f"حدث خطأ أثناء تشغيل تدفق الوكلاء الموزع: {str(e)}"
        print(f"❌ [Celery] خطأ في المهمة {task_id}: {error_msg}")
        message_bus.publish(
            task_id=task_id,
            sender="system",
            message_type="ERROR",
            content=error_msg
        )
        memory.update_task_status(task_id, "FAILED")
        raise e
