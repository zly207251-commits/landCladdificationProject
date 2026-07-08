"""
معالج تقسيم الصور (Tiler) المتوافق مع الصور الضخمة
=====================================================================

يعتمد على مكتبة `rasterio` لعدم تحميل الصورة كاملة في الذاكرة.
ويقوم بحفظ تقدمه (Checkpointing) لتجنب إعادة العمل عند توقف النظام.
"""

import os
import cv2
import numpy as np
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass
import time

try:
    import rasterio
    from rasterio.windows import Window
except ImportError:
    rasterio = None

@dataclass
class TileResult:
    tile_row: int
    tile_col: int
    polygons: List
    geo_polygons: List
    area_sqm: float
    layer_count: int
    success: bool
    error_message: Optional[str] = None

@dataclass
class TiledProcessingResult:
    total_tiles: int
    successful_tiles: int
    failed_tiles: int
    all_polygons: List
    all_geo_polygons: List
    total_area_sqm: float
    processing_time_seconds: float
    tile_results: List[TileResult]

class ImageTiler:
    def __init__(self, tile_size: Optional[int] = None, overlap: int = 64):
        import os
        env_tile_size = int(os.getenv("TILE_SIZE", "1024"))
        self.tile_size = tile_size if tile_size is not None else env_tile_size
        self.overlap = overlap
        print(f"[ImageTiler] تم التهيئة: tile_size={self.tile_size}, overlap={self.overlap}")
    
    def calculate_tiles(self, image_height: int, image_width: int) -> List[Tuple[int, int, int, int, int, int]]:
        tiles = []
        step = self.tile_size - self.overlap
        for row in range(0, image_height, step):
            for col in range(0, image_width, step):
                y_start = row
                y_end = min(row + self.tile_size, image_height)
                x_start = col
                x_end = min(col + self.tile_size, image_width)
                tiles.append((row // step, col // step, y_start, y_end, x_start, x_end))
        return tiles
    
    def adjust_coordinates(self, polygons: List[List[float]], y_offset: int, x_offset: int) -> List[List[float]]:
        adjusted = []
        for poly in polygons:
            adjusted_poly = []
            for point in poly:
                if len(point) >= 2:
                    adjusted_poly.append([point[0] + x_offset, point[1] + y_offset])
            if adjusted_poly:
                adjusted.append(adjusted_poly)
        return adjusted
    
    def _pixel_to_geo_simple(self, polygons: List, pixel_scale: float, ref_lat: float, ref_lon: float) -> List:
        lat_scale = 1.0 / 111111.0
        lon_scale = 1.0 / (111111.0 * np.cos(np.radians(ref_lat)))
        geo_polygons = []
        for poly in polygons:
            geo_poly = []
            for pt in poly:
                if len(pt) >= 2:
                    dx = pt[0] * pixel_scale
                    dy = -pt[1] * pixel_scale
                    point_lat = ref_lat + (dy * lat_scale)
                    point_lon = ref_lon + (dx * lon_scale)
                    geo_poly.append([point_lon, point_lat])
            if geo_poly:
                geo_polygons.append(geo_poly)
        return geo_polygons

    def _pixel_to_geo_rasterio(self, pt: List[float], transform: Tuple[float, float, float, float, float, float]) -> List[float]:
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
    
    def _calculate_polygon_area(self, polygon: List) -> float:
        if len(polygon) < 3:
            return 0.0
        area = 0.0
        n = len(polygon)
        for i in range(n):
            j = (i + 1) % n
            area += polygon[i][0] * polygon[j][1]
            area -= polygon[j][0] * polygon[i][1]
        return abs(area) / 2.0
    
    def process_image(
        self,
        image_path: str,
        segmenter,
        task_id: str,
        memory,
        pixel_scale: float = 0.5,
        ref_lat: float = 24.7136,
        ref_lon: float = 46.6753,
        message_bus=None,
        use_geo_metadata: bool = False
    ) -> TiledProcessingResult:
        start_time = time.time()
        
        def log_msg(msg_type: str, content: str, payload: Dict = None):
            print(f"[ImageTiler] {msg_type}: {content}")
            if message_bus:
                message_bus.publish(task_id=task_id, sender="image_tiler", message_type=msg_type, content=content, payload=payload or {})
        
        if rasterio is None:
            log_msg("ERROR", "مكتبة rasterio غير متوفرة! فشل التقطيع.")
            return TiledProcessingResult(0,0,0,[],[],0.0,0.0,[])

        log_msg("INFO", "تشغيل نموذج SAM")
        # Also publish to message bus and memory log for UI visibility
        if message_bus:
            message_bus.publish(task_id=task_id, sender="image_tiler", message_type="INFO", content="تشغيل نموذج SAM", payload={})
        memory.log_message(task_id, "system", "SAM_RUN", "تشغيل نموذج SAM", {})
        
        def get_memory_usage_gb() -> float:
            try:
                import psutil
                process = psutil.Process(os.getpid())
                return process.memory_info().rss / (1024 ** 3)
            except ImportError:
                pass
            try:
                with open('/proc/self/status') as f:
                    for line in f:
                        if line.startswith('VmRSS:'):
                            parts = line.split()
                            return float(parts[1]) / (1024 * 1024)
            except Exception:
                pass
            return 0.0

        try:
            # تقليل استهلاك الذاكرة الخاص بـ GDAL cache
            with rasterio.Env(GDAL_CACHEMAX=64):
                with rasterio.open(image_path) as src:
                    height, width = src.height, src.width
                    log_msg("ACTION", f"أبعاد الصورة: {width}x{height} ({width*height/1e6:.1f}MP)")
                    
                    transform = None
                    crs_str = None
                    transformer = None
                    if use_geo_metadata and src.transform:
                        transform = src.transform.to_gdal()
                        crs_str = str(src.crs) if src.crs else None
                        if not crs_str:
                            task = memory.get_task(task_id)
                            task_meta = task.get("metadata") or {} if task else {}
                            crs_str = task_meta.get("geospatial_crs") or "EPSG:32638"
                        if crs_str != 'EPSG:4326':
                            try:
                                from pyproj import Transformer
                                transformer = Transformer.from_crs(crs_str, 'EPSG:4326', always_xy=True)
                                log_msg("INFO", f"تم تهيئة المحول الجغرافي من {crs_str} إلى EPSG:4326")
                            except Exception as e:
                                log_msg("WARNING", f"تعذر إنشاء Transformer للإسقاط الجغرافي: {e}")
                    
                    tiles = self.calculate_tiles(height, width)
                    total_tiles = len(tiles)
                    log_msg("ACTION", f"إجمالي الأجزاء المحسوبة: {total_tiles} جزء")
                    
                    # حفظ الأجزاء في قاعدة البيانات لتتبعها (Checkpointing)
                    memory.init_task_tiles(task_id, tiles)
                    
                    pending_tiles = memory.get_pending_tiles(task_id)
                    log_msg("INFO", f"عدد الأجزاء المتبقية للمعالجة: {len(pending_tiles)}")

                    successful_tiles = total_tiles - len(pending_tiles)
                    failed_tiles = 0
                    total_area_sqm = 0.0

                    # Pre-initialize color classifier to prevent thread race conditions
                    if segmenter and not hasattr(segmenter, 'color_classifier'):
                        try:
                            from land_classifier import LandColorClassifier
                            segmenter.color_classifier = LandColorClassifier()
                        except Exception:
                            pass

                    import threading
                    from concurrent.futures import ThreadPoolExecutor, as_completed
                    import psutil

                    db_lock = threading.Lock()
                    reader_lock = threading.Lock()

                    # Capping max workers at 3 to prevent OOM in resource-constrained environments
                    max_workers = min(3, max(1, psutil.cpu_count(logical=False) or 1))
                    log_msg("INFO", f"بدء تشغيل معالجة الأجزاء بالتوازي باستخدام ThreadPool. عدد الخيوط: {max_workers}")

                    def process_single_tile(ptile):
                        nonlocal failed_tiles, successful_tiles, total_area_sqm
                        tile_row = ptile['tile_row']
                        tile_col = ptile['tile_col']
                        y_start = ptile['y_start']
                        y_end = ptile['y_end']
                        x_start = ptile['x_start']
                        x_end = ptile['x_end']
                        
                        w_width = x_end - x_start
                        w_height = y_end - y_start
                        
                        current_mem = get_memory_usage_gb()
                        
                        # تفعيل المعالجة البديلة السريعة عند زيادة استهلاك الذاكرة عن 12.0 GB
                        if current_mem > 12.0 and getattr(segmenter, 'use_sam', False):
                            with db_lock:
                                if getattr(segmenter, 'use_sam', False):
                                    log_msg("WARNING", f"الذاكرة منخفضة للغاية ({current_mem:.2f} GB)! سيتم استخدام المعالجة البديلة السريعة لتفادي تجاوز سعة الخادم.")
                                    segmenter.use_sam = False
                                    segmenter.fail_fast = False

                        try:
                            with reader_lock:
                                window = Window(col_off=x_start, row_off=y_start, width=w_width, height=w_height)
                                bands = src.read(window=window)
                            
                            if bands.ndim == 3:
                                if bands.shape[0] >= 3:
                                    tile_image = np.stack([bands[0], bands[1], bands[2]], axis=-1)
                                else:
                                    tile_image = np.transpose(bands, (1, 2, 0))
                            else:
                                tile_image = bands
                                
                            tile_image = np.asarray(tile_image, dtype=np.uint8)
                            if tile_image.ndim == 2:
                                tile_image = cv2.cvtColor(tile_image, cv2.COLOR_GRAY2BGR)
                            elif tile_image.shape[2] == 1:
                                tile_image = cv2.cvtColor(tile_image, cv2.COLOR_GRAY2BGR)
                            elif tile_image.shape[2] == 4:
                                tile_image = cv2.cvtColor(tile_image, cv2.COLOR_RGBA2BGR)
                                
                            # معالجة الجزء باستخدام SAM أو البديل السريع
                            segments = segmenter.segment_image(tile_image)
                            
                            local_area = 0.0
                            if segments:
                                for seg in segments:
                                    poly_list = seg.get('polygons', [])
                                    if isinstance(poly_list, list):
                                        for poly in poly_list:
                                            adjusted_poly = self.adjust_coordinates([poly], y_start, x_start)[0]
                                            
                                            if transform is not None and len(transform) == 6:
                                                geo_poly = [self._pixel_to_geo_rasterio(pt, transform) for pt in adjusted_poly]
                                                if transformer is not None:
                                                    geo_poly = [list(transformer.transform(pt[0], pt[1])) for pt in geo_poly]
                                            else:
                                                geo_poly = self._pixel_to_geo_simple([adjusted_poly], pixel_scale, ref_lat, ref_lon)[0]
                                            
                                            pixel_area = self._calculate_polygon_area(adjusted_poly)
                                            area_sqm = pixel_area * (pixel_scale ** 2)
                                            
                                            if area_sqm < 10.0:
                                                continue
                                                
                                            local_area += area_sqm
                                            feddan, qirat, sahm = self._convert_to_agricultural_units(area_sqm)
                                            
                                            # الحفظ الفوري في قاعدة البيانات مع قفل حماية
                                            label = seg.get('label', 'unknown')
                                            score = seg.get('score', 1.0)
                                            with db_lock:
                                                memory.add_task_layer(
                                                    task_id=task_id,
                                                    layer_name=label,
                                                    polygons=[adjusted_poly],
                                                    geo_polygons=[geo_poly],
                                                    area_sq_meters=area_sqm,
                                                    area_feddan=feddan,
                                                    area_qirat=qirat,
                                                    area_sahm=sahm,
                                                    metadata={"description": f"قطعة من الجزء ({tile_row},{tile_col})", "score": score}
                                                )
                                log_msg("RESULT", f"✅ الجزء ({tile_row},{tile_col}) مكتمل وتم حفظ القطع.")
                            else:
                                log_msg("RESULT", f"⚠️ الجزء ({tile_row},{tile_col}) لم ينتج مضلعات.")
                            
                            # تحديث حالة المربع كـ COMPLETED
                            with db_lock:
                                memory.update_tile_status(task_id, tile_row, tile_col, 'COMPLETED')
                                successful_tiles += 1
                                total_area_sqm += local_area
                                
                        except Exception as e:
                            with db_lock:
                                failed_tiles += 1
                                memory.update_tile_status(task_id, tile_row, tile_col, 'FAILED')
                            log_msg("ERROR", f"❌ فشل معالجة الجزء ({tile_row},{tile_col}): {e}")

                    # Submit all tasks to ThreadPool
                    with ThreadPoolExecutor(max_workers=max_workers) as executor:
                        futures = [executor.submit(process_single_tile, ptile) for ptile in pending_tiles]
                        for future in as_completed(futures):
                            try:
                                future.result()
                            except Exception as e:
                                log_msg("ERROR", f"حدث خطأ غير متوقع أثناء معالجة الخيط: {e}")

                    import gc
                    gc.collect()
                    try:
                        import torch
                        if torch.cuda.is_available():
                            torch.cuda.empty_cache()
                    except ImportError:
                        pass
                            
        except Exception as e:
            log_msg("ERROR", f"حدث خطأ جوهري أثناء قراءة الصورة أو المعالجة: {e}")
            
        processing_time = time.time() - start_time
        log_msg("COMPLETED", f"اكتملت معالجة الصورة المقسمة في {processing_time:.1f} ثانية.")
        
        return TiledProcessingResult(total_tiles, successful_tiles, failed_tiles, [], [], total_area_sqm, processing_time, [])

def should_use_tiling(image_path: str, tile_size: Optional[int] = None) -> bool:
    if not os.path.exists(image_path):
        return False
    try:
        if tile_size is None:
            tile_size = int(os.getenv("TILE_SIZE", "1024"))
        import rasterio
        with rasterio.open(image_path) as src:
            total_pixels = src.height * src.width
            threshold_pixels = max(tile_size * tile_size * 2, 6000000)
            return total_pixels > threshold_pixels
    except Exception:
        return False