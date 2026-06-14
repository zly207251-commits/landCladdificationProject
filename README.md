# LandCladdificationProject

## نظرة عامة

هذا المشروع هو نظام تحليل صور جوية وجغرافية يعتمد على:
- واجهة أمامية `Next.js` في `land-classification-frontend`
- واجهة خلفية `FastAPI` في `backend`
- نظام وكلاء ذكي `Geo-AI Swarm` يستخدم `LangGraph`
- تحليل وحدود الأراضي باستخدام نموذج `SAM` و `OpenCV`
- دعم صور عادية وصور جغرافية (GeoTIFF)

## هيكل المشروع

- `backend/`
  - `api.py`: نقطة الدخول الرئيسية لخادم FastAPI.
  - `agent_system/`: منطق الوكلاء وتدفق العمل.
    - `projection_agent.py`: تحويل الحدود من بكسل إلى إحداثيات جغرافية.
    - `graph.py`: تجميع الرسم البياني لوكلاء LangGraph.
    - `land_agent.py`, `coordinator.py`, `memory.py`, `messaging.py`: إدارة الحالة والتراسل.
  - `requirements.txt`: مكتبات بايثون المطلوبة.
  - `run_sam.ipynb`: دفتر ملاحظات لتشغيل النموذج و ngrok في بيئة سحابية.

- `land-classification-frontend/`
  - `app/components/UploadPortal.tsx`: واجهة رفع الصورة وخيارات نوع الصورة.
  - `app/lib/map-config.ts`: إعدادات API ومراحل المعالجة.
  - `next.config.ts`: إعادة توجيه `/api/*` إلى `NEXT_PUBLIC_BACKEND_URL`.
  - `app/results/ResultsClient.tsx`: استعلام التقرير وعرض الصورة النهائية.

## طريقة عمل التحليل

### 1. رفع الصورة

في الواجهة الأمامية:
- المستخدم يختار نوع الصورة:
  - `regular` (صورة عادية)
  - `geospatial` (صورة جغرافية)
- تُرفع الصورة عبر `POST /tasks/analyze`.
- تُرسل بيانات مصاحبة:
  - `image_type`
  - `geospatial_crs`
  - `use_geo_metadata`
  - `pixel_scale_meters`
  - `ref_latitude`
  - `ref_longitude`

### 2. التعامل في `backend/api.py`

نقطة النهاية `POST /tasks/analyze`:
- تحفظ الملف في `temp_uploads/`
- تنشئ مهمة جديدة في ذاكرة SQLite
- إذا كانت الصورة `geospatial` و `use_geo_metadata = True`:
  - تحاول قراءة بيانات GeoTIFF باستخدام `rasterio`
  - تخزن `crs` و `transform` و `bounds`
- تطلق مهمة تحليل على خلفية باستخدام `BackgroundTasks`

### 3. تحليل الصورة وإسقاط الحدود

في `backend/agent_system/projection_agent.py`:
- تقرأ الصورة عبر `cv2.imread()`
- تستدعي نموذج `SAM` لاستخراج الحدود polygon
- تحسب المساحة بالبكسل ثم تحوّلها إلى متر مربع باستخدام `pixel_scale_meters`
- إذا توفرت بيانات GeoTIFF صالحة و `transform`:
  - تتحول النقاط من بكسل إلى إحداثيات جغرافية حقيقية عبر `_pixel_to_geo()`
- إذا لم تتوفر metadata:
  - تستخدم طريقة fallback تعتمد على `pixel_scale_meters` و `ref_latitude` و `ref_longitude`

### 4. مخرجات المهمة

النقاط النهائية:
- `GET /tasks/{task_id}/status`
- `GET /tasks/{task_id}/report`
- `GET /tasks/{task_id}/image`
- `GET /tasks/{task_id}/logs`

التقرير يشمل:
- اسم الطبقة
- المساحة بالمتر المربع
- المساحة بالفدان والقيراط والسهم
- `geo_polygons`
- الوصف والتصنيفات المحلية

## متطلبات النظام

### متطلبات بايثون

يُنصح باستخدام Python 3.11 أو أحدث.

المكتبات المطلوبة يتم ذكرها في `backend/requirements.txt`:
- `opencv-python-headless`
- `numpy`
- `matplotlib`
- `Pillow`
- `torch`
- `torchvision`
- `fastapi`
- `uvicorn`
- `python-multipart`
- `requests`
- `git+https://github.com/facebookresearch/segment-anything.git`
- `langgraph`
- `langchain-core`
- `rasterio==1.3.8`
- `geopandas==0.14.0`
- `shapely==2.0.1`
- `fiona==1.9.3`
- `ezdxf`
- `simplekml`

### متطلبات الواجهة الأمامية

`land-classification-frontend/package.json` يحتوي على:
- `next@15.2.3`
- `react@19.2.7`
- `react-dom@19.2.7`
- `react-dropzone`
- `react-leaflet`
- `leaflet`
- `axios`
- `tailwindcss`
- `typescript`
- `eslint`

### متطلبات النظام العام

- منفذ `8000` للباك اند
- منفذ `3000` لواجهة Next.js
- متغيّر بيئة `NEXT_PUBLIC_BACKEND_URL` عند استخدام الـ proxy أو ngrok
- إذا كان الملف جغرافيًا، يجب أن يكون `GeoTIFF` صالحًا أو أن تدخل البيانات الجغرافية يدوياً

## إعداد وتشغيل

### Backend

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd land-classification-frontend
npm install
npm run dev
```

### تشغيل مع proxy (ngrok أو خادم بعيد)

- ضع رابط الخلفية في متغير البيئة `NEXT_PUBLIC_BACKEND_URL`
- ثم أعد تشغيل `npm run dev`
- `next.config.ts` يعيد توجيه `/api/:path*` إلى هذا الرابط

## ملاحظات فنية مهمة

- `backend/api.py` يدعم حالياً تحميل صور عادية وجغرافية.
- الصورة الجغرافية تُعالج بدقة أكبر عندما تحتوي على بيانات GeoTIFF.
- إذا لم تتوفر metadata أو كانت غير صالحة، فالنظام يستخدم طريقة fallback تقريبية.
- `ProjectionAgent` يقوم بتحويل المضلعات إلى `geo_polygons` ويحسب المساحة الزراعية.
- `land-classification-frontend/app/components/UploadPortal.tsx` يضيف حقول اختيار نوع الصورة وإعدادات CRS.

## ملفات مهمة للمراجعة

- `backend/api.py`
- `backend/agent_system/projection_agent.py`
- `backend/agent_system/graph.py`
- `backend/requirements.txt`
- `land-classification-frontend/app/components/UploadPortal.tsx`
- `land-classification-frontend/app/lib/map-config.ts`
- `land-classification-frontend/next.config.ts`
- `land-classification-frontend/package.json`

## توصيات

- عند استخدام صور GeoTIFF، فعّل `use_geo_metadata` للحصول على أفضل دقة.
- افحص أن `rasterio` مثبت وأن الملف يحتوي على `transform` صالح.
- إذا عملت على بيئة Windows، تأكد من فتح المنفذ `8000` و `3000` وعدم وجود خدمة أخرى تستخدمهما.

---

هذا README يجمَع متطلبات النظام ويشرح تفاصيل تدفق البيانات بين الفرونت اند والباك اند بشكل تحليلي ومنظم.