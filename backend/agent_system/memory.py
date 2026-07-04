import json
import os
from datetime import datetime
from typing import Dict, Any, List, Optional

# استيراد إعدادات ومخططات قاعدة البيانات
from agent_system.db_config import (
    get_db_connection,
    format_query,
    is_postgresql,
    TABLES_SQL,
    psycopg2,
    RealDictCursor
)

def parse_wkt_polygon(wkt: str) -> List[List[List[float]]]:
    """فك ترميز WKT POLYGON إلى قائمة إحداثيات."""
    if not wkt or not wkt.startswith("POLYGON"):
        return []
    try:
        content = wkt.replace("POLYGON", "").strip(" ()")
        pts_str = content.split(",")
        coords = []
        for p in pts_str:
            parts = p.strip().split()
            if len(parts) >= 2:
                coords.append([float(parts[0]), float(parts[1])])
        return [coords]
    except Exception:
        return []

def parse_wkt_point(wkt: str) -> List[float]:
    """فك ترميز WKT POINT إلى خطوط طول وعرض."""
    if not wkt or not wkt.startswith("POINT"):
        return [0.0, 0.0]
    try:
        content = wkt.replace("POINT", "").strip(" ()")
        parts = content.strip().split()
        if len(parts) >= 2:
            return [float(parts[0]), float(parts[1])]
    except Exception:
        pass
    return [0.0, 0.0]

