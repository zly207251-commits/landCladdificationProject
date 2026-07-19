import os
import sqlite3

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None
    RealDictCursor = None

DATABASE_URL = os.getenv("DATABASE_URL")

# مخططات وجداول قاعدة البيانات المكانية لسهولة التعديل مستقبلاً
TABLES_SQL = {
    "tasks": {
        "postgres": """
            CREATE TABLE IF NOT EXISTS tasks (
                task_id VARCHAR(100) PRIMARY KEY,
                image_path TEXT,
                processed_image_path TEXT,
                image_hash VARCHAR(100),
                status VARCHAR(50) NOT NULL,
                metadata JSONB,
                country VARCHAR(50) DEFAULT 'Yemen',
                governorate VARCHAR(100),
                district VARCHAR(100),
                tile_id VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """,
        "sqlite": """
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                image_path TEXT,
                processed_image_path TEXT,
                image_hash TEXT,
                status TEXT NOT NULL,
                metadata TEXT,
                country TEXT DEFAULT 'Yemen',
                governorate TEXT,
                district TEXT,
                tile_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """
    },
    "spatial_features": {
        "postgres": """
            CREATE TABLE IF NOT EXISTS spatial_features (
                feature_id VARCHAR(100) PRIMARY KEY,
                task_id VARCHAR(100) NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
                feature_type VARCHAR(100) NOT NULL,
                geom GEOMETRY(Polygon, 4326),
                centroid GEOMETRY(Point, 4326),
                area_sqm DOUBLE PRECISION,
                area_feddan INTEGER,
                area_qirat INTEGER,
                area_sahm DOUBLE PRECISION,
                perimeter_meters DOUBLE PRECISION,
                confidence DOUBLE PRECISION,
                image_source TEXT,
                spatial_relations JSONB,
                geometric_features JSONB,
                analysis_results JSONB,
                country VARCHAR(50) DEFAULT 'Yemen',
                governorate VARCHAR(100),
                district VARCHAR(100),
                tile_id VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """,
        "sqlite": """
            CREATE TABLE IF NOT EXISTS spatial_features (
                feature_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                feature_type TEXT NOT NULL,
                geom TEXT, -- WKT Polygon Fallback
                centroid TEXT, -- JSON Point Fallback
                area_sqm REAL,
                area_feddan INTEGER,
                area_qirat INTEGER,
                area_sahm REAL,
                perimeter_meters REAL,
                confidence REAL,
                image_source TEXT,
                spatial_relations TEXT,
                geometric_features TEXT,
                analysis_results TEXT,
                country TEXT DEFAULT 'Yemen',
                governorate TEXT,
                district TEXT,
                tile_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE CASCADE
            );
        """
    },
    "agent_messages": {
        "postgres": """
            CREATE TABLE IF NOT EXISTS agent_messages (
                message_id SERIAL PRIMARY KEY,
                task_id VARCHAR(100) NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
                sender VARCHAR(100) NOT NULL,
                message_type VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                payload JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """,
        "sqlite": """
            CREATE TABLE IF NOT EXISTS agent_messages (
                message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                message_type TEXT NOT NULL,
                content TEXT NOT NULL,
                payload_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (task_id) REFERENCES tasks (task_id) ON DELETE CASCADE
            );
        """
    },
    "reference_gis_data": {
        "postgres": """
            CREATE TABLE IF NOT EXISTS reference_gis_data (
                id VARCHAR(100) PRIMARY KEY,
                city VARCHAR(100) DEFAULT 'Sanaa',
                category VARCHAR(100) NOT NULL,
                geom_type VARCHAR(50) NOT NULL,
                min_lon DOUBLE PRECISION NOT NULL,
                min_lat DOUBLE PRECISION NOT NULL,
                max_lon DOUBLE PRECISION NOT NULL,
                max_lat DOUBLE PRECISION NOT NULL,
                geometry_geojson TEXT NOT NULL,
                properties TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """,
        "sqlite": """
            CREATE TABLE IF NOT EXISTS reference_gis_data (
                id TEXT PRIMARY KEY,
                city TEXT DEFAULT 'Sanaa',
                category TEXT NOT NULL,
                geom_type TEXT NOT NULL,
                min_lon REAL NOT NULL,
                min_lat REAL NOT NULL,
                max_lon REAL NOT NULL,
                max_lat REAL NOT NULL,
                geometry_geojson TEXT NOT NULL,
                properties TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """
    }
}

_USE_POSTGRES = None

def get_db_connection(db_path: str = "shared_memory.db"):
    """دالة مصنع لإنشاء اتصالات قواعد البيانات بناءً على الإعداد الحالي."""
    global _USE_POSTGRES
    
    if _USE_POSTGRES is not False and DATABASE_URL and psycopg2 is not None:
        try:
            # محاولة الاتصال بـ Postgres مع مهلة 3 ثواني لتجنب البطء في حال عدم توفره
            conn = psycopg2.connect(DATABASE_URL, connect_timeout=3)
            _USE_POSTGRES = True
            return conn
        except Exception as e:
            print(f"⚠️ فشل الاتصال بخادم PostgreSQL: {e}. يتم التراجع إلى SQLite...")
            _USE_POSTGRES = False
    
    conn = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def is_postgresql() -> bool:
    """التحقق مما إذا كانت قاعدة البيانات النشطة هي PostgreSQL."""
    global _USE_POSTGRES
    if _USE_POSTGRES is None:
        # اختبار الاتصال مرة واحدة وحفظ النتيجة لتجنب البطء
        if DATABASE_URL and psycopg2 is not None:
            try:
                conn = get_db_connection()
                conn.close()
            except Exception:
                pass
        else:
            _USE_POSTGRES = False
    return _USE_POSTGRES is True

def format_query(query: str) -> str:
    """تنسيق الاستعلامات حسب نوع قاعدة البيانات (تحويل %s إلى ? في SQLite)."""
    if is_postgresql():
        return query
    return query.replace("%s", "?")
