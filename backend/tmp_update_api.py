from pathlib import Path

path = Path('api.py')
text = path.read_text(encoding='utf-8')
needle = "app = FastAPI(\n    title=\"نظام فريق وكلاء التحليل الجغرافي (Geo-AI Swarm)\",\n    description=\"واجهة برمجية للتحليل المساحي الذكي للصور الجوية وإسقاط المساحات بالفدان والقيراط والسهم.\",\n    version=\"2.0\"\n)\n\n# تهيئة قاعدة بيانات الذاكرة المشتركة وباص الرسائل\n"
replacement = "app = FastAPI(\n    title=\"نظام فريق وكلاء التحليل الجغرافي (Geo-AI Swarm)\",\n    description=\"واجهة برمجية للتحليل المساحي الذكي للصور الجوية وإسقاط المساحات بالفدان والقيراط والسهم.\",\n    version=\"2.0\"\n)\n\napp.add_middleware(\n    CORSMiddleware,\n    allow_origins=[\"http://localhost:3000\"],\n    allow_credentials=True,\n    allow_methods=[\"*\"],\n    allow_headers=[\"*\"],\n)\n\n# تهيئة قاعدة بيانات الذاكرة المشتركة وباص الرسائل\n"
if needle in text:
    text = text.replace(needle, replacement)
    path.write_text(text, encoding='utf-8')
    print('UPDATED')
else:
    print('NOT_FOUND')
