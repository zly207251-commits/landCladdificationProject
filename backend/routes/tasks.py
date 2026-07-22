from fastapi import APIRouter, HTTPException, BackgroundTasks, Response
from fastapi.responses import StreamingResponse, FileResponse
import os
import io
import json
import cv2
import uuid
import traceback
from pydantic import BaseModel
from typing import Dict, Any

from routes.shared import memory, message_bus, get_segmenter, UPLOAD_DIR, launch_background_processing
from routes.shared import rasterio, transform_bounds, from_bounds

tasks_router = APIRouter(prefix="/tasks", tags=["tasks"])

class StyleConfig(BaseModel):
    color: str
    width: int
    dash: str = "solid"
    fillOpacity: float = 0.2

class TaskStyleRequest(BaseModel):
    styles: Dict[str, StyleConfig]

@tasks_router.get("", summary="6. جلب قائمة المهام السابقة")
def get_all_tasks():
    tasks = memory.get_tasks(limit=1000)
    return {"tasks": tasks}

@tasks_router.delete("/{task_id}", summary="مسح مهمة وكل بياناتها من السيرفر")
def delete_task(task_id: str):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة غير موجودة.")
    
    success = memory.delete_task(task_id)
    if not success:
        raise HTTPException(status_code=500, detail="فشل مسح سجل المهمة من قاعدة البيانات.")
        
    try:
        image_path = task.get("image_path")
        if image_path and os.path.exists(image_path):
            os.remove(image_path)
            
        processed_image_path = task.get("processed_image_path")
        if processed_image_path and os.path.exists(processed_image_path):
            os.remove(processed_image_path)
            
        if image_path:
            base_p, _ = os.path.splitext(image_path)
            tfw_path = base_p + ".tfw"
            if os.path.exists(tfw_path):
                os.remove(tfw_path)
    except Exception as file_err:
        print(f"Warning: could not delete physical files for task {task_id}: {file_err}")
        
    return {"message": "تم مسح المهمة وجميع بياناتها وملفاتها المرتبطة بنجاح."}

@tasks_router.get("/debug", summary="Debug current task storage")
def debug_task_storage(limit: int = 20):
    print(f"[api] debug_task_storage request limit={limit}")
    tasks = memory.get_tasks(limit=limit)
    return {
        "db_path": memory.db_path,
        "task_count": len(tasks),
        "tasks": tasks
    }

@tasks_router.get("/{task_id}/messages", summary="Get task messages")
def get_task_messages(task_id: str):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    msgs = memory.get_messages(task_id)
    return {"task_id": task_id, "messages": msgs}

@tasks_router.post("/{task_id}/retry", summary="Retry processing for a failed task")
def retry_task_processing(task_id: str, background_tasks: BackgroundTasks):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.get("status") != "FAILED":
        raise HTTPException(status_code=400, detail="يمكن إعادة المحاولة فقط للمهمات التي فشلت سابقاً.")

    image_path = task.get("image_path")
    if not image_path or not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="الصورة المرفوعة للمهمة غير موجودة.")

    memory.log_message(task_id, "system", "RETRY", "إعادة محاولة معالجة المهمة بعد الفشل.", {})
    memory.update_task_status(task_id, "PENDING")
    launch_background_processing(task_id, image_path)

    return {
        "task_id": task_id,
        "status": "PENDING",
        "message": "تمت إعادة محاولة معالجة المهمة بنجاح."
    }

@tasks_router.post("/{task_id}/style", summary="حفظ المظهر المخصص للمهمة في قاعدة البيانات")
def save_task_style(task_id: str, request: TaskStyleRequest):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
    
    meta = task.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
            
    meta["styling"] = {k: v.dict() for k, v in request.styles.items()}
    
    image_path = task.get("image_path")
    status = task.get("status")
    image_hash = task.get("image_hash")
    
    success = memory.ensure_task_record(task_id, image_path, metadata=meta, status=status, image_hash=image_hash)
    if not success:
         raise HTTPException(status_code=500, detail="فشل حفظ إعدادات التنسيق في قاعدة البيانات.")
         
    return {"message": "تم حفظ إعدادات التنسيق بنجاح.", "styling": meta["styling"]}

