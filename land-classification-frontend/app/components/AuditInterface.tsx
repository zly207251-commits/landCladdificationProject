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
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
      {/* العنوان */}
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-2xl font-semibold text-gray-800">
          واجهة التدقيق الجغرافي
        </h2>
        <p className="text-gray-600 mt-1">
          قم بتدقيق وتصحيح نتائج الذكاء الاصطناعي (Human-in-the-Loop)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
        {/* الخريطة */}
        <div className="lg:col-span-2">
          <div className="p-4 border-b border-gray-200 flex flex-wrap justify-between items-center gap-2 bg-slate-50">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-800">خريطة التدقيق التفاعلية</h3>
              <span className="px-3 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                وضع التدقيق
              </span>
            </div>
            
            <button
              onClick={() => setIsStylePanelOpen(!isStylePanelOpen)}
              className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-xs font-semibold hover:from-blue-700 hover:to-indigo-700 shadow transition flex items-center gap-1 focus:outline-none"
            >
              <span>🎨 تخصيص المظهر</span>
              <svg className={`w-3 h-3 transform transition-transform ${isStylePanelOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          
          {isStylePanelOpen && (
            <div className="p-4 bg-slate-100 border-b border-gray-200 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-xs text-slate-800">🎨 تنسيق ألوان وسماكة خطوط المعالم</h4>
                  <p className="text-[10px] text-slate-500 mt-0.5">التعديلات تنعكس فوراً على الخريطة. يمكنك حفظها لتعديل الصورة النهائية والـ KML.</p>
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
                    <div key={key} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-2 text-xs">
                      <div className="font-bold text-slate-700 border-b pb-1 mb-1">{item.label}</div>
                      
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-500">اللون:</span>
                        <input
                          type="color"
                          value={cfg.color}
                          onChange={(e) => updateStyle(key, "color", e.target.value)}
                          className="w-8 h-6 rounded border cursor-pointer p-0"
                        />
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>السمك:</span>
                          <span className="font-bold">{cfg.width}px</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={cfg.width}
                          onChange={(e) => updateStyle(key, "width", parseInt(e.target.value))}
                          className="w-full h-1 bg-slate-200 rounded cursor-pointer"
                        />
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>الشفافية:</span>
                          <span className="font-bold">{Math.round(cfg.fillOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={cfg.fillOpacity}
                          onChange={(e) => updateStyle(key, "fillOpacity", parseFloat(e.target.value))}
                          className="w-full h-1 bg-slate-200 rounded cursor-pointer"
                        />
                      </div>

                      <div className="flex justify-between items-center gap-1">
                        <span className="text-[10px] text-slate-500">شكل الخط:</span>
                        <select
                          value={cfg.dash}
                          onChange={(e) => updateStyle(key, "dash", e.target.value)}
                          className="bg-slate-50 text-slate-700 px-1 py-0.5 rounded text-[10px] focus:outline-none border"
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
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={handleSaveAsDefault}
                    className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-xs font-semibold shadow flex items-center gap-1 focus:outline-none"
                  >
                    <span>⭐ حفظ المظهر كافتراضي</span>
                  </button>
                  
                  <button
                    type="button"
                    onClick={handleUpdateProcessedImage}
                    disabled={isUpdatingPreview}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow disabled:opacity-50 flex items-center gap-1 focus:outline-none"
                  >
                    {isUpdatingPreview ? (
                      <>
                        <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></span>
                        <span>جاري تحديث الخادم...</span>
                      </>
                    ) : (
                      <>
                        <span>💾 تطبيق المظهر وتحديث الصورة المعالجة</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
          
          <div className="h-[500px] p-4">
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
          <div className="p-4 border-t border-gray-200">
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="w-5 h-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="mr-3">
                  <p className="text-sm text-yellow-700">
                    <strong>كيفية الاستخدام:</strong> انقر على أي معلم في الخريطة، ثم قم بتصحيح تصنيفه في اللوحة الجانبية. كل تصحيح يساعد النظام على التعلم!
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* لوحة التدقيق الجانبية */}
        <div className="border-l border-gray-200">
          <div className="p-6 space-y-6">
            {/* إحصائيات */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg border border-blue-200">
              <h4 className="font-semibold text-gray-800 mb-3">📊 إحصائيات التدقيق</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-white rounded border">
                  <div className="text-2xl font-bold text-blue-600">{statistics.totalFeatures}</div>
                  <div className="text-sm text-gray-600">إجمالي المعالم</div>
                </div>
                <div className="text-center p-3 bg-white rounded border">
                  <div className="text-2xl font-bold text-green-600">{statistics.correctedFeatures}</div>
                  <div className="text-sm text-gray-600">تم تصحيحها</div>
                </div>
                <div className="text-center p-3 bg-white rounded border">
                  <div className="text-2xl font-bold text-orange-600">{statistics.pendingFeatures}</div>
                  <div className="text-sm text-gray-600">قيد الانتظار</div>
                </div>
                <div className="text-center p-3 bg-white rounded border">
                  <div className="text-2xl font-bold text-purple-600">{statistics.accuracy.toFixed(1)}%</div>
                  <div className="text-sm text-gray-600">الدقة</div>
                </div>
              </div>
            </div>

            {/* تفاصيل المعلم المحدد */}
            {selectedFeature ? (
              <div className="space-y-6">
                <div>
                  <h4 className="font-semibold text-gray-800 mb-3">المعلم المحدد</h4>
                  
                  <div className="p-4 bg-gray-50 rounded-lg mb-4">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">المساحة:</span>
                        <span className="font-semibold">{selectedFeature.properties?.area || 'غير معروف'} كم²</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">نوع الطبقة:</span>
                        <span className="font-semibold">
                          {LAYER_STYLES.agents[selectedFeature.properties?.layer_type as keyof typeof LAYER_STYLES.agents]?.name || 'غير معروف'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">ثقة النموذج:</span>
                        <span className="font-semibold">
                          {((selectedFeature.properties?.confidence || 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* التصنيف الحالي */}
                  <div className="mb-4">
                    <label className="block text-gray-700 mb-2 font-medium">التصنيف الحالي</label>
                    <div className="flex items-center p-3 bg-gray-100 rounded-lg">
                      <div 
                        className="w-6 h-6 rounded mr-3"
                        style={{ 
                          backgroundColor: LAYER_STYLES.classifications[selectedFeature.properties?.classification as keyof typeof LAYER_STYLES.classifications]?.color || '#cccccc'
                        }}
                      ></div>
                      <span className="font-semibold">
                        {LAYER_STYLES.classifications[selectedFeature.properties?.classification as keyof typeof LAYER_STYLES.classifications]?.name || selectedFeature.properties?.classification}
                      </span>
                    </div>
                  </div>

                  {/* التصنيف الجديد */}
                  <div className="mb-4">
                    <label className="block text-gray-700 mb-2 font-medium">التصنيف الجديد</label>
                    <select
                      value={newClassification}
                      onChange={(e) => setNewClassification(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      <option value="">اختر تصنيفاً جديداً</option>
                      {classificationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    
                    {newClassification && (
                      <div className="mt-2 flex items-center">
                        <div 
                          className="w-6 h-6 rounded mr-2"
                          style={{ 
                            backgroundColor: LAYER_STYLES.classifications[newClassification as keyof typeof LAYER_STYLES.classifications]?.color || '#cccccc'
                          }}
                        ></div>
                        <span className="text-sm text-gray-600">
                          سيتم تغيير التصنيف إلى: {LAYER_STYLES.classifications[newClassification as keyof typeof LAYER_STYLES.classifications]?.name}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* الملاحظات */}
                  <div className="mb-6">
                    <label className="block text-gray-700 mb-2 font-medium">ملاحظات (اختياري)</label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="أضف ملاحظاتك هنا لمساعدة النظام على التعلم..."
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent min-h-[100px]"
                    ></textarea>
                  </div>

                  {/* زر الحفظ */}
                  <button
                    onClick={handleSaveCorrection}
                    disabled={isSaving || !newClassification}
                    className={`w-full py-3 px-6 rounded-lg font-semibold text-white transition-all ${
                      isSaving || !newClassification
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 shadow-lg hover:shadow-xl'
                    }`}
                  >
                    {isSaving ? (
                      <span className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-3"></div>
                        جاري الحفظ...
                      </span>
                    ) : (
                      '💾 حفظ التصحيح'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 7m0 10V7" />
                </svg>
                <h4 className="font-semibold text-gray-800 mb-2">اختر معلماً للتدقيق</h4>
                <p className="text-gray-600 text-sm">
                  انقر على أي معلم في الخريطة لبدء عملية التدقيق والتصحيح
                </p>
              </div>
            )}

            {/* تصدير التصحيحات */}
            {corrections.length > 0 && (
              <div className="pt-6 border-t border-gray-200">
                <button
                  onClick={exportCorrections}
                  className="w-full py-3 px-6 bg-gradient-to-r from-green-500 to-blue-500 text-white rounded-lg font-semibold hover:from-green-600 hover:to-blue-600 transition-all shadow-lg"
                >
                  📥 تصدير التصحيحات لإعادة التدريب ({corrections.length})
                </button>
                <p className="text-center text-xs text-gray-500 mt-2">
                  ⚡ التصحيحات ستستخدم لتحسين دقة وكيل الأراضي (Human-in-the-Loop)
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* تذييل معلومات النظام */}
      <div className="p-6 border-t border-gray-200 bg-gradient-to-r from-gray-50 to-blue-50">
        <h4 className="font-semibold text-gray-800 mb-3">🤖 نظام حلقة التدقيق البشري (Human-in-the-Loop)</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 bg-white rounded border">
            <h5 className="font-semibold text-blue-700 mb-1">التدقيق</h5>
            <p className="text-sm text-gray-600">المستخدم يصحح أخطاء الوكيل عبر واجهة سهلة</p>
          </div>
          <div className="p-3 bg-white rounded border">
            <h5 className="font-semibold text-green-700 mb-1">التعلم</h5>
            <p className="text-sm text-gray-600">التصحيحات تُخزن في قاعدة بيانات للتدريب</p>
          </div>
          <div className="p-3 bg-white rounded border">
            <h5 className="font-semibold text-purple-700 mb-1">التحسين</h5>
            <p className="text-sm text-gray-600">النموذج يُعاد تدريبه ليصبح أكثر دقة</p>
          </div>
        </div>
      </div>
    </div>
  );
}