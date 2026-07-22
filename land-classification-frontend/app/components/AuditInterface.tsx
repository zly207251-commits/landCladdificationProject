"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
const MapViewer = dynamic(() => import('./MapViewer'), { ssr: false });
import { LAYER_STYLES, API_CONFIG } from '@/app/lib/map-config';

interface AuditInterfaceProps {
  taskId?: string;
  initialFeatures?: any[];
  onSaveCorrections?: (corrections: any[]) => void;
  center?: [number, number] | null;
  zoom?: number | null;
}

export default function AuditInterface({ taskId, initialFeatures = [], onSaveCorrections, center = null, zoom = null }: AuditInterfaceProps) {
  const [selectedFeature, setSelectedFeature] = useState<any>(null);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [features, setFeatures] = useState<any[]>(initialFeatures);
  const [comment, setComment] = useState<string>('');
  const [newClassification, setNewClassification] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statistics, setStatistics] = useState({
    totalFeatures: 0,
    correctedFeatures: 0,
    pendingFeatures: 0,
    accuracy: 0
  });

  const defaultMapStyles = {
    buildings: { color: "#ff0000", width: 3, dash: "solid", fillOpacity: 0.2 },
    roads: { color: "#cccccc", width: 4, dash: "solid", fillOpacity: 0.0 },
    agricultural: { color: "#228b22", width: 3, dash: "solid", fillOpacity: 0.2 },
    water_bodies: { color: "#0000ff", width: 3, dash: "solid", fillOpacity: 0.2 },
    arid: { color: "#8b4513", width: 3, dash: "solid", fillOpacity: 0.2 },
    unknown: { color: "#ffff00", width: 3, dash: "solid", fillOpacity: 0.2 },
  };

  const [customStyles, setCustomStyles] = useState<any>(defaultMapStyles);
  const [isStylePanelOpen, setIsStylePanelOpen] = useState<boolean>(false);
  const [isUpdatingPreview, setIsUpdatingPreview] = useState<boolean>(false);

  useEffect(() => {
    const loadStyles = async () => {
      if (typeof window === "undefined") return;
      
      let activeStyles = { ...defaultMapStyles };
      const stored = window.localStorage.getItem("map_style_settings");
      if (stored) {
        try {
          activeStyles = { ...activeStyles, ...JSON.parse(stored) };
        } catch (e) {}
      }
      
      if (taskId) {
        try {
          const resp = await fetch(`${API_CONFIG.baseURL}/tasks/${taskId}/status`);
          if (resp.ok) {
            const data = await resp.json();
            const meta = data.metadata || {};
            const serverStyles = meta.styling;
            if (serverStyles) {
              activeStyles = { ...activeStyles, ...serverStyles };
            }
          }
        } catch (e) {}
      }
      
      setCustomStyles(activeStyles);
    };
    
    loadStyles();
  }, [taskId]);

  const updateStyle = (key: string, field: string, value: any) => {
    setCustomStyles((prev: any) => {
      const updated = {
        ...prev,
        [key]: {
          ...prev[key],
          [field]: value
        }
      };
      return updated;
    });
  };

  const handleSaveAsDefault = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("map_style_settings", JSON.stringify(customStyles));
      alert("⭐ تم حفظ هذا التنسيق كالمظهر الافتراضي لجميع المهام بنجاح!");
    }
  };

  const handleUpdateProcessedImage = async () => {
    if (!taskId) return;
    setIsUpdatingPreview(true);
    try {
      const saveResp = await fetch(`${API_CONFIG.baseURL}/tasks/${taskId}/style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styles: customStyles })
      });
      
      if (!saveResp.ok) throw new Error("فشل حفظ إعدادات المظهر على الخادم.");

      const regenResp = await fetch(`${API_CONFIG.baseURL}/tasks/${taskId}/regenerate-preview`, {
        method: "POST"
      });
      
      if (!regenResp.ok) throw new Error("فشل إعادة رندرة صورة المعاينة.");
      
      alert("🎉 تم تحديث الصورة النهائية الملونة بنجاح مع إعدادات التنسيق الجديدة!");
    } catch (e: any) {
      alert(`❌ حدث خطأ: ${e.message}`);
    } finally {
      setIsUpdatingPreview(false);
    }
  };

  // تحميل البيانات الأولية
  useEffect(() => {
    if (initialFeatures.length > 0) {
      setFeatures(initialFeatures);
      setStatistics({
        totalFeatures: initialFeatures.length,
        correctedFeatures: 0,
        pendingFeatures: initialFeatures.length,
        accuracy: 0
      });
    } else {
      // بيانات تجريبية
      const sampleFeatures = [
        {
          id: 'feature_1',
          properties: {
            name: 'قطعة أرض 1',
            classification: 'agricultural',
            layer_type: 'land_agent',
            area: 12.5,
            confidence: 0.78,
            description: 'أرض زراعية محتملة'
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [46.67, 24.71],
              [46.68, 24.71],
              [46.68, 24.72],
              [46.67, 24.72],
              [46.67, 24.71]
            ]]
          }
        },
        {
          id: 'feature_2',
          properties: {
            name: 'مبنى سكني',
            classification: 'residential',
            layer_type: 'building_agent',
            area: 0.45,
            confidence: 0.92,
            description: 'مبنى سكني عشوائي'
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [46.675, 24.715],
              [46.676, 24.715],
              [46.676, 24.716],
              [46.675, 24.716],
              [46.675, 24.715]
            ]]
          }
        }
      ];

      setFeatures(sampleFeatures);
      setStatistics({
        totalFeatures: sampleFeatures.length,
        correctedFeatures: 0,
        pendingFeatures: sampleFeatures.length,
        accuracy: 0
      });
    }
  }, [initialFeatures]);

  // معالجة النقر على المعلم
  const handleFeatureClick = (feature: any) => {
    setSelectedFeature(feature);
    setNewClassification(feature.properties?.classification || '');
    setComment('');
  };

  // حفظ التصحيح
  const handleSaveCorrection = () => {
    if (!selectedFeature || !newClassification) return;

    setIsSaving(true);

    const correction = {
      featureId: selectedFeature.id,
      originalClassification: selectedFeature.properties?.classification,
      newClassification,
      comment,
      timestamp: new Date().toISOString(),
      confidence: selectedFeature.properties?.confidence || 0,
      reviewedBy: 'user' // سيتم استبداله بالمستخدم الحقيقي
    };

    setCorrections(prev => [...prev, correction]);

    // تحديث الميزة
    const updatedFeatures = features.map(f => 
      f.id === selectedFeature.id 
        ? {
            ...f,
            properties: {
              ...f.properties,
              classification: newClassification,
              corrected: true,
              correctionDate: new Date().toISOString()
            }
          }
        : f
    );

    setFeatures(updatedFeatures);

    // تحديث الإحصائيات
    setStatistics(prev => ({
      ...prev,
      correctedFeatures: prev.correctedFeatures + 1,
      pendingFeatures: prev.totalFeatures - (prev.correctedFeatures + 1),
      accuracy: ((prev.correctedFeatures + 1) / prev.totalFeatures) * 100
    }));

    // إعادة تعيين النموذج
    setTimeout(() => {
      setSelectedFeature(null);
      setComment('');
      setIsSaving(false);

      if (onSaveCorrections) {
        onSaveCorrections([...corrections, correction]);
      }

      alert('✅ تم حفظ التصحيح بنجاح!');
    }, 500);
  };

  // تصدير التصحيحات للتدريب
  const exportCorrections = () => {
    if (corrections.length === 0) {
      alert('لا توجد تصحيحات لتصديرها');
      return;
    }

    const dataStr = JSON.stringify(corrections, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `corrections_${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    alert(`📥 تم تصدير ${corrections.length} تصحيح لاستخدامها في إعادة التدريب`);
  };

  // خيارات التصنيف
  const classificationOptions = Object.entries(LAYER_STYLES.classifications).map(([key, style]) => ({
    value: key,
    label: style.name,
    color: style.color
  }));

  const isValidFeature = (feature: any) => {
    return (
      feature?.type === 'Feature' &&
      feature.geometry?.type === 'Polygon' &&
      Array.isArray(feature.geometry.coordinates) &&
      feature.geometry.coordinates[0]?.length >= 4
    );
  };

  const validFeatures = features.filter(isValidFeature);

  // GeoJSON للخريطة
  const geojsonData = {
    type: 'FeatureCollection',
    features: validFeatures
  };

  return (
    <div className="engineering-glass glass-glow-cyan rounded-3xl overflow-hidden relative">
      {/* العنوان */}
      <div className="p-6 border-b border-slate-800">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span>🔍</span> واجهة التدقيق والمطابقة المساحية الجغرافية
        </h2>
        <p className="text-slate-400 text-xs mt-1">
          قم بتدقيق وتصحيح معالم الذكاء الاصطناعي بنظام الحلقة البشرية المغلقة (Human-in-the-Loop)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
        {/* الخريطة */}
        <div className="lg:col-span-2">
          <div className="p-4 border-b border-slate-800 flex flex-wrap justify-between items-center gap-2 bg-slate-950/40">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-200 text-xs">خريطة التدقيق التفاعلية</h3>
              <span className="px-2.5 py-0.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full text-[10px] font-bold">
                وضع التدقيق النشط
              </span>
            </div>
            
            <button
              onClick={() => setIsStylePanelOpen(!isStylePanelOpen)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 text-slate-300 rounded-xl text-xs font-semibold hover:text-white transition flex items-center gap-1 focus:outline-none"
            >
              <span>🎨 تخصيص المظهر</span>
              <svg className={`w-3 h-3 transform transition-transform ${isStylePanelOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          
          {isStylePanelOpen && (
            <div className="p-5 bg-slate-950/70 border-b border-slate-800 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-xs text-white">🎨 تنسيق ألوان وسماكة خطوط المعالم</h4>
                  <p className="text-[10px] text-slate-500 mt-0.5">التعديلات تنعكس فوراً على الخريطة. يمكنك حفظها كافتراضي لتعديل الصورة النهائية والـ KML.</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries({
                  buildings: { label: "المباني والمنشآت 🏢", key: "buildings" },
                  roads: { label: "الطرق والممرات 🛣️", key: "roads" },
                  agricultural: { label: "الأراضي الزراعية والجرب 🌾", key: "agricultural" },
                  water_bodies: { label: "الأودية ومجاري السيول 🌊", key: "water_bodies" },
                  arid: { label: "الجبال والأراضي البور ⛰️", key: "arid" },
                  unknown: { label: "معالم أخرى 🗺️", key: "unknown" }
                }).map(([key, item]) => {
                  const cfg = customStyles[key] || { color: "#cccccc", width: 2, dash: "solid", fillOpacity: 0.1 };
                  return (
                    <div key={key} className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-2 text-[11px]">
                      <div className="font-bold text-slate-200 border-b border-slate-800 pb-1 mb-1">{item.label}</div>
                      
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-500 font-mono-tech">Color:</span>
                        <input
                          type="color"
                          value={cfg.color}
                          onChange={(e) => updateStyle(key, "color", e.target.value)}
                          className="w-8 h-6 bg-slate-950 rounded border border-slate-850 cursor-pointer p-0"
                        />
                      </div>
 
                      <div className="space-y-0.5">
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>السمك:</span>
                          <span className="font-bold text-slate-300 font-mono-tech">{cfg.width}px</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={cfg.width}
                          onChange={(e) => updateStyle(key, "width", parseInt(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded cursor-pointer accent-cyan-400"
                        />
                      </div>
 
                      <div className="space-y-0.5">
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>الشفافية:</span>
                          <span className="font-bold text-slate-300 font-mono-tech">{Math.round(cfg.fillOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={cfg.fillOpacity}
                          onChange={(e) => updateStyle(key, "fillOpacity", parseFloat(e.target.value))}
                          className="w-full h-1 bg-slate-800 rounded cursor-pointer accent-cyan-400"
                        />
                      </div>
 
                      <div className="flex justify-between items-center gap-1">
                        <span className="text-[10px] text-slate-500">شكل الخط:</span>
                        <select
                          value={cfg.dash}
                          onChange={(e) => updateStyle(key, "dash", e.target.value)}
                          className="bg-slate-950 text-slate-300 px-1 py-0.5 rounded text-[10px] focus:outline-none border border-slate-800"
                        >
                          <option value="solid">مستمر ━</option>
                          <option value="dashed">متقطع ╌</option>
                          <option value="dotted">منقط 🞄</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
 
              {taskId && (
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={handleSaveAsDefault}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold flex items-center gap-1 focus:outline-none"
                  >
                    <span>⭐ حفظ كافتراضي</span>
                  </button>
                  
                  <button
                    type="button"
                    onClick={handleUpdateProcessedImage}
                    disabled={isUpdatingPreview}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold disabled:opacity-50 flex items-center gap-1 focus:outline-none"
                  >
                    {isUpdatingPreview ? (
                      <>
                        <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></span>
                        <span>جاري تحديث الخادم...</span>
                      </>
                    ) : (
                      <>
                        <span>💾 تطبيق المظهر وتحديث المعاينة</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
          
          <div className="h-[500px] p-4 bg-slate-950/20">
            <MapViewer
              taskId={taskId}
              geojsonData={geojsonData}
              onPolygonClick={handleFeatureClick}
              selectedFeature={selectedFeature}
              editMode={true}
              center={center}
              zoom={zoom}
              customStyles={customStyles}
            />
          </div>
 
          {/* تعليمات التدقيق */}
          <div className="p-4 border-t border-slate-800 bg-slate-950/20">
            <div className="bg-cyan-950/20 border-r-4 border-cyan-500 p-4 rounded-r-xl">
              <div className="flex">
                <div className="flex-shrink-0">
                  <span className="text-cyan-400">💡</span>
                </div>
                <div className="mr-3">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    <strong>كيفية الاستخدام:</strong> انقر على أي معلم (مضلع) في الخريطة، ثم قم بتصحيح تصنيفه أو إدخال ملاحظات في اللوحة الجانبية. كل تصحيح يساعد النظام على التعلم التلقائي!
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
 
        {/* لوحة التدقيق الجانبية */}
        <div className="border-r border-slate-800 bg-slate-900/40">
          <div className="p-6 space-y-6">
            {/* إحصائيات */}
            <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800">
              <h4 className="font-semibold text-white mb-3 text-xs tracking-wider uppercase text-cyan-400">📊 إحصائيات المطابقة والتدقيق</h4>
              <div className="grid grid-cols-2 gap-3 font-mono-tech">
                <div className="text-center p-3 bg-slate-900 rounded-xl border border-slate-850">
                  <div className="text-xl font-bold text-slate-200">{statistics.totalFeatures}</div>
                  <div className="text-[10px] text-slate-500 font-sans mt-0.5">إجمالي المعالم</div>
                </div>
                <div className="text-center p-3 bg-slate-900 rounded-xl border border-slate-850">
                  <div className="text-xl font-bold text-emerald-400">{statistics.correctedFeatures}</div>
                  <div className="text-[10px] text-slate-500 font-sans mt-0.5">تم تصحيحها</div>
                </div>
                <div className="text-center p-3 bg-slate-900 rounded-xl border border-slate-850">
                  <div className="text-xl font-bold text-amber-500">{statistics.pendingFeatures}</div>
                  <div className="text-[10px] text-slate-500 font-sans mt-0.5">قيد الانتظار</div>
                </div>
                <div className="text-center p-3 bg-slate-900 rounded-xl border border-slate-850">
                  <div className="text-xl font-bold text-cyan-400">{statistics.accuracy.toFixed(1)}%</div>
                  <div className="text-[10px] text-slate-500 font-sans mt-0.5">الدقة المحسوبة</div>
                </div>
              </div>
            </div>
 
            {/* تفاصيل المعلم المحدد */}
            {selectedFeature ? (
              <div className="space-y-6">
                <div>
                  <h4 className="font-semibold text-slate-200 mb-3 text-xs">المعلم المساحي المحدد</h4>
                  
                  <div className="p-4 bg-slate-950/50 rounded-2xl border border-slate-800 mb-4">
                    <div className="space-y-2 text-xs font-mono-tech">
                      <div className="flex justify-between border-b border-slate-900 pb-1.5">
                        <span className="text-slate-500 font-sans">المساحة المحسوبة:</span>
                        <span className="font-semibold text-slate-200">{selectedFeature.properties?.area || 'غير معروف'} كم²</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-900 pb-1.5">
                        <span className="text-slate-500 font-sans">نوع الطبقة الأصلية:</span>
                        <span className="font-semibold text-slate-200">
                          {LAYER_STYLES.agents[selectedFeature.properties?.layer_type as keyof typeof LAYER_STYLES.agents]?.name || 'غير معروف'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-sans">ثقة نموذج SAM:</span>
                        <span className="font-semibold text-cyan-400">
                          {((selectedFeature.properties?.confidence || 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
 
                  {/* التصنيف الحالي */}
                  <div className="mb-4">
                    <label className="block text-slate-400 mb-2 text-xs">التصنيف الحالي</label>
                    <div className="flex items-center p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
                      <div 
                        className="w-4 h-4 rounded mr-3"
                        style={{ 
                          backgroundColor: LAYER_STYLES.classifications[selectedFeature.properties?.classification as keyof typeof LAYER_STYLES.classifications]?.color || '#cccccc'
                        }}
                      ></div>
                      <span className="font-semibold text-slate-200 text-xs">
                        {LAYER_STYLES.classifications[selectedFeature.properties?.classification as keyof typeof LAYER_STYLES.classifications]?.name || selectedFeature.properties?.classification}
                      </span>
                    </div>
                  </div>
 
                  {/* التصنيف الجديد */}
                  <div className="mb-4">
                    <label className="block text-slate-400 mb-2 text-xs">التصنيف الجديد المقترح</label>
                    <select
                      value={newClassification}
                      onChange={(e) => setNewClassification(e.target.value)}
                      className="w-full p-3 bg-slate-900 border border-slate-800 text-slate-200 rounded-xl focus:outline-none focus:border-cyan-500 transition text-xs"
                    >
                      <option value="">اختر تصنيفاً جديداً</option>
                      {classificationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    
                    {newClassification && (
                      <div className="mt-3 flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded"
                          style={{ 
                            backgroundColor: LAYER_STYLES.classifications[newClassification as keyof typeof LAYER_STYLES.classifications]?.color || '#cccccc'
                          }}
                        ></div>
                        <span className="text-[10px] text-slate-400">
                          سيتم التوجيه للطبقة: {LAYER_STYLES.classifications[newClassification as keyof typeof LAYER_STYLES.classifications]?.name}
                        </span>
                      </div>
                    )}
                  </div>
 
                  {/* الملاحظات */}
                  <div className="mb-6">
                    <label className="block text-slate-400 mb-2 text-xs">ملاحظات مساحية (مترية)</label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="أضف ملاحظات التثمين والتربة هنا لمساعدة النموذج على التعلم..."
                      className="w-full p-3 bg-slate-900 border border-slate-800 text-slate-200 rounded-xl focus:outline-none focus:border-cyan-500 transition text-xs min-h-[100px]"
                    ></textarea>
                  </div>
 
                  {/* زر الحفظ */}
                  <button
                    onClick={handleSaveCorrection}
                    disabled={isSaving || !newClassification}
                    className={`w-full py-3 px-6 rounded-xl font-bold text-xs transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      isSaving || !newClassification
                        ? 'bg-slate-800 text-slate-600 border border-slate-850'
                        : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                    }`}
                  >
                    {isSaving ? (
                      <span className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-3"></div>
                        جاري الحفظ...
                      </span>
                    ) : (
                      '💾 حفظ وتأكيد التصحيح المساحي'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/20">
                <span className="text-3xl block mb-3 text-slate-600">🗺️</span>
                <h4 className="font-semibold text-slate-300 mb-1.5 text-xs">اختر معلماً للتدقيق</h4>
                <p className="text-slate-500 text-[10px] leading-relaxed px-4">
                  انقر على أي مضلع مساحي في الخريطة لبدء عملية المطابقة وتثمين التربة وتعديل الحدود.
                </p>
              </div>
            )}
 
            {/* تصدير التصحيحات */}
            {corrections.length > 0 && (
              <div className="pt-6 border-t border-slate-800">
                <button
                  onClick={exportCorrections}
                  className="w-full py-3 px-6 bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-cyan-800/40 rounded-xl font-bold text-xs transition-all shadow"
                >
                  📥 تصدير ملف التصحيحات المحدثة ({corrections.length})
                </button>
                <p className="text-center text-[10px] text-slate-500 mt-2">
                  ⚡ سيتم إلحاق هذه البيانات لتدريب شبكة الوكلاء في المعالجة القادمة.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
 
      {/* تذييل معلومات النظام */}
      <div className="p-6 border-t border-slate-800 bg-slate-950/40">
        <h4 className="font-bold text-white mb-3 text-xs">🤖 نظام حلقة التدقيق البشري المغلقة (Human-in-the-Loop)</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3.5 bg-slate-900 border border-slate-850 rounded-xl">
            <h5 className="font-bold text-cyan-400 mb-1 text-xs">الخطوة 1: التدقيق البشري</h5>
            <p className="text-[10px] text-slate-400 leading-relaxed">يقوم المساح بتدقيق الأبعاد والحدود المنقوصة وتعديل التصنيفات غير الدقيقة.</p>
          </div>
          <div className="p-3.5 bg-slate-900 border border-slate-850 rounded-xl">
            <h5 className="font-bold text-emerald-400 mb-1 text-xs">الخطوة 2: الحفظ السحابي</h5>
            <p className="text-[10px] text-slate-400 leading-relaxed">تُحفظ كافة التصحيحات في قاعدة بيانات الذاكرة المشتركة للوكلاء.</p>
          </div>
          <div className="p-3.5 bg-slate-900 border border-slate-850 rounded-xl">
            <h5 className="font-bold text-amber-500 mb-1 text-xs">الخطوة 3: التوجيه وإعادة التدريب</h5>
            <p className="text-[10px] text-slate-400 leading-relaxed">يستخدم النظام البيانات لتعلم أنماط الجرب والمباني الجبلية وزيادة الدقة تلقائياً.</p>
          </div>
        </div>
      </div>
    </div>
  );
}