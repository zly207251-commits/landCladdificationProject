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
        
        if current_status == "PENDING":
            # تحديث حالة المهمة لتبدأ العمل الفعلي
            memory.update_task_status(task_id, "RUNNING")
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="START",
                content=f"بدء تنفيذ المهمة {task_id}. تنظيم مسار فريق العمل."
            )
            
            # الخطوة الأولى دائماً هي استدعاء وكيل الإسقاط لاستخراج الطبقات
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="SYSTEM",
                content="الخطوة 1: استدعاء وكيل الإسقاط ورسم حدود المعالم والطبقات الجغرافية."
            )
            return {
                "next_agent": "projection_agent"
            }
            
        elif current_status == "RUNNING":
            # التأكد من نجاح وكيل الإسقاط في إنشاء الطبقات في قاعدة البيانات
            layers = memory.get_task_layers(task_id)
            if not layers:
                self.message_bus.publish(
                    task_id=task_id,
                    sender=self.name,
                    message_type="WARNING",
                    content="لم يتم استخراج أي طبقات معالم بعد. إعادة توجيه الطلب لوكيل الإسقاط."
                )
                return {"next_agent": "projection_agent"}
                
            # مراجعة قائمة التخصصات المطلوب تشغيلها ومقارنتها بالوكلاء المكتملين
            completed_specialists = state.get("completed_specialists", [])
            
            for specialist in self.active_specialists:
                # إذا لم يكن الوكيل الخبير قد تم تشغيله بعد، يتم توجيه العمل له فوراً
                if specialist not in completed_specialists:
                    self.message_bus.publish(
                        task_id=task_id,
                        sender=self.name,
                        message_type="SYSTEM",
                        content=f"توجيه البيانات الجغرافية والطبقات إلى الوكيل الخبير النشط: {specialist}"
                    )
                    return {"next_agent": specialist}
                    
            # في حال اكتمال تشغيل كافة الوكلاء المتخصصين المحددين
            memory.update_task_status(task_id, "COMPLETED")
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="COMPLETED",
                content=f"اكتملت كافة خطوات التحليل بنجاح للمهمة: {task_id}"
            )
            return {
                "next_agent": "end"
            }
            
        return {
            "next_agent": "end"
        }
