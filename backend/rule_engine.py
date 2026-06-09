# rule_engine.py
import numpy as np
import cv2

class RoadWaterRuleEngine:
    """
    محرك قواعد تمييز الطرق والمجاري المائية
    يأخذ كل قطعة من نتائج SAM + التصنيف اللوني/النسيج الحالي
    ويعيد تصنيف معدل وفق القواعد التفصيلية
    """
    def __init__(self):
        pass

    def apply_rules(self, region, ndwi=None, slope=None):
        """
        region: dict كما هو في results
        ndwi: قيمة NDWI للقطعة (يمكن حسابها إذا أردت)
        slope: انحدار متوسط للقطعة (يمكن حسابه إذا أردت)
        """
        label = region["label"]
        score = region.get("score", 0.0)
        width = region["width"]
        height = region["height"]
        polygon = region["polygon"]

        # قواعد أساسية من الوثيقة
        # مثال: NDWI > 0.25 → مجرى مائي
        if ndwi is not None:
            if ndwi > 0.25:
                label = "مجرى مائي"
                score = max(score, 0.9)
            elif ndwi < 0:
                label = "طريق"
                score = max(score, 0.9)

        # شكل المسار: خطي → طريق، متعرج → مجرى مائي
        xs = polygon[:,0]
        ys = polygon[:,1]
        dx = max(xs) - min(xs)
        dy = max(ys) - min(ys)
        aspect_ratio = dx / dy if dy > 0 else 1.0

        if aspect_ratio > 3.0:  # طويل ومستقيم تقريبا
            if label not in ["مجرى مائي"]:
                label = "طريق"
                score = max(score, 0.85)
        else:
            if label not in ["طريق"]:
                label = "مجرى مائي"
                score = max(score, 0.85)

        # الانحدار (Slope) إن توفر
        if slope is not None:
            if slope < 0:  # انحدار سلبي → مجرى
                label = "مجرى مائي"
                score = max(score, 0.9)
            elif slope == 0:
                label = "طريق"
                score = max(score, 0.9)

        # قواعد أخرى يمكن اضافتها لاحقاً حسب الوثيقة

        # نعيد النسخة المعدلة من region مع تصنيف جديد
        region["label"] = label
        region["score"] = score
        return region

    def apply_to_all(self, results, ndwi_map=None, slope_map=None):
        """
        معالجة جميع النتائج
        ndwi_map: خريطة NDWI بنفس حجم الصورة إذا أردت حساب NDWI لكل قطعة
        slope_map: خريطة انحدار
        """
        processed = []
        for r in results:
            # يمكن حساب NDWI متوسط داخل Polygon إذا ndwi_map متوفرة
            ndwi_val = None
            if ndwi_map is not None:
                mask = np.zeros(ndwi_map.shape, dtype=np.uint8)
                cv2.fillPoly(mask, [r["polygon"].astype(np.int32)], 1)
                vals = ndwi_map[mask>0]
                if len(vals) > 0:
                    ndwi_val = np.mean(vals)

            # مماثل للانحدار
            slope_val = None
            if slope_map is not None:
                mask = np.zeros(slope_map.shape, dtype=np.uint8)
                cv2.fillPoly(mask, [r["polygon"].astype(np.int32)], 1)
                vals = slope_map[mask>0]
                if len(vals) > 0:
                    slope_val = np.mean(vals)

            r_new = self.apply_rules(r, ndwi=ndwi_val, slope=slope_val)
            processed.append(r_new)
        return processed
