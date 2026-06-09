from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END

from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.coordinator import CoordinatorAgent
from agent_system.projection_agent import ProjectionAgent
from agent_system.land_agent import LandAgent
from land_classifier import LandSegmenterSAM

class SwarmState(TypedDict):
    """
    تحديد معالم وقاموس الحالة المشتركة داخل تدفق الرسم البياني (LangGraph).
    """
    task_id: str
    image_path: str
    messages: List[str]
    completed_specialists: List[str]
    next_agent: str

def create_swarm_graph(memory: SharedMemory, message_bus: MessageBus, segmenter: LandSegmenterSAM):
    """
    بناء وتجميع الرسم البياني (StateGraph) لتحديد تدفق التحكم بين الوكلاء.
    
    المعاملات:
        memory (SharedMemory): واجهة الذاكرة المشتركة SQLite.
        message_bus (MessageBus): باص الرسائل لتسجيل الأحداث.
        segmenter (LandSegmenterSAM): نموذج SAM لاستخراج حدود الأراضي.
    
    المخرجات:
        CompiledStateGraph: الرسم البياني الجاهز للتنفيذ من LangGraph.
    """
    # 1. تهيئة الوكلاء (المنسق، وكيل الإسقاط، ووكيل الأراضي)
    # نلاحظ هنا أن المنسق مهيأ لتشغيل وكيل الأراضي فقط وتعليق الوكلاء الآخرين
    coordinator = CoordinatorAgent(message_bus, active_specialists=["land_agent"])
    projection_agent = ProjectionAgent(message_bus, segmenter)
    land_agent = LandAgent(message_bus)
    
    # 2. إنشاء هيكل الرسم البياني للحالة المشتركة
    workflow = StateGraph(SwarmState)
    
    # 3. تسجيل عقد الوكلاء (Nodes) في الرسم البياني
    # نستخدم دوال Lambda البسيطة لربط تشغيل العقدة بالدالة run في كل كائن وكيل
    workflow.add_node("coordinator", lambda state: coordinator.run(state, memory))
    workflow.add_node("projection_agent", lambda state: projection_agent.run(state, memory))
    workflow.add_node("land_agent", lambda state: land_agent.run(state, memory))
    
    # 4. تعيين المنسق كنقطة البداية والدخول الرئيسية للتدفق
    workflow.set_entry_point("coordinator")
    
    # 5. دالة التوجيه الشرطي (Router) لقراءة خطة المنسق وتحديد الوكيل التالي
    def router(state: SwarmState) -> str:
        next_step = state.get("next_agent", "end")
        if next_step in ["projection_agent", "land_agent"]:
            return next_step
        return "end"
        
    # إضافة الحواف الشرطية (Conditional Edges) انطلاقاً من المنسق
    workflow.add_conditional_edges(
        "coordinator",
        router,
        {
            "projection_agent": "projection_agent",
            "land_agent": "land_agent",
            "end": END
        }
    )
    
    # 6. ربط حواف العودة الافتراضية (Static Edges) لترجع جميعها للمنسق بعد انتهاء مهامها
    workflow.add_edge("projection_agent", "coordinator")
    workflow.add_edge("land_agent", "coordinator")
    
    # 7. تجميع وبناء الرسم البياني للتشغيل
    return workflow.compile()
