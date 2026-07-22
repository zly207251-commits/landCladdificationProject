from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import os
import uvicorn

# استيراد المكونات المشتركة
from routes.shared import memory, DB_PATH, BASE_DIR

app = FastAPI(
    title="نظام فريق وكلاء التحليل الجغرافي (Geo-AI Swarm)",
    description="واجهة برمجية للتحليل المساحي الذكي للصور الجوية وإسقاط المساحات بالفدان والقيراط والسهم.",
    version="2.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

@app.middleware("http")
async def add_cors_headers_to_all_responses(request: Request, call_next):
    if request.method == "OPTIONS":
        response = Response(status_code=204)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
        response.headers["Access-Control-Max-Age"] = "600"
        return response

    try:
        response = await call_next(request)
    except Exception:
        response = JSONResponse(status_code=500, content={"detail": "Internal server error"})

    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    response.headers["Access-Control-Max-Age"] = "600"
    return response

@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
    response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    return response

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    response = JSONResponse(status_code=422, content={"detail": exc.errors()})
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    return response

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    response = JSONResponse(status_code=500, content={"detail": "Internal server error"})
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    return response

# Diagnostic info at startup
print(f"[startup] BASE_DIR={BASE_DIR}")
try:
    print(f"[startup] DB_PATH configured: {DB_PATH}")
    print(f"[startup] SharedMemory.db_path: {getattr(memory, 'db_path', '<missing>')}")
    print(f"[startup] DB exists at startup: {os.path.exists(DB_PATH)}")
except Exception:
    pass

# استيراد وتسجيل الموجهات (Routers)
from routes.tasks import tasks_router
from routes.upload import upload_router
from routes.export import export_router
from routes.gis import gis_router

app.include_router(tasks_router)
app.include_router(upload_router)
app.include_router(export_router)
app.include_router(gis_router)

@app.get("/", response_class=HTMLResponse, summary="الصفحة الترحيبية للواجهة")
def get_welcome_page():
    html = """
    <html>
        <head>
            <title>Geo-AI Swarm API</title>
            <style>
                body { font-family: sans-serif; text-align: center; padding-top: 100px; background-color: #f7fafc; color: #2d3748; }
                h1 { color: #3182ce; }
            </style>
        </head>
        <body>
            <h1>🤖 Geo-AI Swarm Backend API v2.0</h1>
            <p>سيرفر الذكاء الاصطناعي لفريق الوكلاء وتصنيف الأراضي والمباني والطرق.</p>
            <p>تصفح توثيق واجهة البرمجة عبر الرابط: <a href="/docs">/docs</a></p>
        </body>
    </html>
    """
    return HTMLResponse(html)

if __name__ == "__main__":
    use_reload = os.getenv("BACKEND_RELOAD", "false").lower() in {"1", "true", "yes"}
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8000,
        reload=use_reload,
    )