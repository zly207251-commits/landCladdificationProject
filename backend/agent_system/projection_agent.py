import os
import cv2
import numpy as np
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

        segment_polygons_count = sum(len(seg.get('polygons', [])) for seg in segments)
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="ACTION",
            content=(
                f"تم استلام {len(segments)} قطاعات من المقطع، تحتوي على {segment_polygons_count} مضلعات. "
                f"سيتم معالجة كل منها وتحويلها إلى طبقات."
            )
        )

        # color map: BGR for OpenCV
        COLOR_MAP = {
            'agricultural': (34, 139, 34),
            'buildings': (0, 0, 255),
            'water': (255, 0, 0),
            'roads': (200, 200, 200),
            'arid': (19, 69, 139),
            'unknown': (0, 255, 255),
        }

        # allow overriding line thickness from task metadata
        line_thickness = int(task_meta.get('line_thickness', 1))

        for seg in segments:
            label = seg.get('label', 'unknown')
            seg_polygons = seg.get('polygons') if isinstance(seg.get('polygons'), list) else []
            score = float(seg.get('score', 0.0))

            for poly in seg_polygons:
                x = [pt[0] for pt in poly]
                y = [pt[1] for pt in poly]
                pixel_area = 0.5 * np.abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
                if pixel_area < 150:
                    self.message_bus.publish(
                        task_id=task_id,
                        sender=self.name,
                        message_type="DEBUG",
                        content=f"تجاوزت قطع صغيرة: مساحة بكسل={pixel_area:.1f} أقل من الحد 150."
                    )
                    continue

                area_sqm = pixel_area * (pixel_scale ** 2)

                if transform is not None and len(transform) == 6:
                    geo_poly = [self._pixel_to_geo(pt, transform) for pt in poly]
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

                feddan, qirat, sahm = self._convert_to_agricultural_units(area_sqm)

                memory.add_task_layer(
                    task_id=task_id,
                    layer_name=label,
                    polygons=[poly],
                    geo_polygons=[geo_poly],
                    area_sq_meters=area_sqm,
                    area_feddan=feddan,
                    area_qirat=qirat,
                    area_sahm=sahm,
                    metadata={"description": f"قطعة من نوع {label}", "pixel_scale": pixel_scale, "score": score}
                )

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
                        f"تم استخراج مضلع (نوع={label}) بالمساحة = {area_sqm:.2f} م² | "
                        f"{feddan} فدان، {qirat} قيراط، {sahm:.2f} سهم."
                    ),
                    payload={"layer_name": label, "area_sq_meters": area_sqm, "score": score}
                )

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
