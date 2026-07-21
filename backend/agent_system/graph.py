from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END

from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.coordinator import CoordinatorAgent
from agent_system.projection_agent import ProjectionAgent
from agent_system.land_agent import LandAgent
from agent_system.building_agent import BuildingAgent
from agent_system.road_agent import RoadAgent
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
    image_is_aerial: bool  # نتيجة فحص الصورة
    image_confidence: float  # درجة الثقة في نتيجة الفحص
    skip_image_check: bool  # خيار لتجاوز فحص الصورة

def create_swarm_graph(memory: SharedMemory, message_bus: MessageBus, segmenter: LandSegmenterSAM):
    """
    بناء وتجميع الرسم البياني (StateGraph) لتحديد تدفق التحكم بين الوكلاء.
    
    المعاملات:
        memory (SharedMemory): واجهة الذاكرة المشتركة SQLite.
        message_bus (MessageBus): باص الرسائل لتسجيل الأحداث.
        segmenter (LandSegmenterSAM): نموذج SAM لاستخراج حدود قطع الأراضي.
    
    المخرجات:
        CompiledStateGraph: الرسم البياني الجاهز للتنفيذ من LangGraph.
    """
    # 1. تهيئة الوكلاء
    coordinator = CoordinatorAgent(message_bus, active_specialists=["land_agent", "building_agent", "road_agent"])
    projection_agent = ProjectionAgent(message_bus, segmenter)
    land_agent = LandAgent(message_bus)
    building_agent = BuildingAgent(message_bus)
    road_agent = RoadAgent(message_bus)
    
    # 2. إنشاء هيكل الرسم البياني للحالة المشتركة
    workflow = StateGraph(SwarmState)
    
    # 3. تسجيل عقد الوكلاء (Nodes) في الرسم البياني
    workflow.add_node("coordinator", lambda state: coordinator.run(state, memory))
    workflow.add_node("projection_agent", lambda state: projection_agent.run(state, memory))
    workflow.add_node("land_agent", lambda state: land_agent.run(state, memory))
    workflow.add_node("building_agent", lambda state: building_agent.run(state, memory))
    workflow.add_node("road_agent", lambda state: road_agent.run(state, memory))
    
    # 4. تعيين المنسق كنقطة البداية والدخول الرئيسية للتدفق
    workflow.set_entry_point("coordinator")
    
    # 5. دالة التوجيه الشرطي (Router) لقراءة خطة المنسق وتحديد الوكيل التالي
    def router(state: SwarmState) -> str:
        next_step = state.get("next_agent", "end")
        
        # إذا كنا نريد تجاوز فحص الصورة
        if state.get("skip_image_check", False):
            if next_step in ["projection_agent", "land_agent"]:
                return next_step
            return END
            
        # بعد إزالة وكيل فحص الصورة، نوجّه مباشرةً إلى الإسقاط أو المتخصصين حسب الخطة.
        if next_step in ["projection_agent", "land_agent", "building_agent", "road_agent"]:
            return next_step
        return END
        
    # إضافة الحواف الشرطية (Conditional Edges) انطلاقاً من المنسق
    workflow.add_conditional_edges(
        "coordinator",
        router,
        {
            "projection_agent": "projection_agent",
            "land_agent": "land_agent",
            "building_agent": "building_agent",
            "road_agent": "road_agent",
            END: END
        }
    )
    
    # إضافة الحواف العادية للرجوع إلى المنسق
    workflow.add_edge("projection_agent", "coordinator")
    workflow.add_edge("land_agent", "coordinator")
    workflow.add_edge("building_agent", "coordinator")
    workflow.add_edge("road_agent", "coordinator")
    
    # 6. تجميع وبناء الرسم البياني للتشغيل
    return workflow.compile()
