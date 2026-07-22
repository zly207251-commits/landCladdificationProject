"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SamSettings {
  samUseFallback: boolean;
  samMinMaskRegionArea: string;
  samPointsPerSide: string;
  samPredIoUThresh: string;
  samStabilityScoreThresh: string;
}

const defaultSettings: SamSettings = {
  samUseFallback: false,
  samMinMaskRegionArea: "500",
  samPointsPerSide: "16",
  samPredIoUThresh: "0.45",
  samStabilityScoreThresh: "0.30",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SamSettings>(defaultSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("land_agent_sam_settings");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as SamSettings;
        setSettings({ ...defaultSettings, ...parsed });
      } catch {
        setSettings(defaultSettings);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("land_agent_sam_settings", JSON.stringify(settings));
    setSaved(true);
    const timeout = window.setTimeout(() => setSaved(false), 1200);
    return () => window.clearTimeout(timeout);
  }, [settings]);

  const update = (key: keyof SamSettings, value: string | boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const defaultMapStyles = {
    buildings: { color: "#ff0000", width: 3, dash: "solid", fillOpacity: 0.2 },
    roads: { color: "#cccccc", width: 4, dash: "solid", fillOpacity: 0.0 },
    agricultural: { color: "#228b22", width: 3, dash: "solid", fillOpacity: 0.2 },
    water_bodies: { color: "#0000ff", width: 3, dash: "solid", fillOpacity: 0.2 },
    arid: { color: "#8b4513", width: 3, dash: "solid", fillOpacity: 0.2 },
    unknown: { color: "#ffff00", width: 3, dash: "solid", fillOpacity: 0.2 },
  };

  const [customStyles, setCustomStyles] = useState<any>(defaultMapStyles);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("map_style_settings");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setCustomStyles({ ...defaultMapStyles, ...parsed });
      } catch (e) {
        setCustomStyles(defaultMapStyles);
      }
    }
  }, []);

  const updateGlobalStyle = (key: string, field: string, value: any) => {
    setCustomStyles((prev: any) => {
      const updated = {
        ...prev,
        [key]: {
          ...prev[key],
          [field]: value
        }
      };
      if (typeof window !== "undefined") {
        window.localStorage.setItem("map_style_settings", JSON.stringify(updated));
      }
      return updated;
    });
  };

  return (
    <main className="min-h-screen bg-[#0b0f19] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#0b0f19] to-black p-4 md:p-8 relative">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b1a_1px,transparent_1px),linear-gradient(to_bottom,#1e293b1a_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none"></div>

      <div className="max-w-7xl mx-auto grid gap-6 lg:grid-cols-[280px_1fr] relative z-10">
        
        {/* القائمة الجانبية */}
        <aside className="engineering-glass p-6 rounded-3xl border border-slate-800 shadow-xl flex flex-col justify-between h-fit gap-6">
          <div>
            <div className="mb-6 border-b border-slate-800 pb-4">
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <span>⚙️</span> إعدادات النظام
              </h1>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">تخصيص معايير ونماذج الذكاء الاصطناعي والمظهر المساحي.</p>
            </div>
            <nav className="space-y-2">
              <Link href="/" className="block text-center text-xs font-semibold px-4 py-3 bg-slate-900 border border-slate-800 hover:border-slate-750 text-slate-300 rounded-xl transition">
                🏠 العودة للرئيسية
              </Link>
              <Link href="/survey" className="block text-center text-xs font-semibold px-4 py-3 bg-slate-900 border border-slate-800 hover:border-slate-750 text-slate-300 rounded-xl transition">
                🛰️ منصة استيراد جديد
              </Link>
              <Link href="/history" className="block text-center text-xs font-semibold px-4 py-3 bg-slate-900 border border-slate-800 hover:border-slate-750 text-slate-300 rounded-xl transition">
                📜 سجل ومطابقة السجلات
              </Link>
            </nav>
          </div>
          <div className="text-[9px] text-slate-500 font-mono-tech border-t border-slate-850 pt-4">
            GEO-AI SYSTEM V2.0 • YEMEN
          </div>
        </aside>

        {/* لوحة التحكم بالإعدادات */}
        <section className="space-y-6">
          <div className="engineering-glass glass-glow-cyan p-6 rounded-3xl border border-slate-800 shadow-xl relative">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-4 mb-6">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>⚙️</span> معلمات ومعايير نموذج SAM
                </h2>
                <p className="text-xs text-slate-400 mt-1">تعديل معايير Segment Anything لتقليل الضوضاء وتجزئة المضلعات العشوائية.</p>
              </div>
              <div className={`px-3 py-1.5 rounded-xl text-[10px] font-mono-tech ${saved ? 'bg-emerald-950/40 border border-emerald-900/40 text-emerald-400' : 'bg-cyan-950/40 border border-cyan-800/40 text-cyan-400'}`}>
                {saved ? '✓ AUTOSAVED TO LOCAL' : 'ℹ AUTO-SAVING...'}
              </div>
            </div>

            <div className="grid gap-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="bg-slate-950/40 p-4 border border-slate-850 rounded-2xl flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-300">تمكين التراجع في SAM (Fallback Mode)</span>
                    <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      في حال كانت الأقنعة المستخرجة من الصورة الجوية غير كافية، سيقوم النظام تلقائياً بتخفيف الشروط.
                    </p>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => update("samUseFallback", !settings.samUseFallback)}
                      className={`px-4 py-2 text-xs font-bold rounded-xl transition ${settings.samUseFallback ? 'bg-cyan-600 text-slate-950' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'}`}
                    >
                      {settings.samUseFallback ? 'مفعّل (ACTIVE)' : 'معطّل (DISABLED)'}
                    </button>
                  </div>
                </div>

                <div className="bg-slate-950/40 p-4 border border-slate-850 rounded-2xl flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-300">أدنى مساحة لقناع SAM (بكسل)</span>
                    <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      تجاهل المضلعات والأقنعة بالغة الصغر لمنع التجزئة العشوائية وتقليل ضوضاء الرسم.
                    </p>
                  </div>
                  <input
                    type="number"
                    min="10"
                    step="10"
                    value={settings.samMinMaskRegionArea}
                    onChange={(e) => update("samMinMaskRegionArea", e.target.value)}
                    className="mt-4 w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-xl px-4 py-2.5 text-xs font-mono-tech focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="bg-slate-950/40 p-4 border border-slate-850 rounded-2xl space-y-3">
                  <span className="text-xs font-bold text-slate-300">نقاط SAM لكل جانب</span>
                  <input
                    type="number"
                    min="4"
                    step="1"
                    value={settings.samPointsPerSide}
                    onChange={(e) => update("samPointsPerSide", e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-xl px-4 py-2.5 text-xs font-mono-tech focus:border-cyan-500 focus:outline-none"
                  />
                  <p className="text-[9px] text-slate-500 leading-relaxed">
                    زيادة العدد تنتج أقنعة أدق للمباني، لكنها قد تزيد من زمن التحليل.
                  </p>
                </div>

                <div className="bg-slate-950/40 p-4 border border-slate-850 rounded-2xl space-y-3">
                  <span className="text-xs font-bold text-slate-300">عتبة IoU المقدرة</span>
                  <input
                    type="number"
                    min="0.1"
                    max="1"
                    step="0.01"
                    value={settings.samPredIoUThresh}
                    onChange={(e) => update("samPredIoUThresh", e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-xl px-4 py-2.5 text-xs font-mono-tech focus:border-cyan-500 focus:outline-none"
                  />
                  <p className="text-[9px] text-slate-500 leading-relaxed">
                    عتبة دمج المربعات المتقاطعة؛ رفعها يمنع التكرار وخفضها يعطي تفاصيل أكثر.
                  </p>
                </div>

                <div className="bg-slate-950/40 p-4 border border-slate-850 rounded-2xl space-y-3">
                  <span className="text-xs font-bold text-slate-300">ثبات قناع الحدود</span>
                  <input
                    type="number"
                    min="0.0"
                    max="1"
                    step="0.01"
                    value={settings.samStabilityScoreThresh}
                    onChange={(e) => update("samStabilityScoreThresh", e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-xl px-4 py-2.5 text-xs font-mono-tech focus:border-cyan-500 focus:outline-none"
                  />
                  <p className="text-[9px] text-slate-500 leading-relaxed">
                    مستوى ثبات المضلع الجغرافي؛ خفض القيمة يقبل المزيد من المعالم الخشنة.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* تنسيق الألوان والمظهر */}
          <div className="engineering-glass glass-glow-cyan p-6 rounded-3xl border border-slate-800 shadow-xl relative">
            <div className="border-b border-slate-800 pb-4 mb-6">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>🎨</span> مظهر وتنسيق الخطوط الافتراضي (Default CAD Layers Style)
              </h2>
              <p className="text-xs text-slate-400 mt-1">تحديد سمات العرض الافتراضية للمعالم المقتطعة على الويب وملفات الأوتوكاد.</p>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                  <div key={key} className="bg-slate-950/40 p-4 border border-slate-850 rounded-2xl space-y-4">
                    <div className="font-bold text-slate-200 text-xs border-b border-slate-900 pb-2 mb-2">{item.label}</div>
                    
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">اللون الافتراضي:</span>
                      <input
                        type="color"
                        value={cfg.color}
                        onChange={(e) => updateGlobalStyle(key, "color", e.target.value)}
                        className="w-8 h-8 rounded border border-slate-800 cursor-pointer p-0 bg-transparent"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>سماكة الخط:</span>
                        <span className="font-bold font-mono-tech text-cyan-400">{cfg.width}px</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={cfg.width}
                        onChange={(e) => updateGlobalStyle(key, "width", parseInt(e.target.value))}
                        className="w-full h-1 bg-slate-850 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>شفافية التعبئة:</span>
                        <span className="font-bold font-mono-tech text-cyan-400">{Math.round(cfg.fillOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={cfg.fillOpacity}
                        onChange={(e) => updateGlobalStyle(key, "fillOpacity", parseFloat(e.target.value))}
                        className="w-full h-1 bg-slate-850 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">شكل الخط:</span>
                      <select
                        value={cfg.dash}
                        onChange={(e) => updateGlobalStyle(key, "dash", e.target.value)}
                        className="bg-slate-950 text-slate-300 border border-slate-850 px-2 py-1 rounded text-xs focus:outline-none"
                      >
                        <option value="solid">خط مستمر ━</option>
                        <option value="dashed">متقطع ╌</option>
                        <option value="dotted">منقط 🞄</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
