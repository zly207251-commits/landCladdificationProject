from typing import Dict, Any
from agent_system.base import BaseAgent
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus

class LandAgent(BaseAgent):
    """
    وكيل الأراضي الزراعية.
    يتلقى طبقة الأراضي من الذاكرة المشتركة ويصنف كل قطعة بالاعتماد على القاموس المحلي
    (مثل: جربة، رفد، حول) وتوصيف تربتها وعلاقتها بالمياه، ثم يحدث سجلها في قاعدة البيانات.
    """
    def __init__(self, message_bus: MessageBus):
        super().__init__("land_agent")
        self.message_bus = message_bus

    def run(self, state: Dict[str, Any], memory: SharedMemory) -> Dict[str, Any]:
        task_id = state.get("task_id")
        
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="START",
            content="بدء تصنيف وتوصيف طبقة الأراضي المستخرجة وتطبيق القاموس المحلي."
        )
        
        # استرجاع كل طبقات المهمة من الذاكرة المشتركة SQLite.
        # يستخدم ProjectionAgent أسماء الطبقات بحسب التصنيف المستخلص من SAM، لذلك لا نعتمد على اسم ثابت 'lands'.
        layers = memory.get_task_layers(task_id)
        if not layers:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content="لم يتم العثور على أي طبقات في الذاكرة المشتركة لمعالجتها."
            )
        else:
            layer_names = sorted({layer['layer_name'] for layer in layers})
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="ACTION",
                content=f"اكتُشفت الطبقات التالية: {', '.join(layer_names)}. سيتم تصنيفها جميعاً." 
            )
            non_land = {"buildings", "water", "roads", "unknown", "مبنى", "وادي", "شارع", "وغيرها"}
            for layer in layers:
                layer_id = layer["layer_id"]
                layer_name = (layer.get("layer_name") or "").strip().lower()
                area_sqm = layer["area_sq_meters"]

                # تخطّي الطبقات التي نعرف أنها ليست أراضٍ
                if layer_name in non_land:
                    self.message_bus.publish(
                        task_id=task_id,
                        sender=self.name,
                        message_type="INFO",
                        content=f"تجاوزت طبقة غير أرضية: {layer_name} (layer_id={layer_id})"
                    )
                    continue
                
                # تصنيف محلي ديناميكي يعتمد على مساحة قطعة الأرض الزراعية (من قاموس الأوقاف المحلي):
                # - إذا كانت المساحة > 10,000 م² -> تصنف 'حَوْل' أو 'حَرُورَة' (حقول سهلية شاسعة)
                # - إذا كانت المساحة بين 3,000 و 10,000 م² -> تصنف 'جِرْبَة زراعية' (حقل كبير للزراعة الموسمية)
                # - إذا كانت المساحة بين 1,000 و 3,000 م² -> تصنف 'كُرْوَة' (حقل متوسط)
                # - إذا كانت المساحة أقل من 1,000 م² -> تصنف 'رَفْد' (موضع ضيق وممتد طولاً بين الجبال)
                if area_sqm > 10000:
                    local_class = "حَوْل / حَرُورَة"
                    soil_type = "تربة دقيقة (ناعمة تتوسط الوادي)"
                    water_relation = "مَعِين (مروي بماء الغيل الجاري)"
                elif area_sqm > 3000:
                    local_class = "جِرْبَة زراعية"
                    soil_type = "تربة مِخْلَطَة (تربة خصبة غنية)"
                    water_relation = "شَطّ (محاذية لمجرى السيول الرئيسي)"
                elif area_sqm > 1000:
                    local_class = "كُرْوَة"
                    soil_type = "تربة حَجِرَة (تربة مختلطة بحجارة صغيرة)"
                    water_relation = "رَدْحَة (أرض معرضة لتجريف السيول)"
                else:
                    local_class = "رَفْد ضيق"
                    soil_type = "تربة حُمَرَة (طينية مائلة للحمرة)"
                    water_relation = "وِدِن (مرتفع عن الوادي ويصعب ريه)"
                
                desc = f"{local_class} | نوع التربة: {soil_type} | علاقة المياه: {water_relation}"
                
                # تحديث نتائج التحليل والتصنيف في الذاكرة المشتركة بشكل جذري وآمن
                feature_id = layer.get("feature_id")
                if feature_id:
                    memory.update_feature_analysis(feature_id, {
                        "class_name": local_class,
                        "soil_type": soil_type,
                        "water_relation": water_relation
                    })
                
                self.message_bus.publish(
                    task_id=task_id,
                    sender=self.name,
                    message_type="RESULT",
                    content=f"تم تصنيف القطعة رقم {layer_id}: الاسم المحلي = {local_class} | {desc}"
                )
                
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="COMPLETED",
            content="اكتمل تصنيف وتحليل طبقة الأراضي الزراعية."
        )
        
        # تسجيل اكتمال هذا الوكيل وتحديث الحالة للمنسق
        completed = state.get("completed_specialists", [])[:]
        completed.append(self.name)
        
        return {
            "messages": state.get("messages", []) + [f"{self.name} has finished classifying land layers."],
            "completed_specialists": completed,
            "next_agent": "coordinator"
        }
