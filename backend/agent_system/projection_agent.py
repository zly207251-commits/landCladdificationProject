import os
import cv2
import numpy as np
from datetime import datetime
from typing import Dict, Any, List, Tuple
from agent_system.base import BaseAgent
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from land_classifier import LandSegmenterSAM

try:
    import rasterio
except ImportError:
    rasterio = None

class ProjectionAgent(BaseAgent):
    """
    وكيل الإسقاط ورسم المعالم.
    يتولى تحويل نقاط المضلعات من بكسل الصورة إلى إحداثيات جغرافية حقيقية،
    ويقوم بحساب المساحات بالمتر المربع والوحدات التقليدية (فدان، قيراط، سهم).
    """
    def __init__(self, message_bus: MessageBus, segmenter: LandSegmenterSAM):
        super().__init__("projection_agent")
        self.message_bus = message_bus
        self.segmenter = segmenter

    def run(self, state: Dict[str, Any], memory: SharedMemory) -> Dict[str, Any]:
        task_id = state.get("task_id")
        image_path = state.get("image_path")
        
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="START",
            content=f"بدء إسقاط الصورة: {image_path}"
        )
        
        # جلب بيانات المهمة الحالية وميتا الإسقاط من قاعدة البيانات
        task_info = memory.get_task(task_id)
        task_meta = task_info.get("metadata", {}) if task_info else {}
        
        # مقياس الرسم الافتراضي (دقة البكسل بالأمتار GSD، الافتراضي 0.5 متر لكل بكسل)
        pixel_scale = float(task_meta.get("pixel_scale_meters", 0.5))
        # نقطة المرجع الجغرافي الافتراضية (إحداثيات صنعاء، اليمن)
        ref_lat = float(task_meta.get("ref_latitude", 15.3694))
        ref_lon = float(task_meta.get("ref_longitude", 44.1910))
        
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="ACTION",
            content=f"معايير الإسقاط المعتمدة: مقياس الرسم = {pixel_scale} متر/بكسل، الإحداثي المرجعي = ({ref_lat}, {ref_lon})"
        )

        # محاولة قراءة الصورة باستخدام Pillow لدعم المسارات التي تحتوي على أحرف عربية (Unicode) في ويندوز
        image = None
        try:
            from PIL import Image
            with Image.open(image_path) as img:
                # تحويل الصورة إلى RGB ثم إلى BGR لتتوافق مع OpenCV
                rgb_img = img.convert('RGB')
                image = cv2.cvtColor(np.array(rgb_img), cv2.COLOR_RGB2BGR)
        except Exception as pil_err:
            print(f"⚠️ فشل قراءة الصورة باستخدام Pillow: {pil_err}، المحاولة بـ OpenCV...")
            image = cv2.imread(image_path, cv2.IMREAD_COLOR)

        if image is None and rasterio is not None:
            try:
                with rasterio.open(image_path) as ds:
                    bands = ds.read()
                    if bands.ndim == 3:
                        if bands.shape[0] >= 3:
                            image = np.stack([bands[0], bands[1], bands[2]], axis=-1)
                        else:
                            image = np.transpose(bands, (1, 2, 0))
                    else:
                        image = bands
                    image = np.asarray(image, dtype=np.uint8)
                    if image.ndim == 2:
                        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
                    elif image.shape[2] == 4:
                        image = cv2.cvtColor(image, cv2.COLOR_RGBA2BGR)
            except Exception:
                image = None

        if image is None:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="ERROR",
                content=f"تعذر قراءة الصورة من المسار: {image_path}"
            )
            memory.update_task_status(task_id, "FAILED")
            return {"next_agent": "end"}

        original_image = image.copy()
        use_geo_metadata = bool(task_meta.get('use_geo_metadata', False))
        geo_metadata = task_meta.get('geo_metadata') if task_meta.get('image_type') == 'geospatial' else None

        if task_meta.get('image_type') == 'geospatial' and use_geo_metadata and geo_metadata is None:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="ACTION",
                content="محاولة قراءة بيانات GeoTIFF المضمنة من الملف لأن الصورة مصنفة كجيو-سبيشال."
            )
            geo_metadata = self._load_geo_metadata(image_path)
            if geo_metadata:
                task_meta['geo_metadata'] = geo_metadata
                self.message_bus.publish(
                    task_id=task_id,
                    sender=self.name,
                    message_type="ACTION",
                    content="تم قراءة بيانات GeoTIFF المضمنة من الملف واختبارها بنجاح."
                )

        # تطبيق إعدادات SAM الخاصة بالمهمة إذا كانت متاحة
        self.segmenter.apply_parameters(
            use_fallback=bool(task_meta.get('sam_use_fallback', self.segmenter.use_fallback)),
            min_mask_region_area=int(task_meta.get('sam_min_mask_region_area', self.segmenter.min_mask_region_area)),
            points_per_side=int(task_meta.get('sam_points_per_side', self.segmenter.points_per_side)),
            pred_iou_thresh=float(task_meta.get('sam_pred_iou_thresh', self.segmenter.pred_iou_thresh)),
            stability_score_thresh=float(task_meta.get('sam_stability_score_thresh', self.segmenter.stability_score_thresh)),
        )

        transform = None
        geo_crs = None
        if isinstance(geo_metadata, dict):
            transform = geo_metadata.get('transform')
            geo_crs = geo_metadata.get('crs')

        has_valid_geo_metadata = (
            transform is not None and
            isinstance(transform, (list, tuple)) and
            len(transform) == 6 and
            isinstance(geo_crs, str) and
            geo_crs != ''
        )

        if has_valid_geo_metadata:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="ACTION",
                content="سيتم استخدام بيانات الإسقاط الجغرافية المضمنة (GeoTIFF) لتحويل إحداثيات البكسل."
            )
        elif task_meta.get('image_type') == 'geospatial':
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content=(
                    "الصورة مصنفة كـ geospatial لكن بيانات GeoTIFF المضمنة غير متوفرة أو غير صالحة. "
                    "سيتم استخدام مقياس الرسم المرجعي البديل (pixel_scale/ref_lat/ref_lon)."
                )
            )

        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="ACTION",
            content=f"معايير الإسقاط المعتمدة: مقياس الرسم = {pixel_scale} متر/بكسل، الإحداثي المرجعي = ({ref_lat}, {ref_lon})"
        )

        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="ACTION",
            content="تشغيل نموذج SAM لاستخراج حدود قطع الأراضي من الصورة الجوية."
        )

        segments = self.segmenter.segment_image(image)
        if not segments:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content="لم يتم استخراج أي مضلعات من نموذج SAM. سيتم استخدام قطعة أرض افتراضية للاختبار."
            )
            segments = [{'label': 'unknown', 'polygons': [[[100, 100], [600, 100], [600, 600], [100, 600], [100, 100]]], 'mask': None, 'score': 0.5}]

        # 1. تجميع المضلعات الفردية من كافة القطاعات المكتشفة
        raw_polys = []
        for seg in segments:
            label = seg.get('label', 'unknown')
            seg_polygons = seg.get('polygons') if isinstance(seg.get('polygons'), list) else []
            score = float(seg.get('score', 0.0))
            for poly in seg_polygons:
                if len(poly) >= 3:
                    raw_polys.append({
                        'label': label,
                        'poly_px': poly,
                        'score': score
                    })

        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="ACTION",
            content=f"إجمالي المضلعات المكتشفة قبل الفحص والتحليل الطوبولوجي: {len(raw_polys)}"
        )

        # 2. الفحص والحل الطوبولوجي (منع التداخل - No Overlaps)
        # نقوم بترتيب المضلعات حسب درجة الثقة لضمان أن المضلعات الأعلى ثقة تقتطع من المضلعات الأقل ثقة
        from shapely.geometry import Polygon as ShapelyPolygon
        from shapely.ops import unary_union
        
        raw_polys.sort(key=lambda x: x['score'], reverse=True)
        resolved_polys = []
        
        for item in raw_polys:
            poly_px = item['poly_px']
            try:
                sh_poly = ShapelyPolygon(poly_px)
                if not sh_poly.is_valid:
                    sh_poly = sh_poly.buffer(0)
            except Exception:
                continue
                
            if sh_poly.is_empty or not sh_poly.is_valid:
                continue

            # قص الأجزاء المتداخلة مع المضلعات المعتمدة سابقاً
            for resolved in resolved_polys:
                try:
                    if sh_poly.intersects(resolved['poly_sh']):
                        sh_poly = sh_poly.difference(resolved['poly_sh'])
                        if not sh_poly.is_valid:
                            sh_poly = sh_poly.buffer(0)
                except Exception:
                    pass

            # الاحتفاظ بالمضلع فقط إذا كان له مساحة كافية بعد التعديل (مثلاً > 150 بكسل مربع)
            if not sh_poly.is_empty and sh_poly.area >= 150:
                # تحويل مضلع Shapely المعدل إلى قائمة نقاط بكسل
                try:
                    if sh_poly.geom_type == 'Polygon':
                        coords = [list(map(float, c)) for c in sh_poly.exterior.coords[:-1]]
                        resolved_polys.append({
                            'label': item['label'],
                            'poly_px': coords,
                            'poly_sh': sh_poly,
                            'score': item['score']
                        })
                    elif sh_poly.geom_type == 'MultiPolygon':
                        # في حالة تقطيع المضلع لأكثر من جزء، نحتفظ بالأجزاء الصالحة
                        for sub_p in sh_poly.geoms:
                            if not sub_p.is_empty and sub_p.area >= 150:
                                coords = [list(map(float, c)) for c in sub_p.exterior.coords[:-1]]
                                resolved_polys.append({
                                    'label': item['label'],
                                    'poly_px': coords,
                                    'poly_sh': sub_p,
                                    'score': item['score']
                                })
                except Exception:
                    pass

        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="ACTION",
            content=f"تم حل التداخلات الطوبولوجية وتصفية المضلعات: المضلعات المعتمدة = {len(resolved_polys)}"
        )

        # 3. حساب نسبة التغطية (Coverage Percentage) وكشف الفجوات (Gap Areas)
        height_px, width_px = image.shape[:2]
        total_image_area_px = height_px * width_px
        sum_resolved_area_px = sum(item['poly_sh'].area for item in resolved_polys)
        coverage_pct = round((sum_resolved_area_px / total_image_area_px) * 100.0, 2)

        # كشف الفجوات
        image_box = ShapelyPolygon([[0, 0], [width_px, 0], [width_px, height_px], [0, height_px]])
        gap_count = 0
        total_gap_area_px = 0.0
        try:
            all_resolved_union = unary_union([item['poly_sh'] for item in resolved_polys])
            gaps = image_box.difference(all_resolved_union)
            if not gaps.is_valid:
                gaps = gaps.buffer(0)
            
            gap_polygons_sh = []
            if gaps and not gaps.is_empty:
                if gaps.geom_type == 'Polygon':
                    gap_polygons_sh.append(gaps)
                elif gaps.geom_type == 'MultiPolygon':
                    for g in gaps.geoms:
                        if g.area >= 500: # حد أدنى لمساحة الفجوة
                            gap_polygons_sh.append(g)

            # إضافة الفجوات كمضلعات خاصة في قاعدة البيانات ليعرفها المستخدم
            for g_sh in gap_polygons_sh:
                gap_coords = [list(map(float, c)) for c in g_sh.exterior.coords[:-1]]
                gap_area_sqm = g_sh.area * (pixel_scale ** 2)
                
                # حساب الإسقاط الجغرافي للفجوة
                gap_geo_poly = []
                for pt in gap_coords:
                    if transform is not None and len(transform) == 6:
                        gap_geo_poly.append(self._pixel_to_geo(pt, transform))
                    else:
                        lat_scale = 1.0 / 111111.0
                        lon_scale = 1.0 / (111111.0 * np.cos(np.radians(ref_lat)))
                        dx = pt[0] * pixel_scale
                        dy = -pt[1] * pixel_scale
                        plat = ref_lat + (dy * lat_scale)
                        plon = ref_lon + (dx * lon_scale)
                        gap_geo_poly.append([plon, plat])

                # حساب الإحداثيات والوحدات
                g_feddan, g_qirat, g_sahm = self._convert_to_agricultural_units(gap_area_sqm)
                
                # إضافة فجوة
                memory.add_task_layer(
                    task_id=task_id,
                    layer_name="gap",
                    polygons=[gap_coords],
                    geo_polygons=[gap_geo_poly],
                    area_sq_meters=gap_area_sqm,
                    area_feddan=g_feddan,
                    area_qirat=g_qirat,
                    area_sahm=g_sahm,
                    metadata={
                        "description": "فجوة تحليل: مساحة غير مستخلصة أو مشكوك فيها",
                        "pixel_scale": pixel_scale,
                        "score": 0.0,
                        "uncertainty_reason": "لم يتم التعرف عليها من النموذج أو المساحة معتمة/غير مصنفة"
                    }
                )
                gap_count += 1
                total_gap_area_px += g_sh.area
        except Exception as e:
            print(f"⚠️ خطأ أثناء كشف وحساب الفجوات: {e}")

        # 4. معالجة وتخزين الكيانات المعتمدة وحساب السمات المتقدمة
        COLOR_MAP = {
            'agricultural': (34, 139, 34),
            'buildings': (0, 0, 255),
            'water': (255, 0, 0),
            'roads': (200, 200, 200),
            'arid': (19, 69, 139),
            'unknown': (0, 255, 255),
        }
        line_thickness = int(task_meta.get('line_thickness', 1))

        entity_counts = {}
        for item in resolved_polys:
            label = item['label']
            poly = item['poly_px']
            sh_poly = item['poly_sh']
            score = item['score']

            entity_counts[label] = entity_counts.get(label, 0) + 1

            # أ) حساب المساحة الحقيقية
            area_sqm = sh_poly.area * (pixel_scale ** 2)

            # ب) حساب المحيط الحقيقي
            try:
                perimeter_px = float(cv2.arcLength(np.array(poly, dtype=np.float32), True))
            except Exception:
                perimeter_px = 0.0
            perimeter_meters = perimeter_px * pixel_scale

            # ج) حساب المركز (بكسل وجغرافي)
            centroid_px = [float(sh_poly.centroid.x), float(sh_poly.centroid.y)]
            
            # حساب إحداثيات المضلع الجغرافية
            if transform is not None and len(transform) == 6:
                geo_poly = [self._pixel_to_geo(pt, transform) for pt in poly]
                centroid_geo = self._pixel_to_geo(centroid_px, transform)
            else:
                lat_scale = 1.0 / 111111.0
                lon_scale = 1.0 / (111111.0 * np.cos(np.radians(ref_lat)))
                geo_poly = []
                for pt in poly:
                    dx = pt[0] * pixel_scale
                    dy = -pt[1] * pixel_scale
                    point_lat = ref_lat + (dy * lat_scale)
                    point_lon = ref_lon + (dx * lon_scale)
                    geo_poly.append([point_lon, point_lat])
                
                # مركز الإسقاط البديل
                dx_c = centroid_px[0] * pixel_scale
                dy_c = -centroid_px[1] * pixel_scale
                centroid_geo = [
                    ref_lon + (dx_c * lon_scale),
                    ref_lat + (dy_c * lat_scale)
                ]

            # د) حساب الاتجاه
            try:
                rect = cv2.minAreaRect(np.array(poly, dtype=np.float32))
                orientation_deg = float(rect[2])
            except Exception:
                orientation_deg = 0.0

            # هـ) حساب درجة الثقة
            confidence_pct = round(score * 100.0, 2)

            # و) التحويل للوحدات الزراعية
            feddan, qirat, sahm = self._convert_to_agricultural_units(area_sqm)

            # ز) التخزين في الذاكرة المشتركة
            memory.add_task_layer(
                task_id=task_id,
                layer_name=label,
                polygons=[poly],
                geo_polygons=[geo_poly],
                area_sq_meters=area_sqm,
                area_feddan=feddan,
                area_qirat=qirat,
                area_sahm=sahm,
                metadata={
                    "description": f"قطعة معتمدة من نوع {label}",
                    "pixel_scale": pixel_scale,
                    "score": score,
                    "perimeter_meters": round(perimeter_meters, 2),
                    "centroid_pixel": centroid_px,
                    "centroid_geo": centroid_geo,
                    "orientation_degrees": round(orientation_deg, 2),
                    "confidence_percentage": confidence_pct
                }
            )

            # ح) رسم المعالم على الصورة النهائية
            color = COLOR_MAP.get(label, COLOR_MAP['unknown'])
            try:
                cv2.polylines(original_image, [np.array(poly, dtype=np.int32)], True, color, max(1, line_thickness))
            except Exception:
                cv2.polylines(original_image, [np.array(poly, dtype=np.int32)], True, (0, 0, 255), 1)

            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="RESULT",
                content=(
                    f"تم استخلاص قطعة ({label}): المساحة = {area_sqm:.2f} م² | "
                    f"المحيط = {perimeter_meters:.2f} م | الثقة = {confidence_pct}% | "
                    f"{feddan} فدان، {qirat} قيراط، {sahm:.2f} سهم."
                ),
                payload={"layer_name": label, "area_sq_meters": area_sqm, "confidence": confidence_pct}
            )

        # 5. توليد التقرير الفني الشامل وحفظه في بيانات المهمة
        avg_confidence = 0.0
        if resolved_polys:
            avg_confidence = round(sum(item['score'] for item in resolved_polys) / len(resolved_polys) * 100.0, 2)
            
        projection_quality = "High (GeoTIFF metadata)" if (transform is not None and len(transform) == 6) else "Medium (Reference coordinates)"

        extraction_report = {
            "total_entities_extracted": len(resolved_polys),
            "entity_counts": entity_counts,
            "coverage_percentage": coverage_pct,
            "gap_count": gap_count,
            "total_gap_area_sq_meters": round(total_gap_area_px * (pixel_scale ** 2), 2),
            "average_confidence_percentage": avg_confidence,
            "projection_quality": projection_quality,
            "created_at": datetime.now().isoformat()
        }

        # حفظ التقرير في حقل metadata الخاص بالمهمة في قاعدة البيانات
        task_meta["extraction_report"] = extraction_report
        with memory._get_connection() as conn:
            import json
            conn.execute(
                "UPDATE tasks SET metadata = ? WHERE task_id = ?",
                (json.dumps(task_meta), task_id)
            )
            conn.commit()

        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="SYSTEM",
            content=(
                f"📊 تقرير الاستخراج الفني للوكيل الأول: "
                f"نسبة التغطية = {coverage_pct}% | عدد الكيانات = {len(resolved_polys)} | "
                f"الفجوات = {gap_count} | متوسط الثقة = {avg_confidence}% | "
                f"جودة الإسقاط = {projection_quality}"
            ),
            payload=extraction_report
        )

        # 6. حفظ الصورة النهائية المعالجة
        processed_path = None
        try:
            processed_filename = f"{task_id}_processed.png"
            processed_path = os.path.join(os.path.dirname(image_path), processed_filename)
            cv2.imwrite(processed_path, original_image)
            memory.update_task_processed_image(task_id, processed_path)
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="ACTION",
                content=f"تم حفظ الصورة النهائية المعالجة: {processed_filename}"
            )
        except Exception as err:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content=f"تعذر حفظ الصورة النهائية المعالجة: {str(err)}"
            )

        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="COMPLETED",
            content="اكتملت مهمة الإسقاط وحفظ طبقة الأراضي بنجاح."
        )

        return {
            "messages": state.get("messages", []) + [f"{self.name} has finished extracting land layers."],
            "next_agent": "coordinator"
        }

    def _load_geo_metadata(self, image_path: str):
        if rasterio is None:
            return None
        try:
            with rasterio.open(image_path) as ds:
                if ds.crs is None or ds.transform is None:
                    return None
                return {
                    'crs': str(ds.crs),
                    'transform': ds.transform.to_gdal(),
                    'width': ds.width,
                    'height': ds.height,
                    'count': ds.count,
                    'bounds': {
                        'left': ds.bounds.left,
                        'bottom': ds.bounds.bottom,
                        'right': ds.bounds.right,
                        'top': ds.bounds.top,
                    }
                }
        except Exception:
            return None

    def _pixel_to_geo(self, pt: List[int], transform: Tuple[float, float, float, float, float, float]) -> List[float]:
        # rasterio.transform.to_gdal() returns transform in GDAL order:
        # (c, a, b, f, d, e)
        c, a, b, f, d, e = transform
        col, row = pt[0], pt[1]
        x = a * col + b * row + c
        y = d * col + e * row + f
        return [float(x), float(y)]

    def _convert_to_agricultural_units(self, area_sqm: float) -> Tuple[int, int, float]:
        """دالة مساعدة لتحويل الأمتار المربعة إلى فدان، قيراط، وسهم."""
        # 1 فدان = 4200.83 متر مربع
        feddan = int(area_sqm // 4200.83)
        remaining = area_sqm % 4200.83
        
        # 1 قيراط = 175.03 متر مربع
        qirat = int(remaining // 175.03)
        remaining = remaining % 175.03
        
        # 1 سهم = 7.29 متر مربع
        sahm = round(remaining / 7.29, 2)
        return feddan, qirat, sahm
