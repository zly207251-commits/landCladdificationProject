import json
from typing import Dict, Any, Callable, List
from agent_system.memory import SharedMemory

class MessageBus:
    """
    باص الرسائل القابل للتوسع.
    يتولى توزيع الأحداث والرسائل بين الوكلاء وتوثيقها تلقائياً في قاعدة بيانات الذاكرة المشتركة.
    """
    def __init__(self, memory: SharedMemory):
        self.memory = memory
        # معجم لتسجيل المشتركين في كل موضوع (Topic)
        self.subscribers: Dict[str, List[Callable[[Dict[str, Any]], None]]] = {}

    def subscribe(self, topic: str, callback: Callable[[Dict[str, Any]], None]):
        """الاشتراك في موضوع معين لاستقبال رسائله فور نشرها."""
        topic = topic.upper()
        if topic not in self.subscribers:
            self.subscribers[topic] = []
        self.subscribers[topic].append(callback)

    def publish(self, task_id: str, sender: str, message_type: str, content: str, payload: Dict[str, Any] = None):
        """
        نشر رسالة جديدة.
        تقوم هذه الدالة بحفظ الرسالة في قاعدة البيانات ثم توزيعها على المشتركين المهتمين.
        """
        payload = payload or {}
        # حفظ الرسالة في قاعدة بيانات SQLite للذاكرة المشتركة
        self.memory.log_message(task_id, sender, message_type, content, payload)
        
        event = {
            "task_id": task_id,
            "sender": sender,
            "message_type": message_type,
            "content": content,
            "payload": payload
        }
        
        # استدعاء الدوال المشتركة في هذا النوع من الرسائل
        topic = message_type.upper()
        if topic in self.subscribers:
            for callback in self.subscribers[topic]:
                try:
                    callback(event)
                except Exception as e:
                    print(f"[باص الرسائل] خطأ أثناء استدعاء المشترك لـ {topic}: {e}")

        # استدعاء دوال الاشتراكات العامة (التي تشترك باستخدام علامة *)
        if "*" in self.subscribers:
            for callback in self.subscribers["*"]:
                try:
                    callback(event)
                except Exception as e:
                    print(f"[باص الرسائل] خطأ في الاشتراك العام: {e}")

    def display_pretty_logs(self, task_id: str):
        """عرض السجل التاريخي للمراسلات في الطرفية بشكل جمالي ومنسق للمطورين."""
        messages = self.memory.get_messages(task_id)
        if not messages:
            print(f"لم يتم العثور على أي رسائل للمهمة: {task_id}")
            return
            
        print("\n" + "="*85)
        print(f" 📜 سجل أحداث وتخاطب فريق الوكلاء | المهمة: {task_id}")
        print("="*85)
        
        for msg in messages:
            sender = msg['sender'].upper()
            msg_type = msg['message_type'].upper()
            content = msg['content']
            timestamp = msg['created_at']
            
            # تحديد رمز تعبيري مناسب لنوع الرسالة لسهولة القراءة البصرية
            emoji = "🔹"
            if msg_type in ["ERROR", "FAILED"]:
                emoji = "❌"
            elif msg_type == "WARNING":
                emoji = "⚠️"
            elif msg_type in ["RESULT", "COMPLETED"]:
                emoji = "✅"
            elif msg_type in ["ACTION", "EXTRACT"]:
                emoji = "🚀"
            elif msg_type in ["START", "PENDING"]:
                emoji = "🔄"
            elif msg_type == "SYSTEM":
                emoji = "⚙️"
                
            print(f"[{timestamp}] {emoji} [{sender}] ({msg_type}): {content}")
            if msg['payload']:
                # تحويل القاموس إلى نص منسق لعرضه
                payload_str = json.dumps(msg['payload'], ensure_ascii=False)
                # اختصار النص إذا كان طويلاً جداً
                if len(payload_str) > 120:
                    payload_str = payload_str[:120] + "... }"
                print(f"      📊 البيانات: {payload_str}")
        print("="*85 + "\n")
