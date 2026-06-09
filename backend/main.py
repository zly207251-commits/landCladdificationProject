import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk
import cv2
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import land_classifier
import os

class LandClassificationApp:
    def __init__(self, root):
        self.root = root
        self.root.title("🌿 مصنف الأراضي الذكي - التصنيف باللون")
        self.root.geometry("1400x900")
        self.root.configure(bg='#f0f0f0')
        
        # إنشاء المصنف
        self.classifier = land_classifier.LandColorClassifier()
        self.current_image_path = None
        
        self.create_widgets()
    
    def create_widgets(self):
        # العنوان الرئيسي
        title_label = tk.Label(self.root, text="🌿 مصنف الأراضي الذكي", 
                              font=("Arial", 20, "bold"), bg='#f0f0f0', fg='#2c3e50')
        title_label.pack(pady=10)
        
        # وصف التطبيق
        desc_label = tk.Label(self.root, 
                             text="قم بتحميل صورة لأي قطعة أرض وسيقوم الذكاء الاصطناعي بتصنيفها إلى: زراعية، يابسة، طرق، أو مباني",
                             font=("Arial", 12), bg='#f0f0f0', fg='#7f8c8d', wraplength=1000)
        desc_label.pack(pady=5)
        
        # إطار التحكم
        control_frame = tk.Frame(self.root, bg='#f0f0f0')
        control_frame.pack(pady=15)
        
        # زر تحميل الصورة
        self.load_btn = tk.Button(control_frame, text="📁 تحميل صورة", 
                                 command=self.load_image, 
                                 font=("Arial", 14, "bold"),
                                 bg='#3498db', fg='white',
                                 padx=20, pady=10,
                                 cursor='hand2')
        self.load_btn.pack(side=tk.LEFT, padx=10)
        
        # زر تحليل الصورة
        self.analyze_btn = tk.Button(control_frame, text="🔍 تحليل الصورة", 
                                    command=self.analyze_image, 
                                    font=("Arial", 14, "bold"),
                                    bg='#27ae60', fg='white',
                                    padx=20, pady=10,
                                    state='disabled',
                                    cursor='hand2')
        self.analyze_btn.pack(side=tk.LEFT, padx=10)
        
        # شريط التقدم
        self.progress = ttk.Progressbar(control_frame, mode='indeterminate', length=200)
        self.progress.pack(side=tk.LEFT, padx=10)
        
        # إطار العرض الرئيسي
        main_display_frame = tk.Frame(self.root, bg='#f0f0f0')
        main_display_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        
        # إطار الصورة الأصلية
        self.original_frame = tk.LabelFrame(main_display_frame, text="الصورة الأصلية", 
                                           font=("Arial", 12, "bold"),
                                           bg='#f0f0f0', fg='#2c3e50')
        self.original_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=10)
        
        self.original_label = tk.Label(self.original_frame, text="لم يتم تحميل صورة بعد", 
                                      bg='#ecf0f1', fg='#7f8c8d',
                                      font=("Arial", 14), padx=100, pady=80)
        self.original_label.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # إطار النتائج
        self.result_frame = tk.LabelFrame(main_display_frame, text="نتائج التصنيف", 
                                         font=("Arial", 12, "bold"),
                                         bg='#f0f0f0', fg='#2c3e50')
        self.result_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=10)
        
        self.result_label = tk.Label(self.result_frame, text="النتائج ستظهر هنا بعد التحليل", 
                                    bg='#ecf0f1', fg='#7f8c8d',
                                    font=("Arial", 14), padx=100, pady=80)
        self.result_label.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # إطار التحليل التفصيلي
        self.analysis_frame = tk.LabelFrame(self.root, text="التحليل التفصيلي", 
                                           font=("Arial", 12, "bold"),
                                           bg='#f0f0f0', fg='#2c3e50')
        self.analysis_frame.pack(fill=tk.X, padx=20, pady=10)
        
        self.analysis_text = tk.Text(self.analysis_frame, height=8, font=("Arial", 11),
                                    bg='#ffffff', fg='#2c3e50', wrap=tk.WORD)
        scrollbar = tk.Scrollbar(self.analysis_frame, command=self.analysis_text.yview)
        self.analysis_text.configure(yscrollcommand=scrollbar.set)
        self.analysis_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=10, pady=10)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y, pady=10)
        
        # تعطيل التحرير في مربع النص
        self.analysis_text.config(state=tk.DISABLED)
        
        # تذييل الصفحة
        footer_label = tk.Label(self.root, text="تم التطوير باستخدام Python و OpenCV - الذكاء الاصطناعي لتحليل الصور",
                               font=("Arial", 10), bg='#f0f0f0', fg='#95a5a6')
        footer_label.pack(side=tk.BOTTOM, pady=10)
    
    def load_image(self):
        """تحميل صورة من الجهاز"""
        file_path = filedialog.askopenfilename(
            title="اختر صورة للأرض",
            filetypes=[("ملفات الصور", "*.jpg *.jpeg *.png *.bmp *.tiff")]
        )
        
        if file_path:
            try:
                self.current_image_path = file_path
                
                # عرض الصورة المصغرة
                self.display_image_thumbnail(file_path)
                
                # تفعيل زر التحليل
                self.analyze_btn.config(state='normal')
                
                # مسح النتائج السابقة
                self.clear_results()
                
                # إظهار معلومات الصورة
                self.show_image_info(file_path)
                
            except Exception as e:
                messagebox.showerror("خطأ", f"تعذر تحميل الصورة: {str(e)}")
    
    def display_image_thumbnail(self, image_path):
        """عرض صورة مصغرة في الواجهة"""
        image = Image.open(image_path)
        
        # تغيير حجم الصورة لتناسب الواجهة
        max_size = (400, 300)
        image.thumbnail(max_size, Image.Resampling.LANCZOS)
        
        photo = ImageTk.PhotoImage(image)
        self.original_label.configure(image=photo, text="")
        self.original_label.image = photo
    
    def show_image_info(self, image_path):
        """عرض معلومات الصورة"""
        image = cv2.imread(image_path)
        height, width = image.shape[:2]
        file_size = os.path.getsize(image_path) / 1024  # بالكيلوبايت
        
        info_text = f"معلومات الصورة:\n"
        info_text += f"• الأبعاد: {width} × {height} بيكسل\n"
        info_text += f"• الحجم: {file_size:.1f} كيلوبايت\n"
        info_text += f"• المسار: {os.path.basename(image_path)}"
        
        self.update_analysis_text(info_text)
    
    def analyze_image(self):
        """تحليل الصورة وتصنيفها"""
        if not self.current_image_path:
            messagebox.showwarning("تحذير", "يرجى تحميل صورة أولاً")
            return
        
        try:
            # بدء شريط التقدم
            self.progress.start()
            self.analyze_btn.config(state='disabled')
            
            # تصنيف الصورة
            main_class, results = self.classifier.classify_land(self.current_image_path)
            
            # إنشاء خريطة التصنيف
            land_map = self.classifier.create_land_map(self.current_image_path)
            
            # عرض النتائج
            self.display_results(main_class, results, land_map)
            
            # إيقاف شريط التقدم
            self.progress.stop()
            self.analyze_btn.config(state='normal')
            
        except Exception as e:
            self.progress.stop()
            self.analyze_btn.config(state='normal')
            messagebox.showerror("خطأ", f"حدث خطأ أثناء التحليل: {str(e)}")
    
    def display_results(self, main_class, results, land_map):
        """عرض نتائج التصنيف"""
        # عرض خريطة التصنيف
        land_map_rgb = cv2.cvtColor(land_map, cv2.COLOR_BGR2RGB)
        land_map_image = Image.fromarray(land_map_rgb)
        land_map_image.thumbnail((400, 300), Image.Resampling.LANCZOS)
        land_map_photo = ImageTk.PhotoImage(land_map_image)
        
        self.result_label.configure(image=land_map_photo, text="")
        self.result_label.image = land_map_photo
        
        # تحديث التحليل التفصيلي
        analysis_text = f"✅ **نتائج تحليل الصورة:**\n\n"
        analysis_text += f"🏷️ **التصنيف الرئيسي:** {self.get_arabic_class_name(main_class)}\n\n"
        analysis_text += f"📊 **نسب التصنيف التفصيلية:**\n"
        
        for land_type, ratio in list(results.items())[:4]:
            arabic_name = self.get_arabic_class_name(land_type)
            percentage = ratio * 100
            bar = "█" * int(percentage / 5)  # شريط تقدم
            analysis_text += f"   • {arabic_name}: {percentage:.1f}% {bar}\n"
        
        analysis_text += f"\n🎯 **معلومات تقنية:**\n"
        analysis_text += f"   • تباين النسيج: {results['texture_variance']:.2f}\n"
        analysis_text += f"   • عدد الألوان السائدة: {len(results['dominant_colors'])}\n"
        
        analysis_text += f"\n🎨 **مفتاح الألوان:**\n"
        analysis_text += f"   • 🟢 أخضر: المناطق الزراعية\n"
        analysis_text += f"   • 🟡 أصفر: المناطق اليابسة\n"
        analysis_text += f"   • ⚫ رمادي: الطرق\n"
        analysis_text += f"   • 🔴 أحمر: المباني\n"
        
        self.update_analysis_text(analysis_text)
    
    def get_arabic_class_name(self, english_name):
        """تحويل اسم التصنيف إلى العربية"""
        names = {
            'agricultural': 'أرض زراعية',
            'arid': 'أرض يابسة', 
            'roads': 'طرق',
            'buildings': 'مباني'
        }
        return names.get(english_name, english_name)
    
    def update_analysis_text(self, text):
        """تحديث نص التحليل التفصيلي"""
        self.analysis_text.config(state=tk.NORMAL)
        self.analysis_text.delete(1.0, tk.END)
        self.analysis_text.insert(1.0, text)
        self.analysis_text.config(state=tk.DISABLED)
    
    def clear_results(self):
        """مسح النتائج السابقة"""
        self.result_label.configure(image=None, text="النتائج ستظهر هنا بعد التحليل")
        self.update_analysis_text("سيظهر التحليل التفصيلي هنا بعد معالجة الصورة...")

def main():
    """الدالة الرئيسية لتشغيل التطبيق"""
    root = tk.Tk()
    app = LandClassificationApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()