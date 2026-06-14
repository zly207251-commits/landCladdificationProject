import sqlite3
import json
import os
from datetime import datetime
from typing import Dict, Any, List, Optional

class SharedMemory:
    """
    الذاكرة المشتركة المدعومة بقاعدة بيانات SQLite.
    تُستخدم لحفظ حالة المهام، بيانات الطبقات الجغرافية، والمراسلات بين الوكلاء.
    """
    def __init__(self, db_path: str = "shared_memory.db"):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self):
        # إنشاء اتصال مع قاعدة بيانات SQLite وتعيين row_factory لقراءة النتائج كقواميس
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """تهيئة جداول قاعدة البيانات إذا لم تكن موجودة مسبقاً."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            # 1. جدول المهام (tasks): يحفظ حالة كل طلب تحليل
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    image_path TEXT,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # 2. جدول طبقات المعالم (task_layers): يحفظ المضلعات المستخرجة ومساحاتها
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS task_layers (
                    layer_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    layer_name TEXT NOT NULL,
                    polygons_json TEXT NOT NULL,
                    geo_polygons_json TEXT,
                    area_sq_meters REAL,
                    area_feddan INTEGER,
                    area_qirat INTEGER,
                    area_sahm REAL,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE CASCADE
                )
            """)
            
            # 3. جدول رسائل الوكلاء (agent_messages): لتسجيل كل حدث أو رسالة تخاطب متبادلة
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS agent_messages (
                    message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    sender TEXT NOT NULL,
                    message_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    payload_json TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE CASCADE
                )
            """)
            conn.commit()

    # --- عمليات إدارة المهام (Tasks) ---
    
    def create_task(self, task_id: str, image_path: str, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """إنشاء مهمة تحليل جديدة في قاعدة البيانات."""
        metadata_str = json.dumps(metadata or {})
        try:
            with self._get_connection() as conn:
                conn.execute(
                    "INSERT INTO tasks (task_id, image_path, status, metadata) VALUES (?, ?, ?, ?)",
                    (task_id, image_path, "PENDING", metadata_str)
                )
                conn.commit()
            return True
        except sqlite3.IntegrityError:
            # في حال كانت المهمة موجودة مسبقاً
            return False

    def update_task_status(self, task_id: str, status: str) -> bool:
        """تحديث حالة المهمة الحالية (مثال: من PENDING إلى RUNNING أو COMPLETED)."""
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.execute(
                "UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?",
                (status, now, task_id)
            )
            conn.commit()
            return cursor.rowcount > 0

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """الاستعلام عن بيانات مهمة معينة باستخدام معرفها."""
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            if row:
                data = dict(row)
                data['metadata'] = json.loads(data['metadata']) if data['metadata'] else {}
                return data
        return None

    def get_tasks(self, limit: int = 10) -> List[Dict[str, Any]]:
        """جلب قائمة المهام السابقة بترتيب الأحدث أولاً."""
        tasks = []
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT task_id, status, metadata, created_at, updated_at FROM tasks ORDER BY created_at DESC LIMIT ?",
                (limit,)
            ).fetchall()
            for r in rows:
                task = dict(r)
                task['metadata'] = json.loads(task['metadata']) if task['metadata'] else {}
                tasks.append(task)
        return tasks

    # --- عمليات إدارة الطبقات الجغرافية (Layers) ---
    
    def add_task_layer(
        self, 
        task_id: str, 
        layer_name: str, 
        polygons: List[List[List[float]]], 
        geo_polygons: Optional[List[List[List[float]]]] = None,
        area_sq_meters: float = 0.0,
        area_feddan: int = 0,
        area_qirat: int = 0,
        area_sahm: float = 0.0,
        metadata: Optional[Dict[str, Any]] = None
    ) -> int:
        """إضافة طبقة جغرافية مستخرجة وحفظ حسابات مساحتها بالفدان والقيراط والسهم."""
        polygons_json = json.dumps(polygons)
        geo_polygons_json = json.dumps(geo_polygons) if geo_polygons else None
        metadata_json = json.dumps(metadata or {})
        
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO task_layers (
                    task_id, layer_name, polygons_json, geo_polygons_json, 
                    area_sq_meters, area_feddan, area_qirat, area_sahm, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, layer_name, polygons_json, geo_polygons_json,
                 area_sq_meters, area_feddan, area_qirat, area_sahm, metadata_json)
            )
            conn.commit()
            return cursor.lastrowid or 0

    def get_task_layers(self, task_id: str, layer_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """استرجاع الطبقات الجغرافية الخاصة بمهمة معينة."""
        query = "SELECT * FROM task_layers WHERE task_id = ?"
        params = [task_id]
        if layer_name:
            query += " AND layer_name = ?"
            params.append(layer_name)
            
        layers = []
        with self._get_connection() as conn:
            rows = conn.execute(query, params).fetchall()
            for r in rows:
                layer = dict(r)
                layer['polygons'] = json.loads(layer['polygons_json'])
                layer['geo_polygons'] = json.loads(layer['geo_polygons_json']) if layer['geo_polygons_json'] else None
                layer['metadata'] = json.loads(layer['metadata']) if layer['metadata'] else {}
                layers.append(layer)
        return layers

    # --- عمليات إدارة الرسائل والمراسلات (Messaging) ---
    
    def log_message(self, task_id: str, sender: str, message_type: str, content: str, payload: Optional[Dict[str, Any]] = None) -> int:
        """تسجيل رسالة تواصل أو حدث بين الوكلاء في قاعدة البيانات."""
        payload_str = json.dumps(payload or {})
        with self._get_connection() as conn:
            cursor = conn.execute(
                "INSERT INTO agent_messages (task_id, sender, message_type, content, payload_json) VALUES (?, ?, ?, ?, ?)",
                (task_id, sender, message_type, content, payload_str)
            )
            conn.commit()
            return cursor.lastrowid or 0

    def get_messages(self, task_id: str) -> List[Dict[str, Any]]:
        """جلب السجل التاريخي للأحداث والمراسلات الخاصة بمهمة معينة مرتبة زمنياً."""
        messages = []
        with self._get_connection() as conn:
            rows = conn.execute("SELECT * FROM agent_messages WHERE task_id = ? ORDER BY message_id ASC", (task_id,)).fetchall()
            for r in rows:
                msg = dict(r)
                msg['payload'] = json.loads(msg['payload_json']) if msg['payload_json'] else {}
                messages.append(msg)
        return messages
