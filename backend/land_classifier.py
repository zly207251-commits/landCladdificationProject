import cv2
import numpy as np
import os

from typing import List, Dict, Any, Optional


class LandSegmenterSAM:
    def __init__(self, model_path="sam_vit_b_01ec64.pth", fail_fast=True):
        self.use_sam = False
        self.mask_generator = None
        self.semantic_segmenter = None
        self.model_path = model_path
        self.fail_fast = fail_fast
        
        # محاولة تحميل نموذج SAM إذا كان موجوداً
        print("🔄 محاولة تحميل نموذج SAM...")
        if os.path.exists(model_path):
            try:
                import torch
                from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

                sam = sam_model_registry["vit_b"](checkpoint=model_path)
                device = "cuda" if torch.cuda.is_available() else "cpu"
                sam.to(device)

                self.mask_generator = SamAutomaticMaskGenerator(
                    model=sam,
                    points_per_side=16,
                    pred_iou_thresh=0.45,
                    stability_score_thresh=0.30,
                    min_mask_region_area=500,
                )
                self.use_sam = True
                print(f"✔️ تم تحميل نموذج SAM بنجاح على {device}!")
            except Exception as e:
                msg = f"⚠️ لم يتم تحميل SAM: {e}"
                if self.fail_fast:
                    raise RuntimeError(msg)
                else:
                    print(msg)
                    print("ℹ️ سيتم استخدام الطريقة البديلة (الحدود)")
        else:
            msg = f"⚠️ لم يتم العثور على ملف النموذج: {model_path}"
            if self.fail_fast:
                raise FileNotFoundError(msg)
            else:
                print(msg)
                print("ℹ️ سيتم استخدام الطريقة البديلة (الحدود)")

        # محاولة تحميل نموذج SegFormer للتصنيف الدلالي داخل أقنعة SAM
        try:
            self.semantic_segmenter = SegFormerSemanticSegmenter()
            print("✔️ تم تحميل SegFormer بنجاح! سيتم استخدامه لتحسين تصنيف الأقنعة.")
        except Exception as e:
            print(f"⚠️ لم يتم تحميل SegFormer: {e}")
            self.semantic_segmenter = None

    def segment_image(self, image):
        # فحوصات أولية للصورة (Fail-fast)
        if image is None:
            raise ValueError("Invalid image: None provided to segment_image")
        if not hasattr(image, 'shape') or len(image.shape) < 2:
            raise ValueError("Invalid image: unexpected shape")
        h, w = image.shape[:2]
        if h < 50 or w < 50:
            raise ValueError("Invalid image: too small for reliable segmentation")

        # فحص السطوع للتأكد من أن الصورة صالحة
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        mean_brightness = float(np.mean(gray))
        if mean_brightness < 5 or mean_brightness > 250:
            raise ValueError(f"Invalid image: mean brightness={mean_brightness:.2f}")

        if self.use_sam and self.mask_generator:
            try:
                masks = self.mask_generator.generate(image)
                print(f"🔍 SAM generated {len(masks)} masks")
                segments: List[Dict[str, Any]] = []
                for idx, m in enumerate(masks, start=1):
                    segmentation = m['segmentation'].astype(np.uint8)
                    seg255 = (segmentation * 255).astype(np.uint8)
                    contours, _ = cv2.findContours(seg255, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    polygons = []
                    for cnt in contours:
                        area = cv2.contourArea(cnt)
                        if area < 120:
                            continue
                        epsilon = 0.01 * cv2.arcLength(cnt, True)
                        approx = cv2.approxPolyDP(cnt, epsilon, True)
                        if len(approx) >= 3:
                            polygons.append(approx.reshape(-1, 2).tolist())
                    if not polygons:
                        print(f"  - mask {idx} dropped after contour filter ({len(contours)} contours)")
                        continue
                    score = float(m.get('stability_score', 1.0)) if isinstance(m, dict) else 1.0
                    segments.append({
                        'label': 'unknown',
                        'mask': segmentation,
                        'polygons': polygons,
                        'score': score,
                    })
                print(f"🔍 SAM produced {len(segments)} segments after polygon filtering")
                semantic_map = None
                if self.semantic_segmenter is not None:
                    try:
                        semantic_map = self.semantic_segmenter.segment_image(image)
                    except Exception as e:
                        print(f"⚠️ فشل SegFormer أثناء معالجة الصورة: {e}")
                        semantic_map = None
                if segments:
                    if not hasattr(self, 'color_classifier'):
                        self.color_classifier = LandColorClassifier()
                    for seg in segments:
                        try:
                            if semantic_map is not None and seg['mask'] is not None:
                                seg['label'] = self.semantic_segmenter.classify_mask(seg['mask'], semantic_map)
                            else:
                                seg['label'] = self.color_classifier.classify_mask(image, seg['mask'])
                        except Exception:
                            seg['label'] = 'unknown'
                if len(segments) < 3:
                    fallback_segments = self._fallback_segmentation(image, min_area=150)
                    print(f"🔄 Using fallback segmentation: {len(fallback_segments)} fallback segments")
                    for fb in fallback_segments:
                        if not any(self._is_duplicate_segment(fb, seg) for seg in segments):
                            segments.append(fb)
                return segments
            except Exception as e:
                msg = f"⚠️ خطأ في SAM أثناء التجزئة: {e}"
                if self.fail_fast:
                    raise RuntimeError(msg)
                else:
                    print(msg)
                    print("ℹ️ استخدام الطريقة البديلة")

        # إذا لم يتم تحميل SAM أو فشلنا ولكن نسمح بالتراجع، نستخدم الطريقة البديلة
        if not self.use_sam and self.fail_fast:
            raise RuntimeError("SAM model not available and fail_fast=True")

        return self._fallback_segmentation(image, min_area=150)

    def _fallback_segmentation(self, image, min_area: int = 150):
        polygons = []
        
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (7, 7), 0)
        edges = cv2.Canny(blurred, 40, 120)
        _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        combined = cv2.bitwise_or(edges, thresh)
        
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        closed = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel)
        closed = cv2.dilate(closed, kernel, iterations=2)
        closed = cv2.erode(closed, kernel, iterations=1)
        
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        print(f"🔍 Fallback detected {len(contours)} contours")
        image_area = image.shape[0] * image.shape[1]
        for cnt in contours:
            area = cv2.contourArea(cnt)
            x, y, w, h = cv2.boundingRect(cnt)
            if area < min_area or area > image_area * 0.90:
                continue
            if x <= 2 or y <= 2 or x + w >= image.shape[1] - 2 or y + h >= image.shape[0] - 2:
                continue
            epsilon = 0.02 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, epsilon, True)
            if len(approx) >= 3:
                polygons.append(approx.reshape(-1, 2).tolist())
        if not polygons:
            print("🔍 Fallback did not extract valid contours, محاولة التقسيم البسيط.")
            mask = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 7)
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for cnt in contours:
                area = cv2.contourArea(cnt)
                x, y, w, h = cv2.boundingRect(cnt)
                if area < min_area or area > image_area * 0.90:
                    continue
                if x <= 2 or y <= 2 or x + w >= image.shape[1] - 2 or y + h >= image.shape[0] - 2:
                    continue
                epsilon = 0.02 * cv2.arcLength(cnt, True)
                approx = cv2.approxPolyDP(cnt, epsilon, True)
                if len(approx) >= 3:
                    polygons.append(approx.reshape(-1, 2).tolist())
        if not polygons:
            h, w = image.shape[:2]
            polygons.append([[50, 50], [w-50, 50], [w-50, h-50], [50, h-50]])
        print(f"🔍 Fallback produced {len(polygons)} polygons")
        if not hasattr(self, 'color_classifier'):
            self.color_classifier = LandColorClassifier()

        semantic_map = None
        if self.semantic_segmenter is not None:
            try:
                semantic_map = self.semantic_segmenter.segment_image(image)
            except Exception as e:
                print(f"⚠️ فشل SegFormer أثناء معالجة fallback: {e}")
                semantic_map = None

        segments: List[Dict[str, Any]] = []
        for poly in polygons:
            mask = np.zeros((image.shape[0], image.shape[1]), dtype=np.uint8)
            pts = np.array(poly, dtype=np.int32).reshape((-1, 2))
            cv2.fillPoly(mask, [pts], 1)
            try:
                if semantic_map is not None:
                    lbl = self.semantic_segmenter.classify_mask(mask, semantic_map)
                else:
                    lbl = self.color_classifier.classify_mask(image, mask)
            except Exception:
                lbl = 'unknown'
            segments.append({'label': lbl, 'mask': mask, 'polygons': [poly], 'score': 0.5})
        return segments

    def _is_duplicate_segment(self, seg_a: Dict[str, Any], seg_b: Dict[str, Any]) -> bool:
        if not seg_a.get('polygons') or not seg_b.get('polygons'):
            return False
        a0 = np.array(seg_a['polygons'][0], dtype=np.float32)
        b0 = np.array(seg_b['polygons'][0], dtype=np.float32)
        if a0.shape != b0.shape:
            return False
        dist = np.linalg.norm(a0 - b0, axis=1)
        return float(np.mean(dist)) < 8.0


