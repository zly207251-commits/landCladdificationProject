import os
import cv2
import numpy as np
from datetime import datetime
from typing import Dict, Any, List, Tuple
from agent_system.base import BaseAgent
from agent_system.memory import SharedMemory
from agent_system.messaging import MessageBus
from land_classifier import LandSegmenterSAM
from image_tiler import ImageTiler, should_use_tiling

try:
    import rasterio
except ImportError:
    rasterio = None

class ProjectionAgent(BaseAgent):
    def __init__(self, message_bus: MessageBus, segmenter: LandSegmenterSAM):
        super().__init__("projection_agent")
        self.message_bus = message_bus
        self.segmenter = segmenter

    def run(self, state: Dict[str, Any], memory: SharedMemory) -> Dict[str, Any]:
        task_id = state.get("task_id")
        image_path = state.get("image_path")
        
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="START",
            content=f"بدء إسقاط الصورة: {image_path}"
        )
        
        task_info = memory.get_task(task_id)
        task_meta = task_info.get("metadata", {}) if task_info else {}
        
        pixel_scale = float(task_meta.get("pixel_scale_meters", 0.5))
        ref_lat = float(task_meta.get("ref_latitude", 15.3694))
        ref_lon = float(task_meta.get("ref_longitude", 44.1910))
        use_geo_metadata = bool(task_meta.get('use_geo_metadata', False))
        
        self.segmenter.apply_parameters(
            use_fallback=bool(task_meta.get('sam_use_fallback', self.segmenter.use_fallback)),
            min_mask_region_area=int(task_meta.get('sam_min_mask_region_area', self.segmenter.min_mask_region_area)),
            points_per_side=int(task_meta.get('sam_points_per_side', self.segmenter.points_per_side)),
            pred_iou_thresh=float(task_meta.get('sam_pred_iou_thresh', self.segmenter.pred_iou_thresh)),
            stability_score_thresh=float(task_meta.get('sam_stability_score_thresh', self.segmenter.stability_score_thresh)),
        )

        if should_use_tiling(image_path):
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="ACTION",
                content="الصورة ضخمة جداً. سيتم استخدام نظام التقطيع لمعالجتها."
            )
            tiler = ImageTiler()
            tiler.process_image(
                image_path=image_path,
                segmenter=self.segmenter,
                task_id=task_id,
                memory=memory,
                pixel_scale=pixel_scale,
                ref_lat=ref_lat,
                ref_lon=ref_lon,
                message_bus=self.message_bus,
                use_geo_metadata=use_geo_metadata
            )
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="COMPLETED",
                content="اكتملت معالجة الصورة الضخمة (التقطيع)."
            )
            self._generate_processed_preview(image_path, task_id, memory)
            return {
                "messages": state.get("messages", []) + [f"{self.name} finished tiling extraction."],
                "next_agent": "coordinator"
            }

        # --- معالجة الصور الصغيرة العادية المتبقية ---
        image = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if image is None and rasterio is not None:
            try:
                with rasterio.open(image_path) as ds:
                    bands = ds.read()
                    if bands.ndim == 3:
                        if bands.shape[0] >= 3:
                            image = np.stack([bands[0], bands[1], bands[2]], axis=-1)
                        else:
                            image = np.transpose(bands, (1, 2, 0))
                    else:
                        image = bands
                    image = np.asarray(image, dtype=np.uint8)
                    if image.ndim == 2:
                        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
                    elif image.shape[2] == 1:
                        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
                    elif image.shape[2] == 4:
                        image = cv2.cvtColor(image, cv2.COLOR_RGBA2BGR)
            except Exception:
                image = None

        if image is None:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="ERROR",
                content=f"تعذر قراءة الصورة من المسار: {image_path}"
            )
            memory.update_task_status(task_id, "FAILED")
            return {"next_agent": "end"}

        # Auto-detect if image is geospatial by inspecting the file itself
        if image_path.lower().endswith(('.tif', '.tiff', '.geotiff')) and task_meta.get('geo_metadata') is None:
            detected_metadata = self._load_geo_metadata(image_path)
            if detected_metadata and detected_metadata.get('transform') and detected_metadata.get('crs'):
                task_meta['image_type'] = 'geospatial'
                task_meta['use_geo_metadata'] = True
                task_meta['geo_metadata'] = detected_metadata
                print(f"[ProjectionAgent] Auto-promoted task {task_id} to geospatial from image inspect.")

        use_geo_metadata = bool(task_meta.get('use_geo_metadata', False))
        geo_metadata = task_meta.get('geo_metadata') if task_meta.get('image_type') == 'geospatial' else None

        if task_meta.get('image_type') == 'geospatial' and use_geo_metadata and geo_metadata is None:
            geo_metadata = self._load_geo_metadata(image_path)
            if geo_metadata:
                task_meta['geo_metadata'] = geo_metadata

        transform = None
        crs_str = None
        transformer = None
        if isinstance(geo_metadata, dict):
            transform = geo_metadata.get('transform')
            crs_str = geo_metadata.get('crs')
            if not crs_str:
                crs_str = task_meta.get('geospatial_crs')
            if crs_str and crs_str != 'EPSG:4326':
                try:
                    from pyproj import Transformer
                    transformer = Transformer.from_crs(crs_str, 'EPSG:4326', always_xy=True)
                    self.message_bus.publish(
                        task_id=task_id,
                        sender=self.name,
                        message_type="INFO",
                        content=f"تم تهيئة المحول الجغرافي من {crs_str} إلى EPSG:4326"
                    )
                except Exception as e:
                    print(f"[ProjectionAgent] Error creating Transformer: {e}")

        segments = self.segmenter.segment_image(image)
        if not segments:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content="لم يتم استخراج أي قطع أراضٍ من الصورة."
            )
        else:
            for seg in segments:
                label = seg.get('label', 'unknown')
                score = seg.get('score', 1.0)
                polys = seg.get('polygons', [])
                for poly in polys:
                    if len(poly) < 3: continue
                    x = [pt[0] for pt in poly]
                    y = [pt[1] for pt in poly]
                    pixel_area = 0.5 * np.abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
                    if pixel_area < 150:
                        continue
                    
                    area_sqm = pixel_area * (pixel_scale ** 2)
                    
                    if transform is not None and len(transform) == 6:
                        geo_poly = [self._pixel_to_geo(pt, transform) for pt in poly]
                        if transformer is not None:
                            geo_poly = [list(transformer.transform(pt[0], pt[1])) for pt in geo_poly]
                    else:
                        lat_scale = 1.0 / 111111.0
                        lon_scale = 1.0 / (111111.0 * np.cos(np.radians(ref_lat)))
                        geo_poly = []
                        for pt in poly:
                            dx = pt[0] * pixel_scale
                            dy = -pt[1] * pixel_scale
                            point_lat = ref_lat + (dy * lat_scale)
                            point_lon = ref_lon + (dx * lon_scale)
                            geo_poly.append([point_lon, point_lat])
                            
                    feddan, qirat, sahm = self._convert_to_agricultural_units(area_sqm)
                    
                    memory.add_task_layer(
                        task_id=task_id,
                        layer_name=label,
                        polygons=[poly],
                        geo_polygons=[geo_poly],
                        area_sq_meters=area_sqm,
                        area_feddan=feddan,
                        area_qirat=qirat,
                        area_sahm=sahm,
                        metadata={"description": f"قطعة من نوع {label}", "pixel_scale": pixel_scale, "score": score}
                    )
            
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="COMPLETED",
            content="اكتملت مهمة الإسقاط وحفظ طبقة الأراضي بنجاح."
        )

        self._generate_processed_preview(image_path, task_id, memory)
        return {
            "messages": state.get("messages", []) + [f"{self.name} has finished extracting land layers."],
            "next_agent": "coordinator"
        }

    def _load_geo_metadata(self, image_path: str):
        if rasterio is None:
            return None
        try:
            with rasterio.open(image_path) as ds:
                if ds.transform is None:
                    return None
                return {
                    'crs': str(ds.crs) if ds.crs else None,
                    'transform': ds.transform.to_gdal(),
                    'width': ds.width,
                    'height': ds.height,
                    'count': ds.count,
                    'bounds': {
                        'left': ds.bounds.left,
                        'bottom': ds.bounds.bottom,
                        'right': ds.bounds.right,
                        'top': ds.bounds.top,
                    }
                }
        except Exception:
            return None

    def _pixel_to_geo(self, pt: List[int], transform: Tuple[float, float, float, float, float, float]) -> List[float]:
        c, a, b, f, d, e = transform
        col, row = pt[0], pt[1]
        x = a * col + b * row + c
        y = d * col + e * row + f
        return [float(x), float(y)]

    def _convert_to_agricultural_units(self, area_sqm: float) -> Tuple[int, int, float]:
        feddan = int(area_sqm // 4200.83)
        remaining = area_sqm % 4200.83
        qirat = int(remaining // 175.03)
        remaining = remaining % 175.03
        sahm = round(remaining / 7.29, 2)
        return feddan, qirat, sahm

    def _generate_processed_preview(self, image_path: str, task_id: str, memory: SharedMemory) -> None:
        """
        توليد صورة معاينة نهائية خفيفة (بحد أقصى 2048 بكسل) مع رسم حدود المعالم المستخرجة عليها
        وتحديث مسارها في قاعدة البيانات، لمنع انهيار الذاكرة عشوائية (RAM) مع الصور الضخمة.
        """
        self.message_bus.publish(
            task_id=task_id,
            sender=self.name,
            message_type="SYSTEM",
            content="جاري إنشاء صورة المعاينة النهائية بعد التعديل..."
        )
        
        orig_width, orig_height = 0, 0
        img_preview = None
        ds_transform = None
        ds_crs_str = None
        
        if rasterio is not None:
            try:
                with rasterio.open(image_path) as ds:
                    orig_width = ds.width
                    orig_height = ds.height
                    ds_transform = ds.transform
                    ds_crs_str = str(ds.crs) if ds.crs else None
                    
                    max_dim = 2048
                    if orig_width > max_dim or orig_height > max_dim:
                        scale = max_dim / max(orig_width, orig_height)
                        out_width = int(orig_width * scale)
                        out_height = int(orig_height * scale)
                        
                        from rasterio.enums import Resampling
                        bands = ds.read(
                            out_shape=(min(3, ds.count), out_height, out_width),
                            resampling=Resampling.bilinear
                        )
                        if bands.ndim == 3:
                            if bands.shape[0] >= 3:
                                img_preview = np.stack([bands[0], bands[1], bands[2]], axis=-1)
                            else:
                                img_preview = np.transpose(bands, (1, 2, 0))
                        else:
                            img_preview = bands
                        img_preview = np.asarray(img_preview, dtype=np.uint8)
                        if img_preview.ndim == 2:
                            img_preview = cv2.cvtColor(img_preview, cv2.COLOR_GRAY2BGR)
                        elif img_preview.shape[2] == 1:
                            img_preview = cv2.cvtColor(img_preview, cv2.COLOR_GRAY2BGR)
                        elif img_preview.shape[2] == 4:
                            img_preview = cv2.cvtColor(img_preview, cv2.COLOR_RGBA2BGR)
                        
                        # Convert RGB to BGR for OpenCV
                        img_preview = cv2.cvtColor(img_preview, cv2.COLOR_RGB2BGR)
            except Exception as e:
                print(f"[ProjectionAgent] Error reading preview with rasterio: {e}")
                
        if img_preview is None:
            try:
                img_preview = cv2.imread(image_path, cv2.IMREAD_COLOR)
                if img_preview is not None:
                    orig_height, orig_width = img_preview.shape[:2]
                    max_dim = 2048
                    if orig_width > max_dim or orig_height > max_dim:
                        scale = max_dim / max(orig_width, orig_height)
                        out_width = int(orig_width * scale)
                        out_height = int(orig_height * scale)
                        img_preview = cv2.resize(img_preview, (out_width, out_height), interpolation=cv2.INTER_AREA)
            except Exception as e:
                print(f"[ProjectionAgent] Error reading preview with cv2: {e}")
                
        if img_preview is None or orig_width == 0 or orig_height == 0:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content="تعذر إنشاء صورة المعاينة النهائية بسبب فشل قراءة الصورة."
            )
            return

        preview_height, preview_width = img_preview.shape[:2]
        scale_x = preview_width / orig_width
        scale_y = preview_height / orig_height

        layers = memory.get_task_layers(task_id)
        if not layers:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content="لا توجد طبقات معالم مسجلة للمهمة لرسمها."
            )
            return

        COLOR_MAP = {
            'agricultural': (34, 139, 34),  # Green
            'buildings': (0, 0, 255),       # Red
            'water': (255, 0, 0),           # Blue
            'roads': (200, 200, 200),       # Gray
            'arid': (19, 69, 139),          # Brown
            'unknown': (0, 255, 255),       # Yellow
            
            # الدعم العربي
            'شارع': (200, 200, 200),
            'مبنى': (0, 0, 255),
            'وادي': (255, 0, 0),
            'مزرعة': (34, 139, 34),
            'أرض': (34, 139, 34),
            'جبل': (19, 69, 139),
            'وغيرها': (0, 255, 255)
        }

        # جلب تفاصيل المهمة للتحويل البديل
        task_info = memory.get_task(task_id)
        task_meta = task_info.get("metadata", {}) if task_info else {}
        pixel_scale = float(task_meta.get("pixel_scale_meters", 0.5))
        ref_lat = float(task_meta.get("ref_latitude", 15.3694))
        ref_lon = float(task_meta.get("ref_longitude", 44.1910))
        
        lat_scale = 1.0 / 111111.0
        lon_scale = 1.0 / (111111.0 * np.cos(np.radians(ref_lat))) if ref_lat else 1.0

        for layer in layers:
            label = layer.get('layer_name', 'unknown').lower()
            color = COLOR_MAP.get(label, COLOR_MAP['unknown'])
            
            geo_polygons = layer.get('geo_polygons', [])
            if isinstance(geo_polygons, str):
                try:
                    import json
                    geo_polygons = json.loads(geo_polygons)
                except Exception:
                    geo_polygons = []
                    
            polygons_to_draw = []
            
            if geo_polygons:
                if ds_transform is not None:
                    transformer = None
                    if ds_crs_str and ds_crs_str != 'EPSG:4326':
                        try:
                            from pyproj import Transformer
                            transformer = Transformer.from_crs('EPSG:4326', ds_crs_str, always_xy=True)
                        except Exception:
                            pass
                    
                    inv_transform = ~ds_transform
                    for geo_poly in geo_polygons:
                        coords_list = geo_poly
                        if len(coords_list) > 0 and isinstance(coords_list[0], list) and isinstance(coords_list[0][0], list):
                            coords_list = coords_list[0]
                            
                        poly_pixels = []
                        for pt in coords_list:
                            if len(pt) < 2:
                                continue
                            lon_val, lat_val = pt[0], pt[1]
                            if transformer is not None:
                                x_img, y_img = transformer.transform(lon_val, lat_val)
                            else:
                                x_img, y_img = lon_val, lat_val
                            
                            px_col, px_row = inv_transform * (x_img, y_img)
                            poly_pixels.append([px_col, px_row])
                            
                        if len(poly_pixels) >= 3:
                            polygons_to_draw.append(poly_pixels)
                else:
                    # تحويل عكسي جغرافي مبسط (بديل لعدم وجود ملف GeoTIFF وتوافر الإحداثيات المرجعية)
                    for geo_poly in geo_polygons:
                        coords_list = geo_poly
                        if len(coords_list) > 0 and isinstance(coords_list[0], list) and isinstance(coords_list[0][0], list):
                            coords_list = coords_list[0]
                            
                        poly_pixels = []
                        for pt in coords_list:
                            if len(pt) < 2:
                                continue
                            lon_val, lat_val = pt[0], pt[1]
                            px_col = (lon_val - ref_lon) / (pixel_scale * lon_scale)
                            px_row = -(lat_val - ref_lat) / (pixel_scale * lat_scale)
                            poly_pixels.append([px_col, px_row])
                            
                        if len(poly_pixels) >= 3:
                            polygons_to_draw.append(poly_pixels)
                            
            # تراجع لرسم الإحداثيات بكسل المباشرة إذا لم تتوفر إحداثيات جغرافية
            if not polygons_to_draw:
                polygons = layer.get('polygons', [])
                if isinstance(polygons, str):
                    try:
                        import json
                        polygons = json.loads(polygons)
                    except Exception:
                        polygons = []
                for poly in polygons:
                    if isinstance(poly, list) and len(poly) >= 3:
                        polygons_to_draw.append(poly)
                        
            for poly in polygons_to_draw:
                scaled_poly = np.array([
                    [int(pt[0] * scale_x), int(pt[1] * scale_y)] for pt in poly
                ], dtype=np.int32)
                
                # رسم الحدود الخارجية فقط بلون الطبقة وسماكة 3 بكسل دون تعبئة المساحات
                cv2.polylines(img_preview, [scaled_poly], True, color, 3)

        try:
            processed_filename = f"{task_id}_processed.png"
            processed_path = os.path.join(os.path.dirname(image_path), processed_filename)
            cv2.imwrite(processed_path, img_preview)
            
            memory.update_task_processed_image(task_id, processed_path)
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="SYSTEM",
                content=f"تم حفظ صورة المعاينة النهائية بنجاح: {processed_filename}"
            )
            
            # استدعاء جلب البيانات المرجعية من خريطة الشارع المفتوحة تلقائياً في الخلفية
            try:
                import sys
                import os
                parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                if parent_dir not in sys.path:
                    sys.path.append(parent_dir)
                from utils_osm import trigger_osm_fetch_in_background
                trigger_osm_fetch_in_background(task_id)
            except Exception as e:
                print(f"[ProjectionAgent] Warning: failed to trigger background OSM fetch: {e}")
        except Exception as err:
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="WARNING",
                content=f"تعذر حفظ صورة المعاينة النهائية: {str(err)}"
            )

