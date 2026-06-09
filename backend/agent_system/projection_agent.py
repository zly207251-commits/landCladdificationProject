import os
import cv2
import numpy as np
from typing import Dict, Any, List, Tuple
from agent_system.base import BaseAgent
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from land_classifier import LandSegmenterSAM

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

        image = cv2.imread(image_path)
        if image is None:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="ERROR",
                content=f"تعذر قراءة الصورة من المسار: {image_path}"
            )
            memory.update_task_status(task_id, "FAILED")
            return {"next_agent": "end"}

        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="ACTION",
            content="تشغيل نموذج SAM لاستخراج حدود قطع الأراضي من الصورة الجوية."
        )

        polygons = self.segmenter.segment_image(image)
        if not polygons:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content="لم يتم استخراج أي مضلعات من نموذج SAM. سيتم استخدام قطعة أرض افتراضية للاختبار."
            )
            polygons = [[[100, 100], [600, 100], [600, 600], [100, 600], [100, 100]]]

        for poly in polygons:
            x = [pt[0] for pt in poly]
            y = [pt[1] for pt in poly]
            pixel_area = 0.5 * np.abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
            if pixel_area < 500:
                continue

            area_sqm = pixel_area * (pixel_scale ** 2)

            lat_scale = 1.0 / 111111.0
            lon_scale = 1.0 / (111111.0 * np.cos(np.radians(ref_lat)))
            geo_poly = []
            for pt in poly:
                dx = pt[0] * pixel_scale
                dy = -pt[1] * pixel_scale
                point_lat = ref_lat + (dy * lat_scale)
                point_lon = ref_lon + (dx * lon_scale)
                geo_poly.append([point_lat, point_lon])

            feddan, qirat, sahm = self._convert_to_agricultural_units(area_sqm)

            memory.add_task_layer(
                task_id=task_id,
                layer_name="lands",
                polygons=[poly],
                geo_polygons=[geo_poly],
                area_sq_meters=area_sqm,
                area_feddan=feddan,
                area_qirat=qirat,
                area_sahm=sahm,
                metadata={"description": "قطعة أرض مستخرجة بواسطة SAM", "pixel_scale": pixel_scale}
            )

            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="RESULT",
                content=(
                    f"تم استخراج قطعة أرض بالمساحة = {area_sqm:.2f} م² | "
                    f"{feddan} فدان، {qirat} قيراط، {sahm:.2f} سهم."
                ),
                payload={"layer_name": "lands", "area_sq_meters": area_sqm}
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
