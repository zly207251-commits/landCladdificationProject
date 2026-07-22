from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
import os
import io
import cv2
import numpy as np
import uuid
import tempfile
import zipfile
import shutil
import json
from PIL import Image

from routes.shared import memory, get_segmenter, UPLOAD_DIR, ensure_segmenter

gis_router = APIRouter(prefix="", tags=["gis"])

@gis_router.post("/save_map_tiff", summary="حفظ صورة الخريطة كـ TIFF")
async def save_map_tiff(file: UploadFile = File(...), filename: str | None = Form(None)):
    try:
        content = await file.read()
        img = Image.open(io.BytesIO(content)).convert("RGBA")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"تعذر قراءة ملف الصورة: {str(e)}")

    out_name = filename or f"map_capture_{uuid.uuid4().hex[:8]}.tiff"
    out_path = os.path.join(UPLOAD_DIR, out_name)

    try:
        img.save(out_path, format="TIFF")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل حفظ الصورة كـ TIFF: {str(e)}")

    return {"message": "تم الحفظ كـ TIFF بنجاح", "filename": out_name, "path": out_path, "download_url": f"/map_exports/{out_name}"}

@gis_router.get("/map_exports/{fname}", summary="تحميل ملف صادر")
def download_map_export(fname: str):
    path = os.path.join(UPLOAD_DIR, fname)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="الملف غير موجود")
    return FileResponse(path, filename=fname)

@gis_router.post("/segment", summary="استخراج الحدود عبر SAM المباشر (تلوين أخضر)")
async def segment_image(file: UploadFile = File(...)):
    image_bytes = await file.read()
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    
    if img is None:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image")

    seg = ensure_segmenter()
    if seg is None:
        raise HTTPException(status_code=503, detail="SAM model not available")

    segments = seg.segment_image(img)

    for seg_item in segments:
        polys = None
        if isinstance(seg_item, dict):
            polys = seg_item.get("polygons", [])
        elif isinstance(seg_item, (list, tuple)):
            polys = seg_item
        else:
            continue

        for poly in polys:
            try:
                pts = np.array(poly, dtype=np.int32)
                cv2.polylines(img, [pts], True, (0, 255, 0), 2)
            except Exception:
                continue

    _, buffer = cv2.imencode(".png", img)
    return StreamingResponse(io.BytesIO(buffer.tobytes()), media_type="image/png")

@gis_router.post("/gis/convert-shp-zip", summary="تحويل ملف Shapefile ZIP إلى GeoJSON")
async def convert_shp_zip_to_geojson(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="يجب أن يكون الملف بصيغة ZIP مضغوطة.")
        
    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, file.filename)
    
    try:
        with open(zip_path, "wb") as f:
            content = await file.read()
            f.write(content)
            
        extract_dir = os.path.join(temp_dir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(extract_dir)
            
        shp_file = None
        for root, dirs, files in os.walk(extract_dir):
            for f_name in files:
                if f_name.lower().endswith(".shp"):
                    shp_file = os.path.join(root, f_name)
                    break
            if shp_file:
                break
                
        if not shp_file:
            raise HTTPException(status_code=400, detail="لم يتم العثور على ملف بصيغة .shp داخل مجلد الـ ZIP.")
            
        import geopandas as gpd
        gdf = gpd.read_file(shp_file)
        if gdf.crs is None:
            gdf.crs = "EPSG:4326"
        elif gdf.crs != "EPSG:4326":
            gdf = gdf.to_crs("EPSG:4326")
            
        geojson_str = gdf.to_json()
        geojson_data = json.loads(geojson_str)
        
        return geojson_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء معالجة ملف Shapefile: {str(e)}")
    finally:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass

@gis_router.get("/gis/reference/layers", summary="جلب المعالم الجغرافية المرجعية (OSM) من قاعدة البيانات")
def get_gis_reference_layers(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    city: str = "Sanaa",
    category: str = "building"
):
    try:
        features = memory.get_reference_features(city, category, min_lon, min_lat, max_lon, max_lat)
        return {
            "status": "success",
            "type": "FeatureCollection",
            "features": features
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل جلب المعالم المرجعية: {str(e)}")

@gis_router.post("/gis/reference/fetch-bounds", summary="جلب وتخزين معالم جديدة يدويًا من خريطة الشارع المفتوحة لليمن")
def fetch_gis_reference_bounds(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    city: str = "Sanaa"
):
    try:
        from utils_osm import fetch_and_save_osm_reference
        saved_count = fetch_and_save_osm_reference(city, min_lon, min_lat, max_lon, max_lat)
        return {
            "status": "success",
            "message": f"تم جلب وحفظ {saved_count} معلم مرجعي لمدينة {city} بنجاح.",
            "saved_count": saved_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل استدعاء وحفظ معالم خريطة الشارع المفتوحة: {str(e)}")

@gis_router.post("/gis/reference/fetch-google-bounds", summary="جلب وتخزين مباني جوجل ومايكروسوفت الحقيقية (AI) لمنطقة معينة")
def fetch_gis_google_reference_bounds(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    city: str = "Sanaa"
):
    try:
        from utils_osm import fetch_real_google_buildings
        saved_count = fetch_real_google_buildings(city, min_lon, min_lat, max_lon, max_lat)
        return {
            "status": "success",
            "message": f"تم جلب وحفظ {saved_count} مبنى حقيقي من جوجل لمدينة {city} بنجاح.",
            "saved_count": saved_count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل استيراد مباني جوجل من أوفيرتشر: {str(e)}")
