import os
import json
import uuid
from agent_system.memory import SharedMemory

def import_geojson_to_db(file_path: str, feature_type: str, governorate: str = None, district: str = None):
    """
    تستورد ملف GeoJSON خارجي (مثل مباني أو طرق اليمن الجاهزة) وتخزنها مباشرة في قاعدة البيانات.
    
    file_path: مسار ملف الـ GeoJSON على جهازك.
    feature_type: نوع المعلم (مثال: 'مبنى' أو 'شارع').
    """
    if not os.path.exists(file_path):
        print(f"❌ الملف غير موجود في المسار: {file_path}")
        return

    print(f"📖 قراءة الملف: {file_path}...")
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    total = len(features)
    print(f"🔍 تم العثور على {total} معلم بداخل الملف. البدء في الاستيراد...")

    # الاتصال بقاعدة البيانات
    db_path = os.getenv("BACKEND_DB_PATH", "shared_memory.db")
    memory = SharedMemory(db_path=db_path)

    imported_count = 0
    # نربط البيانات المستوردة بمهمة وهمية عامة لليمن ككل
    dummy_task_id = "task_yemen_imported_dataset"
    memory.create_task(
        task_id=dummy_task_id,
        image_path=file_path,
        metadata={"description": "بيانات جغرافية جاهزة مستوردة لليمن"}
    )
    # تحديث حالة المهمة الوهمية
    memory.update_task_status(dummy_task_id, "COMPLETED")

    for idx, feat in enumerate(features):
        geometry = feat.get("geometry")
        properties = feat.get("properties", {})
        
        if not geometry or geometry.get("type") != "Polygon":
            continue # ندعم المضلعات حالياً
            
        coords = geometry.get("coordinates", [[]])[0]
        if len(coords) < 3:
            continue

        # تحويل الإحداثيات لـ WKT Polygon
        wkt_polygon = f"POLYGON(({', '.join(f'{pt[0]} {pt[1]}' for pt in coords)}))"
        
        # حساب مركز تقريبي للمضلع
        lons = [pt[0] for pt in coords]
        lats = [pt[1] for pt in coords]
        centroid_lon = sum(lons) / len(lons)
        centroid_lat = sum(lats) / len(lats)
        wkt_centroid = f"POINT({centroid_lon} {centroid_lat})"

        # توليد معرف فريد
        feature_id = f"imported_{uuid.uuid4().hex[:8]}"

        # حساب مساحة ومحيط جيو-مكاني تقريبي (أو استخدام الافتراضي)
        area_sqm = properties.get("area", 100.0) # بالمتر المربع

        # حفظ المعلم في قاعدة البيانات
        success = memory.add_spatial_feature(
            feature_id=feature_id,
            task_id=dummy_task_id,
            feature_type=feature_type,
            wkt_polygon=wkt_polygon,
            wkt_centroid=wkt_centroid,
            area_sqm=area_sqm,
            area_feddan=0,
            area_qirat=0,
            area_sahm=0.0,
            perimeter_meters=0.0,
            confidence=1.0,
            image_source=os.path.basename(file_path),
            spatial_relations={"neighbors": []},
            geometric_features={"imported": True},
            analysis_results={"class_name": feature_type, "properties": properties},
            country="Yemen",
            governorate=governorate,
            district=district,
            tile_id="global"
        )
        if success:
            imported_count += 1

        if (idx + 1) % 1000 == 0:
            print(f"▓ تم استيراد {idx + 1} من أصل {total} معالم...")

    print(f"🎉 تم استيراد {imported_count} مضلع بنجاح كـ '{feature_type}' في قاعدة البيانات!")

if __name__ == "__main__":
    # مثال للاستخدام:
    # قم بتنزيل الملف ووضع مساره هنا وشغل السكربت
    import_geojson_to_db(
        file_path="yemen_buildings.geojson", 
        feature_type="مبنى",
        governorate="Sana'a",
        district="Al Wahdah"
    )
