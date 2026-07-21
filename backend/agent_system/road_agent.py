from typing import Dict, Any
from agent_system.base import BaseAgent
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus

class RoadAgent(BaseAgent):
    """
    وكيل الطرق.
    يتلقى طبقة الطرق من الذاكرة المشتركة ويصنفها.
    """
    def __init__(self, message_bus: MessageBus):
        super().__init__("road_agent")
        self.message_bus = message_bus

    def run(self, state: Dict[str, Any], memory: SharedMemory) -> Dict[str, Any]:
        task_id = state.get("task_id")
        
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="START",
            content="بدء تصنيف وتوصيف طبقة الطرق المستخرجة."
        )
        
        layers = memory.get_task_layers(task_id)
        if not layers:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content="لم يتم العثور على أي طبقات في الذاكرة المشتركة لمعالجتها."
            )
        else:
            road_names = {"roads", "road", "شارع", "شوارع", "طريق", "طرق"}
            road_layers = [lyr for lyr in layers if (lyr.get("layer_name") or "").strip().lower() in road_names]
            
            if not road_layers:
                self.message_bus.publish(task_id=task_id, sender=self.name, message_type="INFO", content="لا توجد شوارع ليتم تصنيفها.")
            else:
                for layer in road_layers:
                    layer_id = layer["layer_id"]
                    area_sqm = layer["area_sq_meters"]
                    
                    if area_sqm > 1000:
                        local_class = "طريق رئيسي معبد"
                    elif area_sqm > 300:
                        local_class = "طريق فرعي"
                    else:
                        local_class = "ممر ترابي / زقاق"
                    
                    desc = f"{local_class} بمساحة تقدر بـ {area_sqm:.1f} متر مربع"
                    
                    feature_id = layer.get("feature_id")
                    if feature_id:
                        memory.update_feature_analysis(feature_id, {
                            "class_name": local_class,
                            "road_type": local_class
                        })
                    
                    self.message_bus.publish(
                        task_id=task_id,
                        sender=self.name,
                        message_type="RESULT",
                        content=f"تم تصنيف الطريق رقم {layer_id}: {desc}"
                    )
                
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="COMPLETED",
            content="اكتمل تصنيف وتحليل طبقة الشوارع/الطرق."
        )
        
        completed = state.get("completed_specialists", [])[:]
        completed.append(self.name)
        
        return {
            "messages": state.get("messages", []) + [f"{self.name} has finished classifying road layers."],
            "completed_specialists": completed,
            "next_agent": "coordinator"
        }