@tasks_router.post("/{task_id}/regenerate-preview", summary="إعادة رندرة الصورة الجوية المعالجة بالمظهر المخصص")
def regenerate_task_preview(task_id: str):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
    
    image_path = task.get("image_path")
    if not image_path or not os.path.exists(image_path):
        raise HTTPException(status_code=400, detail="الملف الأصلي للصورة غير متوفر لإعادة الرسم.")
    
    try:
        from agent_system.projection_agent import ProjectionAgent
        agent = ProjectionAgent(memory, message_bus, get_segmenter())
        agent._generate_processed_preview(image_path, task_id, memory)
        
        updated_task = memory.get_task(task_id)
        processed_path = updated_task.get("processed_image_path")
        
        return {
            "message": "تمت إعادة توليد صورة المعاينة بنجاح.",
            "processed_image_path": processed_path,
            "processed_image_url": f"/tasks/{task_id}/image/processed"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل إعادة الرسم: {str(e)}")

@tasks_router.get("/{task_id}/status", summary="Get task status - الاستعلام عن حالة المهمة")
def get_task_status(task_id: str):
    try:
        task = memory.get_task(task_id)
        if not task:
            return {
                "task_id": task_id,
                "status": "NOT_FOUND",
                "exists": False,
                "message": "المهمة غير موجودة في قاعدة البيانات"
            }

        tile_stats = {"total": 0, "completed": 0, "failed": 0, "pending": 0}
        try:
            from agent_system.db_config import get_db_connection, format_query
            db_path = memory.db_path or "shared_memory.db"
            with get_db_connection(db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(format_query("SELECT COUNT(*) FROM task_tiles WHERE task_id = %s"), (task_id,))
                total = cursor.fetchone()[0]
                cursor.execute(format_query("SELECT COUNT(*) FROM task_tiles WHERE task_id = %s AND status = 'COMPLETED'"), (task_id,))
                completed = cursor.fetchone()[0]
                cursor.execute(format_query("SELECT COUNT(*) FROM task_tiles WHERE task_id = %s AND status = 'FAILED'"), (task_id,))
                failed = cursor.fetchone()[0]
                
                tile_stats = {
                    "total": total,
                    "completed": completed,
                    "failed": failed,
                    "pending": total - completed - failed
                }
        except Exception as tile_err:
            print(f"[api] tile_stats error: {tile_err}")

        memory_info = {"total_gb": 0.0, "used_gb": 0.0, "free_gb": 0.0, "process_rss_gb": 0.0, "percent": 0.0}
        try:
            import psutil
            vm = psutil.virtual_memory()
            process = psutil.Process(os.getpid())
            memory_info = {
                "total_gb": round(vm.total / (1024**3), 2),
                "used_gb": round(vm.used / (1024**3), 2),
                "free_gb": round(vm.available / (1024**3), 2),
                "process_rss_gb": round(process.memory_info().rss / (1024**3), 2),
                "percent": vm.percent
            }
        except Exception as mem_err:
            print(f"[api] memory_info error: {mem_err}")
            try:
                with open("/proc/self/status") as f:
                    for line in f:
                        if line.startswith("VmRSS:"):
                            parts = line.split()
                            rss_gb = round(float(parts[1]) / (1024 * 1024), 2)
                            memory_info["process_rss_gb"] = rss_gb
                            break
            except Exception:
                pass

        return {
            "task_id": task_id,
            "status": task.get("status", "UNKNOWN"),
            "exists": True,
            "created_at": task.get("created_at"),
            "updated_at": task.get("updated_at"),
            "tile_stats": tile_stats,
            "memory_info": memory_info
        }
    except Exception as e:
        error_msg = f"Error in get_task_status: {str(e)}"
        print(error_msg)
        traceback.print_exc()
        return {
            "task_id": task_id,
            "status": "ERROR",
            "exists": False,
            "message": error_msg
        }

@tasks_router.get("/{task_id}/logs", summary="جلب سجلات وكلاء المعالجة بالتفصيل")
def get_task_logs(task_id: str):
    try:
        task = memory.get_task(task_id)
        if not task:
            return {
                "task_id": task_id,
                "exists": False,
                "message": "المهمة غير موجودة في قاعدة البيانات",
                "logs": []
            }
        
        messages = memory.get_messages(task_id)
        log_summary = {
            "total_messages": len(messages),
            "by_type": {},
            "by_agent": {},
            "first_message": None,
            "last_message": None
        }
        
        for msg in messages:
            msg_type = msg.get("message_type", "UNKNOWN")
            log_summary["by_type"][msg_type] = log_summary["by_type"].get(msg_type, 0) + 1
            sender = msg.get("sender", "unknown")
            log_summary["by_agent"][sender] = log_summary["by_agent"].get(sender, 0) + 1
        
        if messages:
            log_summary["first_message"] = {
                "created_at": messages[0].get("created_at"),
                "sender": messages[0].get("sender"),
                "message_type": messages[0].get("message_type"),
                "content": messages[0].get("content", "")[:100]
            }
            log_summary["last_message"] = {
                "created_at": messages[-1].get("created_at"),
                "sender": messages[-1].get("sender"),
                "message_type": messages[-1].get("message_type"),
                "content": messages[-1].get("content", "")[:100]
            }
        
        return {
            "task_id": task_id,
            "exists": True,
            "task_status": task.get("status"),
            "log_summary": log_summary,
            "logs": [
                {
                    "id": msg.get("message_id"),
                    "created_at": msg.get("created_at"),
                    "sender": msg.get("sender"),
                    "type": msg.get("message_type"),
                    "content": msg.get("content"),
                    "payload": msg.get("payload", {})
                }
                for msg in messages
            ]
        }
    except Exception as e:
        error_msg = f"Error in get_task_logs: {str(e)}"
        print(error_msg)
        traceback.print_exc()
        return {
            "task_id": task_id,
            "exists": False,
            "message": f"خطأ في جلب السجلات: {str(e)}",
            "logs": []
        }

@tasks_router.get("/{task_id}/report", summary="3. جلب التقرير المساحي النهائي والطبقات")
def get_task_report(task_id: str):
    """
    جلب التقرير الهندسي والمساحي النهائي للطبقات المستخرجة بالفدان والقيراط والسهم والتسميات المحلية.
    """
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
        
    layers = memory.get_task_layers(task_id)
    
    # تجهيز كائن التقرير
    report_layers = []
    for ly in layers:
        report_layers.append({
            "layer_name": ly["layer_name"],
            "area_sq_meters": ly["area_sq_meters"],
            "area_agricultural": f"{ly['area_feddan']} فدان، {ly['area_qirat']} قيراط، {ly['area_sahm']:.2f} سهم",
            "local_classification": ly["metadata"].get("local_classification", {}),
            "description": ly["metadata"].get("description", ""),
            "polygons_count": len(ly["polygons"]),
            # إرسال إحداثيات الإسقاط الجغرافي للخرائط التفاعلية
            "geo_polygons": ly["geo_polygons"]
        })
        
    # Build GeoJSON FeatureCollection for frontend convenience
    features = []
    sum_lon = 0.0
    sum_lat = 0.0
    count_coords = 0
    for ly in layers:
        layer_name = ly.get('layer_name')
        metadata = ly.get('metadata') or {}
        geo_polygons = ly.get('geo_polygons') or []
        for polygon in geo_polygons:
            # polygon may be a ring or nested [[ring]]; normalize to ring
            ring = polygon
            if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                ring = polygon[0]

            # ensure coordinates are [lon, lat] and closed
            norm_ring = []
            for pt in ring:
                if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                    continue
                lon = float(pt[0])
                lat = float(pt[1])
                norm_ring.append([lon, lat])
                sum_lon += lon
                sum_lat += lat
                count_coords += 1

            if len(norm_ring) >= 3:
                # close ring
                if norm_ring[0] != norm_ring[-1]:
                    norm_ring.append(norm_ring[0])

                feature = {
                    "type": "Feature",
                    "properties": {
                        "name": layer_name,
                        "layer_name": layer_name,
                        "metadata": metadata
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [norm_ring]
                    }
                }
                features.append(feature)

    geojson = {"type": "FeatureCollection", "features": features}
    map_center = None
    map_zoom = None
    if count_coords > 0:
        avg_lon = sum_lon / count_coords
        avg_lat = sum_lat / count_coords
        # MapViewer/Leaflet expects [lat, lon] for center
        map_center = [avg_lat, avg_lon]
        map_zoom = 17

    processed_image_url = None
    if task.get("processed_image_path") and os.path.exists(task["processed_image_path"]):
        processed_image_url = f"/tasks/{task_id}/image/processed"

    return {
        "task_id": task_id,
        "status": task["status"],
        "created_at": task["created_at"],
        "updated_at": task["updated_at"],
        "image_path": task["image_path"],
        "image_url": f"/tasks/{task_id}/image",
        "processed_image_url": processed_image_url,
        "metadata": task["metadata"],
        "layers": report_layers,
        "geojson": geojson,
        "map_center": map_center,
        "map_zoom": map_zoom
    }

@tasks_router.get("/{task_id}/image", summary="4. جلب صورة المهمة الأصلية")
def get_task_image(task_id: str):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
    image_path = task["image_path"]
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="الصورة غير موجودة على الخادم.")
    _, ext = os.path.splitext(image_path)
    ext = ext.lower()
    if ext in [".tif", ".tiff", ".geotiff"]:
        try:
            image = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
            if image is None:
                raise ValueError("تعذر قراءة الصورة الجغرافية")
            if len(image.shape) == 2:
                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
            elif image.shape[2] == 4:
                image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
            _, buffer = cv2.imencode(".png", image)
            return StreamingResponse(io.BytesIO(buffer.tobytes()), media_type="image/png")
        except Exception:
            return FileResponse(image_path, filename=os.path.basename(image_path))

    return FileResponse(image_path, filename=os.path.basename(image_path))

@tasks_router.get("/{task_id}/image/processed", summary="4b. جلب الصورة النهائية المعالجة")
def get_task_processed_image(task_id: str):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")

    processed_path = task.get("processed_image_path")
    if not processed_path or not os.path.exists(processed_path):
        raise HTTPException(status_code=404, detail="الصورة النهائية غير متاحة.")

    _, ext = os.path.splitext(processed_path)
    ext = ext.lower()
    if ext in [".tif", ".tiff", ".geotiff"]:
        try:
            image = cv2.imread(processed_path, cv2.IMREAD_UNCHANGED)
            if image is None:
                raise ValueError("تعذر قراءة الصورة النهائية")
            if len(image.shape) == 2:
                image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
            elif image.shape[2] == 4:
                image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
            _, buffer = cv2.imencode(".png", image)
            return StreamingResponse(io.BytesIO(buffer.tobytes()), media_type="image/png")
        except Exception:
            return FileResponse(processed_path, filename=os.path.basename(processed_path))

    return FileResponse(processed_path, filename=os.path.basename(processed_path))

@tasks_router.get("/{task_id}/crop", summary="7. قص صورة المهمة الجغرافية حسب حدود الإحداثيات")
def crop_task_image(
    task_id: str,
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float
):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")

    image_path = task["image_path"]
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="الصورة غير موجودة على الخادم.")

    if rasterio is None or transform_bounds is None or from_bounds is None:
        raise HTTPException(status_code=500, detail="Rasterio مطلوب لتنفيذ القص الجغرافي.")

    task_meta = task.get("metadata", {}) or {}
    geo_metadata = task_meta.get("geo_metadata") if task_meta.get("image_type") == "geospatial" else None

    try:
        with rasterio.open(image_path) as src:
            if src.crs is None:
                raise ValueError("مصدر الصورة لا يحتوي على CRS صالح.")
            if not geo_metadata or not geo_metadata.get("crs"):
                geo_metadata = {
                    "crs": str(src.crs)
                }

            min_lon_val = min(min_lon, max_lon)
            max_lon_val = max(min_lon, max_lon)
            min_lat_val = min(min_lat, max_lat)
            max_lat_val = max(min_lat, max_lat)

            src_min_lon, src_min_lat, src_max_lon, src_max_lat = transform_bounds(
                "EPSG:4326",
                src.crs,
                min_lon_val,
                min_lat_val,
                max_lon_val,
                max_lat_val,
                densify_pts=21
            )

            window = from_bounds(
                min(src_min_lon, src_max_lon),
                min(src_min_lat, src_max_lat),
                max(src_min_lon, src_max_lon),
                max(src_min_lat, src_max_lat),
                transform=src.transform,
                width=src.width,
                height=src.height
            )
            window = window.round_offsets().round_shape()
            if window.width <= 0 or window.height <= 0:
                raise ValueError("المنطقة المحددة خارج نطاق الصورة الجغرافية.")

            data = src.read(window=window, boundless=True, fill_value=0)
            out_transform = rasterio.windows.transform(window, src.transform)
            out_name = f"{task_id}_crop_{uuid.uuid4().hex[:8]}.tiff"
            out_path = os.path.join(UPLOAD_DIR, out_name)

            profile = src.profile.copy()
            profile.update({
                "driver": "GTiff",
                "height": data.shape[1],
                "width": data.shape[2],
                "transform": out_transform,
                "count": data.shape[0]
            })

            with rasterio.open(out_path, "w", **profile) as dst:
                dst.write(data)

        return FileResponse(out_path, media_type="image/tiff", filename=out_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل تصدير القص الجغرافي: {str(e)}")
