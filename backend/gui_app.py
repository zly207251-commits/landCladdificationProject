import tkinter as tk
from tkinter import filedialog, messagebox
from PIL import Image, ImageTk
import cv2
import numpy as np
from land_classifier import LandColorClassifier

class LandClassificationApp:
    def __init__(self, root):
        self.root = root
        self.root.title("مصنف الأراضي الذكي - التصنيف باللون")
        self.root.geometry("1200x800")
        
        self.classifier = LandColorClassifier()
        self.current_image = None
        
        self.create_widgets()
    
    def create_widgets(self):
        # زر تحميل الصورة
        load_btn = tk.Button(self.root, text="تحميل صورة", command=self.load_image, 
                           font=("Arial", 14), bg="blue", fg="white")
        load_btn.pack(pady=10)
        
        # إطار لعرض الصور
        self.image_frame = tk.Frame(self.root)
        self.image_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # عناصر لعرض الصور
        self.original_label = tk.Label(self.image_frame)
        self.original_label.grid(row=0, column=0, padx=5)
        
        self.result_label = tk.Label(self.image_frame)
        self.result_label.grid(row=0, column=1, padx=5)
        
        # إطار للنتائج
        self.result_frame = tk.Frame(self.root)
        self.result_frame.pack(fill=tk.X, padx=10, pady=10)
        
        self.result_text = tk.Text(self.result_frame, height=8, font=("Arial", 12))
        self.result_text.pack(fill=tk.X)
    
    def load_image(self):
        file_path = filedialog.askopenfilename(
            filetypes=[("Image files", "*.jpg *.jpeg *.png *.bmp")]
        )
        
        if file_path:
            try:
                self.current_image = file_path
                self.process_image(file_path)
            except Exception as e:
                messagebox.showerror("خطأ", f"تعذر تحميل الصورة: {e}")
    
    def process_image(self, image_path):
        # تصنيف الصورة
        main_class, results = self.classifier.classify_land(image_path)
        land_map = self.classifier.create_land_map(image_path)
        
        # عرض الصور
        original_image = Image.open(image_path)
        original_image = original_image.resize((400, 400))
        original_photo = ImageTk.PhotoImage(original_image)
        
        land_map_image = Image.fromarray(cv2.cvtColor(land_map, cv2.COLOR_BGR2RGB))
        land_map_image = land_map_image.resize((400, 400))
        land_map_photo = ImageTk.PhotoImage(land_map_image)
        
        self.original_label.configure(image=original_photo)
        self.original_label.image = original_photo
        
        self.result_label.configure(image=land_map_photo)
        self.result_label.image = land_map_photo
        
        # عرض النتائج
        result_str = f"التصنيف الرئيسي: {main_class}\n\n"
        result_str += "نسب التصنيف:\n"
        for land_type, ratio in list(results.items())[:4]:
            result_str += f"  - {land_type}: {ratio:.2%}\n"
        
        result_str += f"\nتباين النسيج: {results['texture_variance']:.2f}\n"
        result_str += "\nتفسير النتائج:\n"
        result_str += "• الزراعية: المناطق الخضراء والبنية\n"
        result_str += "• اليابسة: المناطق الصفراء/البنية الفاتحة\n"
        result_str += "• الطرق: المناطق الرمادية والداكنة\n"
        result_str += "• المباني: المناطق الحمراء والخرسانية\n"
        
        self.result_text.delete(1.0, tk.END)
        self.result_text.insert(1.0, result_str)

# تشغيل التطبيق
if __name__ == "__main__":
    root = tk.Tk()
    app = LandClassificationApp(root)
    root.mainloop()