class LandColorClassifier:
    def __init__(self):
        pass

    def classify_mask(self, image: np.ndarray, mask: np.ndarray) -> str:
        """
        Classify a binary mask region in the image into a simple semantic label.
        Returns one of: 'agricultural','arid','roads','buildings','water','unknown'
        """
        if mask is None or image is None:
            return 'unknown'
        # ensure mask is binary 0/1
        bin_mask = (mask > 0).astype(np.uint8)
        if bin_mask.sum() == 0:
            return 'unknown'

        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        # compute mean HSV over masked pixels
        h_vals = hsv[:, :, 0][bin_mask.astype(bool)]
        s_vals = hsv[:, :, 1][bin_mask.astype(bool)]
        v_vals = hsv[:, :, 2][bin_mask.astype(bool)]
        if len(h_vals) == 0:
            return 'unknown'
        mean_h = int(np.mean(h_vals))
        mean_s = int(np.mean(s_vals))
        mean_v = int(np.mean(v_vals))

        ys, xs = np.where(bin_mask > 0)
        bbox_area = 1
        if len(xs) > 0 and len(ys) > 0:
            bbox_area = max(1, (xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1))
        area = int(bin_mask.sum())
        shape_ratio = float(area) / float(bbox_area)
        image_area = image.shape[0] * image.shape[1]
        is_large_area = area > (image_area * 0.15)

        # heuristics
        if 35 <= mean_h <= 85 and mean_s > 40 and mean_v > 40:
            return 'agricultural'
        if 90 <= mean_h <= 140 and mean_s > 30 and mean_v > 20:
            return 'water'
        if 10 <= mean_h <= 35 and mean_s > 30 and mean_v > 40:
            return 'arid'

        if mean_s < 50 and mean_v > 180 and shape_ratio < 0.35 and not is_large_area:
            return 'roads'
        if mean_s < 40 and mean_v > 160 and shape_ratio < 0.45 and not is_large_area:
            return 'roads'

        if ((mean_h < 10 or mean_h > 160) and mean_v > 90 and mean_s > 20) or (mean_s < 35 and mean_v > 180 and not is_large_area):
            return 'buildings'

        if mean_s < 25 and mean_v > 140 and not is_large_area:
            return 'roads'

        return 'unknown'

    def _get_color_ratios(self, image):
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        
        lower_green = np.array([35, 40, 40])
        upper_green = np.array([85, 255, 255])
        lower_arid = np.array([10, 40, 40])
        upper_arid = np.array([35, 255, 255])
        lower_roads = np.array([0, 0, 50])
        upper_roads = np.array([180, 50, 150])
        lower_red1 = np.array([0, 50, 50])
        upper_red1 = np.array([10, 255, 255])
        lower_red2 = np.array([170, 50, 50])
        upper_red2 = np.array([180, 255, 255])
        lower_concrete = np.array([0, 0, 150])
        upper_concrete = np.array([180, 40, 255])
        
        mask_green = cv2.inRange(hsv, lower_green, upper_green)
        mask_arid = cv2.inRange(hsv, lower_arid, upper_arid)
        mask_roads = cv2.inRange(hsv, lower_roads, upper_roads)
        mask_red1 = cv2.inRange(hsv, lower_red1, upper_red1)
        mask_red2 = cv2.inRange(hsv, lower_red2, upper_red2)
        mask_concrete = cv2.inRange(hsv, lower_concrete, upper_concrete)
        mask_buildings = cv2.bitwise_or(mask_red1, mask_red2)
        mask_buildings = cv2.bitwise_or(mask_buildings, mask_concrete)
        
        total_pixels = image.shape[0] * image.shape[1]
        green_pixels = cv2.countNonZero(mask_green)
        arid_pixels = cv2.countNonZero(mask_arid)
        roads_pixels = cv2.countNonZero(mask_roads)
        buildings_pixels = cv2.countNonZero(mask_buildings)
        
        counts = {
            'agricultural': green_pixels,
            'arid': arid_pixels,
            'roads': roads_pixels,
            'buildings': buildings_pixels,
            'total': total_pixels
        }
        
        ratios = {k: v / total_pixels for k, v in counts.items() if v}
        return ratios, counts


