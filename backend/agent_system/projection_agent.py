import os
import cv2
import numpy as np
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
                message_bus=self.message_bus
            )
            self.message_bus.publish(
                task_id=task_id,
                sender=self.name,
                message_type="COMPLETED",
                content="اكتملت معالجة الصورة الضخمة (التقطيع)."
            )
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

        use_geo_metadata = bool(task_meta.get('use_geo_metadata', False))
        geo_metadata = task_meta.get('geo_metadata') if task_meta.get('image_type') == 'geospatial' else None

        if task_meta.get('image_type') == 'geospatial' and use_geo_metadata and geo_metadata is None:
            geo_metadata = self._load_geo_metadata(image_path)
            if geo_metadata:
                task_meta['geo_metadata'] = geo_metadata

        transform = None
        if isinstance(geo_metadata, dict):
            transform = geo_metadata.get('transform')

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

        return {
            "messages": state.get("messages", []) + [f"{self.name} has finished extracting land layers."],
            "next_agent": "coordinator"
        }

    def _load_geo_metadata(self, image_path: str):
        if rasterio is None:
            return None
        try:
            with rasterio.open(image_path) as ds:
                if ds.crs is None or ds.transform is None:
                    return None
                return {
                    'crs': str(ds.crs),
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
