import sqlite3
import json
import os
import traceback
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

class SharedMemory:
    """
    الذاكرة المشتركة المدعومة بقاعدة بيانات SQLite.
    تُستخدم لحفظ حالة المهام، بيانات الطبقات الجغرافية، والمراسلات بين الوكلاء.
    """
    def __init__(self, db_path: str = "shared_memory.db"):
        if not os.path.isabs(db_path):
            project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
            db_path = os.path.join(project_root, db_path)
        self.db_path = os.path.abspath(db_path)
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._init_db()

    def _get_connection(self):
        # إنشاء اتصال مع قاعدة بيانات SQLite وتعيين row_factory لقراءة النتائج كقواميس
        # enable a longer timeout and allow connections from worker threads
        conn = sqlite3.connect(self.db_path, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            # enable WAL for better concurrency across threads/processes
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
        except Exception:
            pass
        return conn

    def _init_db(self):
        """تهيئة جداول قاعدة البيانات إذا لم تكن موجودة مسبقاً."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute("PRAGMA journal_mode=WAL;")
            except Exception:
                pass
            
            # 1. جدول المهام (tasks): يحفظ حالة كل طلب تحليل
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    image_path TEXT,
                    processed_image_path TEXT,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Ensure processed_image_path exists on older schemas
            cursor.execute("PRAGMA table_info(tasks)")
            columns = [row[1] for row in cursor.fetchall()]
            if 'processed_image_path' not in columns:
                cursor.execute("ALTER TABLE tasks ADD COLUMN processed_image_path TEXT")
            if 'image_hash' not in columns:
                cursor.execute("ALTER TABLE tasks ADD COLUMN image_hash TEXT")
            
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
            # 4. جدول حالة المربعات (task_tiles): لحفظ حالة كل جزء وتوفير إمكانية الاستئناف
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS task_tiles (
                    tile_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    tile_row INTEGER NOT NULL,
                    tile_col INTEGER NOT NULL,
                    y_start INTEGER NOT NULL,
                    y_end INTEGER NOT NULL,
                    x_start INTEGER NOT NULL,
                    x_end INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(task_id, tile_row, tile_col),
                    FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE CASCADE
                )
            """)
            conn.commit()

    # --- عمليات إدارة المهام (Tasks) ---
    
    def create_task(self, task_id: str, image_path: str, metadata: Optional[Dict[str, Any]] = None, image_hash: Optional[str] = None) -> bool:
        """إنشاء مهمة تحليل جديدة في قاعدة البيانات."""
        return self.ensure_task_record(task_id, image_path, metadata=metadata, status="PENDING", image_hash=image_hash)

    def ensure_task_record(self, task_id: str, image_path: str, metadata: Optional[Dict[str, Any]] = None, status: str = "PENDING", image_hash: Optional[str] = None) -> bool:
        """تأمين وجود سجل المهمة، وإنشاؤه أو تحديثه بطريقة آمنة."""
        metadata_str = json.dumps(metadata or {})
        now = datetime.now().isoformat()
        try:
            with self._get_connection() as conn:
                conn.execute(
                    """
                    INSERT INTO tasks (task_id, image_path, status, metadata, created_at, updated_at, image_hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(task_id) DO UPDATE SET
                        image_path = excluded.image_path,
                        status = excluded.status,
                        metadata = excluded.metadata,
                        updated_at = excluded.updated_at,
                        image_hash = excluded.image_hash
                    """,
                    (task_id, image_path, status, metadata_str, now, now, image_hash)
                )
                conn.commit()
                print(f"[SharedMemory] ensure_task_record: {task_id} -> {self.db_path} ({status})")
            return True
        except Exception as e:
            print(f"[SharedMemory] ensure_task_record ERROR for {task_id}: {e}")
            traceback.print_exc()
            return False

    def update_task_status(self, task_id: str, status: str) -> bool:
        """تحديث حالة المهمة الحالية (مثال: من PENDING إلى RUNNING أو COMPLETED)."""
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.execute(
                "UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?",
                (status, now, task_id)
            )
            if cursor.rowcount == 0:
                conn.execute(
                    "INSERT INTO tasks (task_id, image_path, status, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (task_id, None, status, "{}", now, now)
                )
            conn.commit()
            print(f"[SharedMemory] update_task_status: {task_id} -> {status} in {self.db_path}")
            return True

    def update_task_processed_image(self, task_id: str, processed_image_path: str) -> bool:
        """حفظ مسار الصورة النهائية المعالجة في المهمة."""
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.execute(
                "UPDATE tasks SET processed_image_path = ?, updated_at = ? WHERE task_id = ?",
                (processed_image_path, now, task_id)
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
                print(f"[SharedMemory] get_task: found {task_id} in {self.db_path}")
                return data
            else:
                print(f"[SharedMemory] get_task: NOT FOUND {task_id} in {self.db_path}")
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

    def get_completed_task_by_hash(self, image_hash: str) -> Optional[Dict[str, Any]]:
        """البحث عن مهمة مكتملة بنجاح تمتلك نفس بصمة الصورة."""
        if not image_hash:
            return None
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM tasks WHERE image_hash = ? AND status = 'COMPLETED' ORDER BY created_at DESC LIMIT 1",
                (image_hash,)
            ).fetchone()
            if row:
                data = dict(row)
                data['metadata'] = json.loads(data['metadata']) if data['metadata'] else {}
                print(f"[SharedMemory] get_completed_task_by_hash: found {data['task_id']} for hash {image_hash}")
                return data
        return None

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

    # --- عمليات إدارة تقسيم الصور (Tiling) ---
    
    def init_task_tiles(self, task_id: str, tiles_list: List[Tuple[int, int, int, int, int, int]]) -> None:
        """
        تسجيل جميع الأجزاء (Tiles) لمهمة ما في قاعدة البيانات إذا لم تكن مسجلة مسبقاً.
        tiles_list: قائمة بـ (row, col, y_start, y_end, x_start, x_end)
        """
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            # نتجاهل الأجزاء الموجودة مسبقاً (لتجاوز المشاكل عند الاستئناف)
            conn.executemany(
                """
                INSERT OR IGNORE INTO task_tiles (task_id, tile_row, tile_col, y_start, y_end, x_start, x_end, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
                """,
                [(task_id, t[0], t[1], t[2], t[3], t[4], t[5], now, now) for t in tiles_list]
            )
            conn.commit()
            
    def get_pending_tiles(self, task_id: str) -> List[Dict[str, Any]]:
        """جلب الأجزاء التي لم تكتمل بعد."""
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM task_tiles WHERE task_id = ? AND status != 'COMPLETED' ORDER BY tile_row ASC, tile_col ASC", 
                (task_id,)
            ).fetchall()
            return [dict(r) for r in rows]

    def update_tile_status(self, task_id: str, tile_row: int, tile_col: int, status: str) -> bool:
        """تحديث حالة مربع معين (مثلاً PENDING -> COMPLETED)."""
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.execute(
                "UPDATE task_tiles SET status = ?, updated_at = ? WHERE task_id = ? AND tile_row = ? AND tile_col = ?",
                (status, now, task_id, tile_row, tile_col)
            )
            conn.commit()
            return cursor.rowcount > 0
