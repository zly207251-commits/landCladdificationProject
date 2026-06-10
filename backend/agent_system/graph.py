from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END

from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from agent_system.coordinator import CoordinatorAgent
from agent_system.projection_agent import ProjectionAgent
from agent_system.land_agent import LandAgent
from agent_system.image_inspector_agent import ImageInspectorAgent
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
    coordinator = CoordinatorAgent(message_bus, active_specialists=["land_agent"])
    image_inspector = ImageInspectorAgent(message_bus)
    projection_agent = ProjectionAgent(message_bus, segmenter)
    land_agent = LandAgent(message_bus)
    
    # 2. إنشاء هيكل الرسم البياني للحالة المشتركة
    workflow = StateGraph(SwarmState)
    
    # 3. تسجيل عقد الوكلاء (Nodes) في الرسم البياني
    workflow.add_node("coordinator", lambda state: coordinator.run(state, memory))
    workflow.add_node("image_inspector", lambda state: image_inspector.run(state, memory))
    workflow.add_node("projection_agent", lambda state: projection_agent.run(state, memory))
    workflow.add_node("land_agent", lambda state: land_agent.run(state, memory))
    
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
            
        # الخطوة الأولى دائماً هي فحص الصورة (إذا لم يتم بعد)
        if next_step == "image_inspector":
            return "image_inspector"
            
        # بعد فحص الصورة، نقرا النتيجة
        image_is_aerial = state.get("image_is_aerial")
        
        if image_is_aerial is True:
            # إذا كانت صورة جوية، نتابع التحليل
            if next_step in ["projection_agent", "land_agent"]:
                return next_step
            else:
                return END
                
        elif image_is_aerial is False:
            # إذا لم تكن صورة جوية، ننهي المهمة
            return END
            
        return END
        
    # إضافة الحواف الشرطية (Conditional Edges) انطلاقاً من المنسق
    workflow.add_conditional_edges(
        "coordinator",
        router,
        {
            "image_inspector": "image_inspector",
            "projection_agent": "projection_agent",
            "land_agent": "land_agent",
            END: END
        }
    )
    
    # إضافة حافة من فحص الصورة للمنسق مرة أخرى
    workflow.add_edge("image_inspector", "coordinator")
    # إضافة الحواف العادية للرجوع إلى المنسق
    workflow.add_edge("projection_agent", "coordinator")
    workflow.add_edge("land_agent", "coordinator")
    
    # 6. تجميع وبناء الرسم البياني للتشغيل
    return workflow.compile()
