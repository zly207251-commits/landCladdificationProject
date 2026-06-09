from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseAgent(ABC):
    """
    الفئة الأساسية المجردة (Abstract Base Class) لجميع الوكلاء في نظام الفريق.
    توفر واجهة موحدة لتشغيل المهام والوصول إلى الذاكرة المشتركة.
    """
    def __init__(self, name: str):
        # اسم الوكيل الفريد لتحديده في النظام
        self.name = name

    @abstractmethod
    def run(self, state: Dict[str, Any], memory) -> Dict[str, Any]:
        """
        دالة التشغيل الأساسية التي يجب على كل وكيل تنفيذها.
        
        المعاملات:
            state (Dict[str, Any]): الحالة الحالية الممررة عبر LangGraph.
            memory (SharedMemory): واجهة الوصول لقاعدة بيانات الذاكرة المشتركة SQLite.
            
        المخرجات:
            Dict[str, Any]: التحديثات على الحالة لدمجها في الرسم البياني (LangGraph).
        """
        pass
