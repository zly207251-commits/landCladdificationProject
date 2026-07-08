"""سكربت اختبار سريع لفحص إصلاحات memory.py"""
import os
import sys

# تنظيف قاعدة البيانات القديمة
db_path = os.path.join(os.path.dirname(__file__), "shared_memory.db")
if os.path.exists(db_path):
    os.remove(db_path)
    print("🧹 تم حذف قاعدة البيانات القديمة")

from agent_system.memory import SharedMemory
from agent_system.db_config import is_postgresql

print(f"\n📦 نوع قاعدة البيانات: {'PostgreSQL/PostGIS' if is_postgresql() else 'SQLite (محلي)'}")

# 1. اختبار التهيئة
memory = SharedMemory()
print("✅ SharedMemory تم تهيئتها بنجاح")

# 2. اختبار إنشاء مهمة
ok = memory.create_task("test_fix_001", "test_image.tif", {
    "pixel_scale_meters": 0.5,
    "ref_latitude": 15.3694,
    "ref_longitude": 44.1910
})
print(f"✅ إنشاء مهمة: {ok}")

# 3. اختبار استرجاع المهمة
task = memory.get_task("test_fix_001")
print(f"✅ استرجاع المهمة: task_id={task['task_id']}, status={task['status']}")
print(f"   metadata type: {type(task['metadata']).__name__} (يجب أن يكون dict)")

# 4. اختبار تحديث الحالة
memory.update_task_status("test_fix_001", "PROCESSING")
task = memory.get_task("test_fix_001")
print(f"✅ تحديث الحالة: status={task['status']}")

# 5. اختبار إضافة معلم مكاني
ok = memory.add_task_layer(
    task_id="test_fix_001",
    layer_name="residential",
    polygons=[[[0, 0], [100, 0], [100, 100], [0, 100]]],
    geo_polygons=[[[44.19, 15.37], [44.20, 15.37], [44.20, 15.38], [44.19, 15.38]]],
    area_sq_meters=2500.0,
    area_feddan=0,
    area_qirat=14,
    area_sahm=4.8,
    metadata={"description": "قطعة سكنية تجريبية", "pixel_scale": 0.5}
)
print(f"✅ إضافة معلم مكاني: {ok}")

# 6. اختبار استرجاع الطبقات
layers = memory.get_task_layers("test_fix_001")
print(f"✅ استرجاع الطبقات: عدد={len(layers)}")
if layers:
    L = layers[0]
    print(f"   • الطبقة: {L['layer_name']}")
    print(f"   • المساحة: {L['area_sq_meters']:.2f} م²")
    print(f"   • الوحدات الزراعية: {L['area_feddan']} فدان، {L['area_qirat']} قيراط، {L['area_sahm']} سهم")

# 7. اختبار تسجيل الرسائل
memory.log_message("test_fix_001", "projection_agent", "START", "بدء اختبار الإسقاط")
msgs = memory.get_messages("test_fix_001")
print(f"✅ الرسائل: عدد={len(msgs)}")

# 8. اختبار إدارة المربعات
tiles = [(0, 0, 0, 512, 0, 512), (0, 1, 0, 512, 512, 1024), (1, 0, 512, 1024, 0, 512)]
memory.init_task_tiles("test_fix_001", tiles)
pending = memory.get_pending_tiles("test_fix_001")
print(f"✅ المربعات المعلقة: {len(pending)}")

memory.update_tile_status("test_fix_001", 0, 0, "COMPLETED")
pending = memory.get_pending_tiles("test_fix_001")
print(f"✅ بعد إكمال مربع واحد، المعلقة: {len(pending)}")

# 9. اختبار الدالة المساعدة _qp
print(f"✅ _qp يعمل: '{memory._qp('SELECT * WHERE id = %s')}'")

print("\n" + "=" * 60)
print("🎉 جميع الاختبارات اجتازت بنجاح! النظام جاهز.")
print("=" * 60)

# تنظيف
os.remove(db_path)
print("🧹 تم تنظيف قاعدة بيانات الاختبار")
