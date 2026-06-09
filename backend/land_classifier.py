import torch
import cv2
import numpy as np
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator


class LandSegmenterSAM:
    def __init__(self, model_path="sam_vit_b_01ec64.pth"):
        print("🔄 Loading SAM model...")

        sam = sam_model_registry["vit_b"](checkpoint=model_path)
        sam.to("cpu")

        self.mask_generator = SamAutomaticMaskGenerator(
            model=sam,
            points_per_side=32,
            pred_iou_thresh=0.86,
            stability_score_thresh=0.92,
            min_mask_region_area=2000,  # تجاهل القطع الصغيرة
        )

        print("✔ SAM Loaded Successfully")

    def segment_image(self, image):
        """
        يرجع قائمة من المضلعات (حدود القطع)
        """
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


class LandColorClassifier:
    def __init__(self):
        pass

    def _get_color_ratios(self, image):
        # تحويل الصورة إلى فضاء الألوان HSV لسهولة تمييز الألوان
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        
        # تعريف نطاقات الألوان في فضاء HSV
        
        # 1. المناطق الزراعية (الأخضر)
        lower_green = np.array([35, 40, 40])
        upper_green = np.array([85, 255, 255])
        
        # 2. المناطق اليابسة/الجرداء (الأصفر/البني الفاتح)
        lower_arid = np.array([10, 40, 40])
        upper_arid = np.array([35, 255, 255])
        
        # 3. الطرق (الرمادي/الداكن)
        lower_roads = np.array([0, 0, 50])
        upper_roads = np.array([180, 50, 150])
        
        # 4. المباني (الأحمر/الخرسانة الفاتحة)
        lower_red1 = np.array([0, 50, 50])
        upper_red1 = np.array([10, 255, 255])
        lower_red2 = np.array([170, 50, 50])
        upper_red2 = np.array([180, 255, 255])
        lower_concrete = np.array([0, 0, 150])
        upper_concrete = np.array([180, 40, 255])
        
        # إنشاء الأقنعة (Masks)
        mask_green = cv2.inRange(hsv, lower_green, upper_green)
        mask_arid = cv2.inRange(hsv, lower_arid, upper_arid)
        mask_roads = cv2.inRange(hsv, lower_roads, upper_roads)
        
        mask_red1 = cv2.inRange(hsv, lower_red1, upper_red1)
        mask_red2 = cv2.inRange(hsv, lower_red2, upper_red2)
        mask_concrete = cv2.inRange(hsv, lower_concrete, upper_concrete)
        
        mask_buildings = cv2.bitwise_or(mask_red1, mask_red2)
        mask_buildings = cv2.bitwise_or(mask_buildings, mask_concrete)
        
        # حساب عدد البكسلات لكل فئة
        total_pixels = image.shape[0] * image.shape[1]
        
        green_pixels = cv2.countNonZero(mask_green)
        arid_pixels = cv2.countNonZero(mask_arid)
        roads_pixels = cv2.countNonZero(mask_roads)
        buildings_pixels = cv2.countNonZero(mask_buildings)
        
        counts = {
            'agricultural': green_pixels,
            'arid': arid_pixels,
            'roads': roads_pixels,
            'buildings': buildings_pixels
        }
        
        # تطبيع النسب (Normalization)
        sum_counts = sum(counts.values())
        if sum_counts == 0:
            ratios = {k: 0.25 for k in counts}
        else:
            ratios = {k: v / total_pixels for k, v in counts.items()}
            # إضافة البكسلات المتبقية للفئة الأكثر ملاءمة (اليابسة كخلفية افتراضية)
            remaining = 1.0 - sum(ratios.values())
            if remaining > 0:
                ratios['arid'] += remaining
                
        return ratios, mask_green, mask_arid, mask_roads, mask_buildings

    def classify_land(self, image_path):
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"تعذر قراءة الصورة من المسار: {image_path}")
            
        ratios, _, _, _, _ = self._get_color_ratios(image)
        
        # حساب تباين النسيج (الملمس) باستخدام تباين مرشح Laplacian
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        
        # حساب الألوان السائدة باستخدام خوارزمية K-Means (لتجنب الاعتماد على مكتبات خارجية)
        pixels = image.reshape(-1, 3)
        # أخذ عينة عشوائية سريعة
        sample_size = min(1000, len(pixels))
        subset = pixels[np.random.choice(pixels.shape[0], sample_size, replace=False)]
        
        data = np.float32(subset)
        if len(data) >= 3:
            criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
            flags = cv2.KMEANS_RANDOM_CENTERS
            _, _, centers = cv2.kmeans(data, 3, None, criteria, 10, flags)
            dominant_colors = [tuple(map(int, color)) for color in centers]
        else:
            dominant_colors = [tuple(map(int, pixel)) for pixel in data]

        
        # الفئة الرئيسية هي التي تمتلك أعلى نسبة
        ratios_only = {k: v for k, v in ratios.items() if k in ['agricultural', 'arid', 'roads', 'buildings']}
        main_class = max(ratios_only, key=ratios_only.get)
        
        results = {
            'agricultural': ratios['agricultural'],
            'arid': ratios['arid'],
            'roads': ratios['roads'],
            'buildings': ratios['buildings'],
            'texture_variance': float(laplacian_var),
            'dominant_colors': dominant_colors
        }
        
        return main_class, results

    def create_land_map(self, image_path):
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"تعذر قراءة الصورة من المسار: {image_path}")
            
        _, mask_green, mask_arid, mask_roads, mask_buildings = self._get_color_ratios(image)
        
        h, w, _ = image.shape
        land_map = np.zeros((h, w, 3), dtype=np.uint8)
        
        # تلوين الخريطة وفقاً لكل فئة:
        # الأخضر للمناطق الزراعية: [0, 255, 0]
        # الأصفر للمناطق اليابسة: [0, 255, 255]
        # الرمادي للطرق: [128, 128, 128]
        # الأحمر للمباني: [0, 0, 255]
        
        land_map[mask_arid > 0] = [0, 255, 255]      # يابسة (أصفر)
        land_map[mask_roads > 0] = [128, 128, 128]   # طرق (رمادي)
        land_map[mask_buildings > 0] = [0, 0, 255]   # مباني (أحمر)
        land_map[mask_green > 0] = [0, 255, 0]       # زراعية (أخضر)
        
        # أي بكسلات غير مصنفة تلون بالأصفر افتراضياً
        unclassified = np.all(land_map == 0, axis=-1)
        land_map[unclassified] = [0, 255, 255]
        
        return land_map