class SharedMemory:
    """
    الذاكرة المشتركة المدعومة بقاعدة بيانات PostgreSQL/PostGIS (مع تراجع لـ SQLite).
    تُستخدم لحفظ حالة المهام، بيانات الطبقات الجغرافية المكانية، والمراسلات بين الوكلاء.
    """
    def __init__(self, db_path: str = "shared_memory.db"):
        if not os.path.isabs(db_path):
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
            db_path = os.path.join(project_root, db_path)
        self.db_path = db_path
        
        # التأكد من إنشاء المجلد لـ SQLite إذا لم نكن نستخدم PostgreSQL
        if not is_postgresql():
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
            
        self._init_db()

    def _get_connection(self):
        return get_db_connection(self.db_path)

    def _qp(self, query: str) -> str:
        return format_query(query)

    def _init_db(self):
        """تهيئة جداول قاعدة البيانات ومكونات PostGIS إذا لم تكن موجودة مسبقاً."""
        db_type = "postgres" if is_postgresql() else "sqlite"
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            # تفعيل امتداد PostGIS في حال كنا نستخدم PostgreSQL
            if is_postgresql():
                try:
                    cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
                    conn.commit()
                except Exception as e:
                    print(f"⚠️ تعذر تفعيل امتداد PostGIS (قد لا تملك الصلاحيات): {e}")
                    conn.rollback()

            # إنشاء الجداول بناءً على المخططات المعرفة بملف db_config.py
            cursor.execute(TABLES_SQL["tasks"][db_type])
            
            # التأكد من إضافة الحقل processed_image_path للجداول القديمة في SQLite
            if db_type == "sqlite":
                try:
                    cursor.execute("PRAGMA table_info(tasks)")
                    columns = [row[1] for row in cursor.fetchall()]
                    if 'processed_image_path' not in columns:
                        cursor.execute("ALTER TABLE tasks ADD COLUMN processed_image_path TEXT")
                except Exception:
                    pass

            cursor.execute(TABLES_SQL["spatial_features"][db_type])
            
            # إنشاء كشافات مكانية (Spatial Index) لتسريع الاستعلامات الهندسية في PostgreSQL
            if is_postgresql():
                try:
                    cursor.execute("CREATE INDEX IF NOT EXISTS idx_spatial_features_geom ON spatial_features USING GIST (geom);")
                    cursor.execute("CREATE INDEX IF NOT EXISTS idx_spatial_features_centroid ON spatial_features USING GIST (centroid);")
                except Exception:
                    pass

            cursor.execute(TABLES_SQL["agent_messages"][db_type])
            
            conn.commit()

    # --- عمليات إدارة المهام (Tasks) ---
    
    def create_task(self, task_id: str, image_path: str, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """إنشاء مهمة تحليل جديدة في قاعدة البيانات مع دعم التصنيف الإداري والبلاطات."""
        is_pg = is_postgresql()
        meta = metadata or {}
        country = meta.get("country", "Yemen")
        governorate = meta.get("governorate")
        district = meta.get("district")
        tile_id = meta.get("tile_id")
        metadata_val = json.dumps(meta) if not is_pg else meta
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    self._qp("INSERT INTO tasks (task_id, image_path, status, metadata, country, governorate, district, tile_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"),
                    (task_id, image_path, "PENDING", metadata_val, country, governorate, district, tile_id)
                )
                conn.commit()
                print(f"[SharedMemory] create_task: inserted {task_id}")
            return True
        except Exception as e:
            print(f"[SharedMemory] create_task error: {e}")
            return False

    def update_task_status(self, task_id: str, status: str) -> bool:
        """تحديث حالة المهمة الحالية."""
        now = datetime.now().isoformat()
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    self._qp("UPDATE tasks SET status = %s, updated_at = %s WHERE task_id = %s"),
                    (status, now, task_id)
                )
                conn.commit()
                rowcount = cursor.rowcount if hasattr(cursor, 'rowcount') else 0
                return rowcount > 0
        except Exception as e:
            print(f"[SharedMemory] update_task_status error: {e}")
            return False

    def update_task_processed_image(self, task_id: str, processed_image_path: str) -> bool:
        """حفظ مسار الصورة النهائية المعالجة في المهمة."""
        now = datetime.now().isoformat()
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    self._qp("UPDATE tasks SET processed_image_path = %s, updated_at = %s WHERE task_id = %s"),
                    (processed_image_path, now, task_id)
                )
                conn.commit()
                rowcount = cursor.rowcount if hasattr(cursor, 'rowcount') else 0
                return rowcount > 0
        except Exception as e:
            print(f"[SharedMemory] update_task_processed_image error: {e}")
            return False

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """الاستعلام عن بيانات مهمة معينة باستخدام معرفها."""
        is_pg = is_postgresql()
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor(cursor_factory=RealDictCursor) if is_pg else conn.cursor()
                cursor.execute(
                    self._qp("SELECT * FROM tasks WHERE task_id = %s"),
                    (task_id,)
                )
                row = cursor.fetchone()
                if row:
                    data = dict(row)
                    if isinstance(data.get('metadata'), str):
                        data['metadata'] = json.loads(data['metadata']) if data['metadata'] else {}
                    return data
        except Exception as e:
            print(f"[SharedMemory] get_task error: {e}")
        return None

    def get_tasks(self, limit: int = 10) -> List[Dict[str, Any]]:
        """جلب قائمة المهام السابقة بترتيب الأحدث أولاً."""
        is_pg = is_postgresql()
        tasks = []
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor(cursor_factory=RealDictCursor) if is_pg else conn.cursor()
                cursor.execute(
                    self._qp("SELECT task_id, status, metadata, created_at, updated_at FROM tasks ORDER BY created_at DESC LIMIT %s"),
                    (limit,)
                )
                rows = cursor.fetchall()
                for r in rows:
                    task = dict(r)
                    if isinstance(task.get('metadata'), str):
                        task['metadata'] = json.loads(task['metadata']) if task['metadata'] else {}
                    tasks.append(task)
        except Exception as e:
            print(f"[SharedMemory] get_tasks error: {e}")
        return tasks

    def add_spatial_feature(
        self,
        feature_id: str,
        task_id: str,
        feature_type: str,
        wkt_polygon: str,
        wkt_centroid: str,
        area_sqm: float,
        area_feddan: int,
        area_qirat: int,
        area_sahm: float,
        perimeter_meters: float,
        confidence: float,
        image_source: str,
        spatial_relations: Optional[Dict[str, Any]] = None,
        geometric_features: Optional[Dict[str, Any]] = None,
        analysis_results: Optional[Dict[str, Any]] = None,
        country: str = "Yemen",
        governorate: Optional[str] = None,
        district: Optional[str] = None,
        tile_id: Optional[str] = None
    ) -> bool:
        """إدخال معلم مكاني جغرافي جديد مباشرة في PostgreSQL/PostGIS (مع دعم SQLite والتصنيف الإداري)."""
        is_pg = is_postgresql()
        
        rel_val = spatial_relations if is_pg else json.dumps(spatial_relations or {})
        geo_val = geometric_features if is_pg else json.dumps(geometric_features or {})
        ana_val = analysis_results if is_pg else json.dumps(analysis_results or {})

        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                if is_pg:
                    cursor.execute(
                        """
                        INSERT INTO spatial_features (
                            feature_id, task_id, feature_type, geom, centroid,
                            area_sqm, area_feddan, area_qirat, area_sahm, perimeter_meters,
                            confidence, image_source, spatial_relations, geometric_features, analysis_results,
                            country, governorate, district, tile_id
                        ) VALUES (
                            %s, %s, %s, ST_GeomFromText(%s, 4326), ST_GeomFromText(%s, 4326),
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, %s
                        )
                        """,
                        (feature_id, task_id, feature_type, wkt_polygon, wkt_centroid,
                         area_sqm, area_feddan, area_qirat, area_sahm, perimeter_meters,
                         confidence, image_source, rel_val, geo_val, ana_val,
                         country, governorate, district, tile_id)
                    )
                else:
                    cursor.execute(
                        """
                        INSERT INTO spatial_features (
                            feature_id, task_id, feature_type, geom, centroid,
                            area_sqm, area_feddan, area_qirat, area_sahm, perimeter_meters,
                            confidence, image_source, spatial_relations, geometric_features, analysis_results,
                            country, governorate, district, tile_id
                        ) VALUES (
                            ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?,
                            ?, ?, ?, ?
                        )
                        """,
                        (feature_id, task_id, feature_type, wkt_polygon, wkt_centroid,
                         area_sqm, area_feddan, area_qirat, area_sahm, perimeter_meters,
                         confidence, image_source, rel_val, geo_val, ana_val,
                         country, governorate, district, tile_id)
                    )
                conn.commit()
                return True
        except Exception as e:
            print(f"[SharedMemory] add_spatial_feature error: {e}")
            return False

    def get_spatial_features(self, task_id: str, feature_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """استرجاع المعالم الجغرافية المكانية لمهمة معينة وتحويل البيانات الجغرافية تلقائياً لـ GeoJSON."""
        is_pg = is_postgresql()
        features = []
        
        query_pg = "SELECT feature_id, task_id, feature_type, ST_AsGeoJSON(geom) as geom_geojson, ST_AsGeoJSON(centroid) as centroid_geojson, area_sqm, area_feddan, area_qirat, area_sahm, perimeter_meters, confidence, image_source, spatial_relations, geometric_features, analysis_results, created_at FROM spatial_features WHERE task_id = %s"
        query_sqlite = "SELECT * FROM spatial_features WHERE task_id = ?"
        
        query = query_pg if is_pg else query_sqlite
        params = [task_id]
        if feature_type:
            query += " AND feature_type = " + ("%s" if is_pg else "?")
            params.append(feature_type)

        try:
            with self._get_connection() as conn:
                cursor = conn.cursor(cursor_factory=RealDictCursor) if is_pg else conn.cursor()
                cursor.execute(query, params)
                rows = cursor.fetchall()
                for r in rows:
                    feat = dict(r)
                    if is_pg:
                        feat['geom_geojson'] = json.loads(feat['geom_geojson']) if feat['geom_geojson'] else None
                        feat['centroid_geojson'] = json.loads(feat['centroid_geojson']) if feat['centroid_geojson'] else None
                    else:
                        for js_col in ['spatial_relations', 'geometric_features', 'analysis_results']:
                            if isinstance(feat.get(js_col), str):
                                feat[js_col] = json.loads(feat[js_col]) if feat[js_col] else {}
                    features.append(feat)
        except Exception as e:
            print(f"[SharedMemory] get_spatial_features error: {e}")
        return features

    def check_cached_features(self, min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> List[Dict[str, Any]]:
        """التحقق من وجود معالم تم إسقاطها مسبقاً جغرافياً في النطاق الجغرافي المعين."""
        is_pg = is_postgresql()
        features = []
        
        query_pg = """
            SELECT feature_id, task_id, feature_type, ST_AsGeoJSON(geom) as geom_geojson, ST_AsGeoJSON(centroid) as centroid_geojson, 
                   area_sqm, area_feddan, area_qirat, area_sahm, perimeter_meters, confidence, image_source, 
                   spatial_relations, geometric_features, analysis_results, country, governorate, district, tile_id, created_at 
            FROM spatial_features 
            WHERE ST_Intersects(geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
        """
        
        query_sqlite = """
            SELECT * FROM spatial_features
        """
        
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor(cursor_factory=RealDictCursor) if is_pg else conn.cursor()
                if is_pg:
                    cursor.execute(query_pg, (min_lon, min_lat, max_lon, max_lat))
                    rows = cursor.fetchall()
                    for r in rows:
                        feat = dict(r)
                        feat['geom_geojson'] = json.loads(feat['geom_geojson']) if feat['geom_geojson'] else None
                        feat['centroid_geojson'] = json.loads(feat['centroid_geojson']) if feat['centroid_geojson'] else None
                        features.append(feat)
                else:
                    cursor.execute(query_sqlite)
                    rows = cursor.fetchall()
                    for r in rows:
                        feat = dict(r)
                        wkt = feat.get('geom')
                        if wkt:
                            coords = parse_wkt_polygon(wkt)
                            if coords and len(coords) > 0:
                                lons = [pt[0] for pt in coords[0]]
                                lats = [pt[1] for pt in coords[0]]
                                feat_min_lon, feat_max_lon = min(lons), max(lons)
                                feat_min_lat, feat_max_lat = min(lats), max(lats)
                                
                                # تحقق من التقاطع مع الـ bounding box المطلوب
                                if not (feat_max_lon < min_lon or feat_min_lon > max_lon or feat_max_lat < min_lat or feat_min_lat > max_lat):
                                    for js_col in ['spatial_relations', 'geometric_features', 'analysis_results']:
                                        if isinstance(feat.get(js_col), str):
                                            feat[js_col] = json.loads(feat[js_col]) if feat[js_col] else {}
                                    features.append(feat)
        except Exception as e:
            print(f"[SharedMemory] check_cached_features error: {e}")
        
        return features

    # --- عمليات إدارة الطبقات الجغرافية الكلاسيكية (Compatibility Layers Wrapper) ---
    
    def add_task_layer(
        self, 
        task_id: str, 
        layer_name: str, 
        polygons: List[List[List[float]]], 
        geo_polygons: Optional[List[List[List[float]]]] = None,
        area_sq_meters: float = 0.0,
        area_feddan: int = 0,
        area_qirat: int = 0,
        area_sahm: float = 0.0,
        metadata: Optional[Dict[str, Any]] = None
    ) -> int:
        """دالة متوافقة كلاسيكياً تقوم بإدخال البيانات تلقائياً في جدول spatial_features الحديث."""
        import uuid
        feature_id = f"feat_{uuid.uuid4().hex[:8]}"
        
        wkt_polygon = ""
        wkt_centroid = ""
        
        if geo_polygons and len(geo_polygons) > 0 and len(geo_polygons[0]) >= 3:
            coords = geo_polygons[0]
            wkt_pts = [f"{pt[0]} {pt[1]}" for pt in coords]
            if coords[0] != coords[-1]:
                wkt_pts.append(f"{coords[0][0]} {coords[0][1]}")
            wkt_polygon = f"POLYGON(({', '.join(wkt_pts)}))"
        else:
            coords = polygons[0] if polygons and len(polygons) > 0 else [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
            wkt_pts = [f"{pt[0]} {pt[1]}" for pt in coords]
            wkt_polygon = f"POLYGON(({', '.join(wkt_pts)}))"

        centroid_geo = (metadata or {}).get("centroid_geo", [0.0, 0.0])
        wkt_centroid = f"POINT({centroid_geo[0]} {centroid_geo[1]})"

        meta = metadata or {}
        image_src = os.path.basename(meta.get("image_source", "aerial_image"))
        country = meta.get("country", "Yemen")
        governorate = meta.get("governorate")
        district = meta.get("district")
        tile_id = meta.get("tile_id")

        success = self.add_spatial_feature(
            feature_id=feature_id,
            task_id=task_id,
            feature_type=layer_name,
            wkt_polygon=wkt_polygon,
            wkt_centroid=wkt_centroid,
            area_sqm=area_sq_meters,
            area_feddan=area_feddan,
            area_qirat=area_qirat,
            area_sahm=area_sahm,
            perimeter_meters=meta.get("perimeter_meters", 0.0),
            confidence=meta.get("confidence_percentage", 100.0) / 100.0,
            image_source=image_src,
            spatial_relations={"neighbors": []},
            geometric_features={
                "orientation_degrees": meta.get("orientation_degrees", 0.0),
                "pixel_scale": meta.get("pixel_scale", 0.5),
                "centroid_pixel": meta.get("centroid_pixel", [0.0, 0.0])
            },
            analysis_results=meta.get("local_classification", {
                "class_name": meta.get("description", f"قطعة {layer_name}"),
                "soil_type": "غير محدد",
                "water_relation": "غير محدد"
            }),
            country=country,
            governorate=governorate,
            district=district,
            tile_id=tile_id
        )
        
        return 1 if success else 0
    def get_task_layers(self, task_id: str, layer_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """دالة متوافقة كلاسيكياً تقوم بتحويل البيانات المسترجعة من spatial_features لتتوافق مع طبقات التطبيق القديم."""
        features = self.get_spatial_features(task_id, layer_name)
        layers = []
        for feat in features:
            polys = []
            geo_polys = []
            
            geom = feat.get('geom_geojson')
            if geom and geom.get('type') == 'Polygon':
                coords = geom.get('coordinates', [])
                if coords:
                    geo_polys = coords
                    polys = feat.get('geometric_features', {}).get('centroid_pixel', [[0.0, 0.0]])
            else:
                # تراجع لـ SQLite WKT
                wkt = feat.get('geom')
                if wkt:
                    geo_polys = parse_wkt_polygon(wkt)
                    polys = feat.get('geometric_features', {}).get('centroid_pixel', [[0.0, 0.0]])
            
            # حساب إحداثي المركز
            if feat.get('centroid_geojson'):
                centroid_geo = feat.get('centroid_geojson', {}).get('coordinates', [0.0, 0.0])
            else:
                centroid_geo = parse_wkt_point(feat.get('centroid'))

            layers.append({
                "layer_id": hash(feat["feature_id"]),
                "feature_id": feat["feature_id"],
                "task_id": feat["task_id"],
                "layer_name": feat["feature_type"],
                "polygons_json": json.dumps(polys),
                "geo_polygons_json": json.dumps(geo_polys),
                "polygons": polys,
                "geo_polygons": geo_polys,
                "area_sq_meters": feat["area_sqm"],
                "area_feddan": feat["area_feddan"],
                "area_qirat": feat["area_qirat"],
                "area_sahm": feat["area_sahm"],
                "metadata": {
                    "description": feat["analysis_results"].get("class_name", f"معلم {feat['feature_type']}"),
                    "local_classification": feat["analysis_results"],
                    "confidence_percentage": feat["confidence"] * 100.0,
                    "perimeter_meters": feat["perimeter_meters"],
                    "centroid_geo": centroid_geo
                }
            })
        return layers

    # --- عمليات إدارة الرسائل والمراسلات (Messaging) ---
    
    def log_message(self, task_id: str, sender: str, message_type: str, content: str, payload: Optional[Dict[str, Any]] = None) -> int:
        """تسجيل رسالة تواصل أو حدث بين الوكلاء في قاعدة البيانات."""
        is_pg = is_postgresql()
        payload_val = json.dumps(payload or {}) if not is_pg else (payload or {})
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    self._qp("INSERT INTO agent_messages (task_id, sender, message_type, content, " + ("payload" if is_pg else "payload_json") + ") VALUES (%s, %s, %s, %s, %s)"),
                    (task_id, sender, message_type, content, payload_val)
                )
                conn.commit()
                return 1
        except Exception as e:
            print(f"[SharedMemory] log_message error: {e}")
            return 0

    def get_messages(self, task_id: str) -> List[Dict[str, Any]]:
        """جلب السجل التاريخي للأحداث والمراسلات الخاصة بمهمة معينة مرتبة زمنياً."""
        is_pg = is_postgresql()
        messages = []
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor(cursor_factory=RealDictCursor) if is_pg else conn.cursor()
                cursor.execute(
                    self._qp("SELECT * FROM agent_messages WHERE task_id = %s ORDER BY message_id ASC"),
                    (task_id,)
                )
                rows = cursor.fetchall()
                for r in rows:
                    msg = dict(r)
                    if not is_pg:
                        msg['payload'] = json.loads(msg['payload_json']) if msg['payload_json'] else {}
                    messages.append(msg)
        except Exception as e:
            print(f"[SharedMemory] get_messages error: {e}")
        return messages
