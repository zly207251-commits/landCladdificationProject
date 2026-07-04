import os
from celery import Celery

# تهيئة خادم Redis كوسيط رسائل (Message Broker) ونتائج (Backend)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "land_classification",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["tasks"]
)

# إعدادات Celery العامة
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Riyadh",
    enable_utc=True,
    # تحديد أقصى وقت للمهمة لمنع الجمود (5 إلى 10 دقائق كحد أقصى)
    task_time_limit=600,
    task_soft_time_limit=300,
)

if __name__ == "__main__":
    celery_app.start()