class SegFormerSemanticSegmenter:
    MODEL_NAME = "nvidia/segformer-b0-finetuned-ade-512-512"

    def __init__(self):
        try:
            import torch
            from transformers import AutoImageProcessor, SegformerForSemanticSegmentation
        except ImportError as e:
            raise RuntimeError("Install transformers to use SegFormer: pip install transformers timm") from e

        self.torch = torch
        self.device = "cuda" if self.torch.cuda.is_available() else "cpu"
        self.processor = AutoImageProcessor.from_pretrained(self.MODEL_NAME)
        self.model = SegformerForSemanticSegmentation.from_pretrained(self.MODEL_NAME).to(self.device)
        self.id2label = self.model.config.id2label
        self.category_map = self._build_category_map()

    def _build_category_map(self):
        category_map = {}
        for idx, label in self.id2label.items():
            normalized = label.lower()
            if any(token in normalized for token in ["road", "street", "highway", "runway", "bridge", "path", "sidewalk", "track"]):
                category_map[int(idx)] = "roads"
            elif any(token in normalized for token in ["building", "house", "tower", "wall", "garage", "factory", "church", "hut", "office", "hotel", "stadium"]):
                category_map[int(idx)] = "buildings"
            elif any(token in normalized for token in ["river", "lake", "pond", "sea", "ocean", "water", "canal", "swamp", "wetland", "reservoir"]):
                category_map[int(idx)] = "water"
            elif any(token in normalized for token in ["grass", "field", "crop", "meadow", "forest", "tree", "vegetation", "plant", "farm", "farmland", "orchard", "park", "garden"]):
                category_map[int(idx)] = "agricultural"
            elif any(token in normalized for token in ["sand", "dirt", "rock", "mountain", "desert", "gravel", "soil", "cliff", "bare", "snow", "ice"]):
                category_map[int(idx)] = "arid"
            else:
                category_map[int(idx)] = "unknown"
        return category_map

    def segment_image(self, image: np.ndarray) -> np.ndarray:
        if image is None:
            raise ValueError("Invalid image provided to SegFormer semantic segmentation")
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        inputs = self.processor(images=image_rgb, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        self.model.eval()
        with torch.no_grad():
            outputs = self.model(**inputs)
        logits = outputs.logits.detach().cpu().numpy()[0]
        seg = np.argmax(logits, axis=0).astype(np.int32)
        seg = cv2.resize(seg, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST)
        return seg

    def classify_mask(self, mask: np.ndarray, semantic_map: np.ndarray) -> str:
        if mask is None or semantic_map is None:
            return "unknown"
        mask_bool = mask.astype(bool)
        if mask_bool.sum() == 0:
            return "unknown"

        labels = semantic_map[mask_bool]
        if labels.size == 0:
            return "unknown"

        counts = np.bincount(labels)
        if counts.size == 0:
            return "unknown"

        label_id = int(np.argmax(counts))
        return self.category_map.get(label_id, "unknown")
