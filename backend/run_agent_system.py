import os
import sqlite3
import json
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.graph import create_swarm_graph

def run_verification():
    """سكربت تشغيل رئيسي للتحقق من سلامة البنية التحتية الخلفية وتدفق الوكلاء."""
    # 1. تنظيف ملف قاعدة البيانات للبدء ببيئة فحص جديدة ونظيفة
    db_name = "shared_memory.db"
    if os.path.exists(db_name):
        try:
            os.remove(db_name)
            print("🧹 تم تنظيف وإعادة تعيين قاعدة البيانات shared_memory.db لضمان دقة الفحص.")
        except Exception as e:
            print(f"⚠️ تعذر حذف قاعدة البيانات القديمة: {e}")
            
    # 2. تهيئة واجهة الذاكرة المشتركة وباص الرسائل
    memory = SharedMemory(db_path=db_name)
    message_bus = MessageBus(memory)
    
    # تعريف دالة التقاط الأحداث (Hook) لمتابعة البث الحي للرسائل في الطرفية
    def live_event_hook(event):
        print(f"💬 [حدث مباشر] [{event['sender'].upper()}] -> {event['content']}")
        
    # تسجيل التقاط الأحداث العام باستخدام علامة النجمة *
    message_bus.subscribe("*", live_event_hook)
    
    # 3. إنشاء مهمة فحص تجريبية بمعاملات مساحية (صنعاء، اليمن كمثال)
    task_id = "task_demo_001"
    image_path = "e:/الاوقاف/LandClassificationProject/mock_satellite_image.png"
    task_metadata = {
        "pixel_scale_meters": 0.5,  # دقة البكسل: 1 بكسل يمثل 0.5 متر
        "ref_latitude": 15.3694,    # إحداثيات خط العرض
        "ref_longitude": 44.1910    # إحداثيات خط الطول
    }
    
    print("\n🚀 تسجيل طلب التحليل والمهمة في الذاكرة المشتركة...")
    memory.create_task(task_id, image_path, task_metadata)
    
    # 4. بناء وتجميع الرسم البياني للوكلاء باستخدام LangGraph
    print("🏗️ بناء الرسم البياني (StateGraph) لتنسيق فريق الوكلاء...")
    segmenter = LandSegmenterSAM(fail_fast=False)
    compiled_graph = create_swarm_graph(memory, message_bus, segmenter)
    
    # 5. تشغيل الرسم البياني عبر إدخال الحالة الابتدائية
    print("\n🏁 بدء تشغيل تدفق فريق الوكلاء...")
    initial_state = {
        "task_id": task_id,
        "image_path": image_path,
        "messages": [],
        "completed_specialists": [],
        "next_agent": "coordinator"
    }
    
    final_state = compiled_graph.invoke(initial_state)
    print("\n🏁 اكتمل تشغيل وتدفق فريق الوكلاء بالكامل!")
    
    # 6. قراءة وعرض البيانات والطبقات والمساحات من قاعدة البيانات SQLite
    print("\n" + "="*80)
    print("📊 تقرير البيانات النهائي المستخرج من الذاكرة المشتركة (SQLite)")
    print("="*80)
    
    # معلومات المهمة
    task = memory.get_task(task_id)
    print(f"معرف المهمة: {task['task_id']}")
    print(f"الحالة النهائية للمهمة: {task['status']}")
    print(f"مسار الصورة الجوية:  {task['image_path']}")
    print(f"ميتا الإسقاط الجغرافي: {json.dumps(task['metadata'])}")
    print("-"*80)
    
    # عرض المساحات المحسوبة بالفدان والقيراط والسهم لكل طبقة
    print("📐 تفاصيل الطبقات المساحية والتقييم الهندسي:")
    layers = memory.get_task_layers(task_id)
    for layer in layers:
        print(f"\n🔹 الطبقة الجغرافية: {layer['layer_name'].upper()}")
        print(f"   • المساحة الإجمالية: {layer['area_sq_meters']:.2f} م²")
        print(f"   • حساب الوحدات الزراعية: {layer['area_feddan']} فدان، {layer['area_qirat']} قيراط، {layer['area_sahm']:.2f} سهم")
        print(f"   • الوصف المرفق:      {layer['metadata'].get('description', 'لا يوجد')}")
        if layer['metadata'].get('local_classification'):
            local_info = layer['metadata']['local_classification']
            print(f"   • التصنيف المحلي للأوقاف: {local_info.get('class_name')} | {local_info.get('soil_type')}")
            
    print("="*80 + "\n")
    
    # 7. عرض سجل الأحداث التاريخي والمراسلات بشكل منسق في الطرفية
    message_bus.display_pretty_logs(task_id)

if __name__ == "__main__":
    run_verification()
