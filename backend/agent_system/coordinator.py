from typing import Dict, Any, List
from agent_system.base import BaseAgent
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus

class CoordinatorAgent(BaseAgent):
    """
    وكيل المنسق الرئيسي (Orchestrator).
    يتولى إدارة تدفق وتوزيع المهام بين الوكلاء وتحديث حالة التقدم في قاعدة البيانات.
    """
    def __init__(self, message_bus: MessageBus, active_specialists: List[str] = None):
        super().__init__("coordinator")
        self.message_bus = message_bus
        
        # تفعيل وكيل الأراضي فقط وتعليق الوكلاء الآخرين مؤقتاً في هذه المرحلة
        # المطورون يمكنهم لاحقاً إضافة "road_agent", "water_agent" إلى هذه القائمة لتفعيلهم تلقائياً
        self.active_specialists = active_specialists or ["land_agent"]

    def run(self, state: Dict[str, Any], memory: SharedMemory) -> Dict[str, Any]:
        task_id = state.get("task_id")
        
        # جلب حالة المهمة الحالية من الذاكرة المشتركة
        task_info = memory.get_task(task_id)
        if not task_info:
            raise ValueError(f"Task with ID {task_id} not found in database.")
            
        current_status = task_info["status"]
        
        # الحصول على قيمة image_is_aerial من الحالة
        image_is_aerial = state.get("image_is_aerial")
        
        if current_status == "PENDING":
            # تحديث الحالة إلى RUNNING
            memory.update_task_status(task_id, "RUNNING")
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="START",
                content=f"بدء تنفيذ المهمة {task_id}. تنظيم مسار فريق العمل."
            )
            
            # الخطوة الأولى دائماً: فحص الصورة
            return {
                "next_agent": "image_inspector"
            }
            
        elif current_status == "RUNNING":
            # تحقق مما إذا كان لدينا نتيجة فحص الصورة
            if image_is_aerial is None:
                # لم نقم بفحص الصورة بعد → ارسل إلى فاحص الصورة
                return {"next_agent": "image_inspector"}
                
            if image_is_aerial is False:
                # الصورة ليست جوية → ننهي المهمة
                self.message_bus.publish(
                    task_id=task_id,
                    sender=self.name,
                    message_type="WARNING",
                    content="الصورة لا تبدو صورة جوية. يتم إيقاف التحليل."
                )
                memory.update_task_status(task_id, "FAILED")
                return {"next_agent": "end"}
                
            # الصورة جوية → نكمل التحليل
            layers = memory.get_task_layers(task_id)
            
            if not layers:
                # لم يتم استخراج طبقات بعد → ارسل إلى وكيل الإسقاط
                self.message_bus.publish(
                    task_id=task_id,
                    sender=self.name,
                    message_type="SYSTEM",
                    content="الخطوة التالية: استخراج المعالم وتحديد المساحات."
                )
                return {"next_agent": "projection_agent"}
                
            # تحقق من الوكلاء المتخصصين الذين لم يتم تشغيلهم بعد
            completed_specialists = state.get("completed_specialists", [])
            
            for specialist in self.active_specialists:
                if specialist not in completed_specialists:
                    self.message_bus.publish(
                        task_id=task_id,
                        sender=self.name,
                        message_type="SYSTEM",
                        content=f"توجيه البيانات إلى الوكيل المتخصص: {specialist}"
                    )
                    return {"next_agent": specialist}
                    
            # إذا اكتمل كل شيء → نجاح المهمة!
            memory.update_task_status(task_id, "COMPLETED")
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="COMPLETED",
                content=f"🎉 اكتمل التحليل بنجاح للمهمة: {task_id}"
            )
            return {"next_agent": "end"}
            
        return {"next_agent": "end"}
