import cv2
import numpy as np
import os

class LandSegmenterSAM:
    def __init__(self, model_path="sam_vit_b_01ec64.pth"):
        self.use_sam = False
        self.mask_generator = None
        
        # محاولة تحميل نموذج SAM إذا كان موجوداً
        try:
            print("🔄 محاولة تحميل نموذج SAM...")
            
            # تحقق من وجود ملف النموذج
            if os.path.exists(model_path):
                try:
                    import torch
                    from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

                    sam = sam_model_registry["vit_b"](checkpoint=model_path)
                    sam.to("cpu")

                    self.mask_generator = SamAutomaticMaskGenerator(
                        model=sam,
                        points_per_side=16,
                        pred_iou_thresh=0.80,
                        stability_score_thresh=0.88,
                        min_mask_region_area=2000,
                    )
                    self.use_sam = True
                    print("✔️ تم تحميل نموذج SAM بنجاح!")
                except Exception as e:
                    print(f"⚠️ لم يتم تحميل SAM: {e}")
                    print("ℹ️ سيتم استخدام الطريقة البديلة (الحدود)")
            else:
                print(f"⚠️ لم يتم العثور على ملف النموذج: {model_path}")
                print("ℹ️ سيتم استخدام الطريقة البديلة (الحدود)")
        except ImportError:
            print("⚠️ مكتبات SAM أو PyTorch غير موجودة!")
            print("ℹ️ سيتم استخدام الطريقة البديلة (الحدود)")

    def segment_image(self, image):
        if self.use_sam and self.mask_generator:
            try:
                masks = self.mask_generator.generate(image)
                polygons = []
                for m in masks:
                    segmentation = m['segmentation'].astype(np.uint8) * 255
                    contours, _ = cv2.findContours(segmentation, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    for cnt in contours:
                        area = cv2.contourArea(cnt)
                        if area < 1500:
                            continue
                        epsilon = 0.01 * cv2.arcLength(cnt, True)
                        approx = cv2.approxPolyDP(cnt, epsilon, True)
                        polygons.append(approx.reshape(-1, 2).tolist())
                return polygons
            except Exception as e:
                print(f"⚠️ خطأ في SAM: {e}")
                print("ℹ️ استخدام الطريقة البديلة")
        
        # الطريقة البديلة: استخدام الحدود البسيطة
        return self._fallback_segmentation(image)

    def _fallback_segmentation(self, image):
        polygons = []
        
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (9, 9), 0)
        edges = cv2.Canny(blurred, 50, 150)
        
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if 1500 < area < (image.shape[0] * image.shape[1] * 0.9):
                epsilon = 0.02 * cv2.arcLength(cnt, True)
                approx = cv2.approxPolyDP(cnt, epsilon, True)
                if len(approx) >= 3:
                    polygons.append(approx.reshape(-1, 2).tolist())
                    
        if not polygons:
            h, w = image.shape[:2]
            polygons.append([[50, 50], [w-50, 50], [w-50, h-50], [50, h-50]])
        return polygons


class LandColorClassifier:
    def __init__(self):
        pass

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
