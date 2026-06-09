from pathlib import Path

# Patch agent_system/graph.py
path = Path('agent_system/graph.py')
text = path.read_text(encoding='utf-8')
old = '''from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END

from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.coordinator import CoordinatorAgent
from agent_system.projection_agent import ProjectionAgent
from agent_system.land_agent import LandAgent
'''
new = '''from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END

from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.coordinator import CoordinatorAgent
from agent_system.projection_agent import ProjectionAgent
from agent_system.land_agent import LandAgent
from land_classifier import LandSegmenterSAM
'''
if old not in text:
    raise SystemExit('graph.py import block not matched')
text = text.replace(old, new)
old = 'def create_swarm_graph(memory: SharedMemory, message_bus: MessageBus):\n'
new = 'def create_swarm_graph(memory: SharedMemory, message_bus: MessageBus, segmenter: LandSegmenterSAM):\n'
if old not in text:
    raise SystemExit('graph.py signature not matched')
text = text.replace(old, new)
old = '    coordinator = CoordinatorAgent(message_bus, active_specialists=["land_agent"])
    projection_agent = ProjectionAgent(message_bus)
'
new = '    coordinator = CoordinatorAgent(message_bus, active_specialists=["land_agent"])
    projection_agent = ProjectionAgent(message_bus, segmenter)
'
if old not in text:
    raise SystemExit('graph.py projection init not matched')
text = text.replace(old, new)
path.write_text(text, encoding='utf-8')

# Patch agent_system/projection_agent.py
path = Path('agent_system/projection_agent.py')
text = path.read_text(encoding='utf-8')
old = '''import numpy as np
from typing import Dict, Any, List, Tuple
from agent_system.base import BaseAgent
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
'''
new = '''import os
import cv2
import numpy as np
from typing import Dict, Any, List, Tuple
from agent_system.base import BaseAgent
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from land_classifier import LandSegmenterSAM
'''
if old not in text:
    raise SystemExit('projection imports not matched')
text = text.replace(old, new)
old = '''class ProjectionAgent(BaseAgent):
    """
    وكيل الإسقاط ورسم المعالم.
    يتولى تحويل نقاط المضلعات من بكسل الصورة إلى إحداثيات جغرافية حقيقية،
    ويقوم بحساب المساحات بالمتر المربع والوحدات التقليدية (فدان، قيراط، سهم).
    """
    def __init__(self, message_bus: MessageBus):
        super().__init__("projection_agent")
        self.message_bus = message_bus

    def run(self, state: Dict[str, Any], memory: SharedMemory) -> Dict[str, Any]:
'''
new = '''class ProjectionAgent(BaseAgent):
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
'''
if old not in text:
    raise SystemExit('projection init not matched')
text = text.replace(old, new)
old = '''        # توليد مضلعات وهمية لمحاكاة استخراج المعالم من نموذج SAM لكل من الطبقات الأربع
        # المضلعات تعبر عن نقاط بكسل على الصورة [x, y]
        mock_layers_data = [
'''
new = '''        # قراءة الصورة الفعلية من المسار وتحويلها إلى مضلعات باستخدام نموذج SAM
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
                content="لم يتم استخراج أي مضلعات من نموذج SAM. سيتم استخدام طبقة أرض افتراضية للاختبار."
            )
            polygons = [
                [[100, 100], [600, 100], [600, 600], [100, 600], [100, 100]]
            ]

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
'''
if old not in text:
    raise SystemExit('projection body not matched')
text = text.replace(old, new)
path.write_text(text, encoding='utf-8')

# Patch api.py
path = Path('api.py')
text = path.read_text(encoding='utf-8')
old = '''def run_agent_swarm_background(task_id: str, image_path: str):
    """دالة تُنفذ في الخلفية لتشغيل تدفق الوكلاء عبر LangGraph دون إيقاف الواجهة."""
    try:
        # بناء وتشغيل الرسم البياني للوكلاء
        compiled_graph = create_swarm_graph(memory, message_bus)
'''
new = '''def run_agent_swarm_background(task_id: str, image_path: str):
    """دالة تُنفذ في الخلفية لتشغيل تدفق الوكلاء عبر LangGraph دون إيقاف الواجهة."""
    try:
        # بناء وتشغيل الرسم البياني للوكلاء
        compiled_graph = create_swarm_graph(memory, message_bus, segmenter)
'''
if old not in text:
    raise SystemExit('api run_agent_swarm_background not matched')
text = text.replace(old, new)
path.write_text(text, encoding='utf-8')

print('PATCH_DONE')
