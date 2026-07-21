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
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900">إعدادات SAM</h1>
            <p className="mt-2 text-sm text-slate-500">تحكم في معايير SAM لتقليل نتائج التجزئة الزائدة أو الضوضاء.</p>
          </div>
          <nav className="space-y-3">
            <Link href="/" className="block rounded-2xl bg-blue-600 px-4 py-3 text-white hover:bg-blue-700 transition">
              الصفحة الرئيسية
            </Link>
            <Link href="/history" className="block rounded-2xl bg-slate-100 px-4 py-3 text-slate-900 hover:bg-slate-200 transition">
              سجل المهام
            </Link>
            <Link href="/globe" className="block rounded-2xl bg-slate-100 px-4 py-3 text-slate-900 hover:bg-slate-200 transition">
              عارض Globe
            </Link>
          </nav>
        </aside>

        <section className="space-y-6">
          <div className="rounded-3xl bg-white p-6 shadow-lg border border-slate-200">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">تكوين معلمات SAM</h2>
                <p className="mt-2 text-slate-600">هذا الإعداد يؤثر على كيفية استخراج نموذج SAM للأقنعة الهندسية من الصورة.</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700 text-sm font-medium">
                {saved ? 'تم حفظ الإعدادات محلياً' : 'التغييرات تُحفظ تلقائياً'}
              </div>
            </div>

            <div className="mt-8 grid gap-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">تمكين التراجع في SAM</span>
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => update("samUseFallback", !settings.samUseFallback)}
                      className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition ${settings.samUseFallback ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                    >
                      {settings.samUseFallback ? 'مفعّل' : 'معطّل'}
                    </button>
                    <span className="text-sm text-slate-500">إذا كانت نتائج SAM قليلة، سيستخدم النظام التراجع.</span>
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">أدنى مساحة لقناع SAM (بكسل)</span>
                  <input
                    type="number"
                    min="10"
                    step="10"
                    value={settings.samMinMaskRegionArea}
                    onChange={(e) => update("samMinMaskRegionArea", e.target.value)}
                    className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    زيادة هذه القيمة تجعل SAM يتجاهل الأقنعة الصغيرة جداً، مما يقلل الضوضاء. خفضها يبقي المزيد من المناطق الصغيرة، لكنه قد يزيد من التجزئة.
                  </p>
                </label>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">نقاط SAM لكل جانب</span>
                  <input
                    type="number"
                    min="4"
                    step="1"
                    value={settings.samPointsPerSide}
                    onChange={(e) => update("samPointsPerSide", e.target.value)}
                    className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    زيادة العدد تنتج نقاطاً أكثر وأقنعة أدق، لكنها قد تزيد زمن المعالجة. خفض العدد يجعل الحساب أسرع وأقنعة أقل تفصيلاً.
                  </p>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">عتبة IoU</span>
                  <input
                    type="number"
                    min="0.1"
                    max="1"
                    step="0.01"
                    value={settings.samPredIoUThresh}
                    onChange={(e) => update("samPredIoUThresh", e.target.value)}
                    className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    رفع العتبة يجعل SAM أكثر تشدداً في دمج الأقنعة، فيقلل التداخل والنتائج المتكررة. خفضها يجعل النموذج أقل صرامة ويولد المزيد من الأقنعة المحتملة.
                  </p>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">ثبات القناع</span>
                  <input
                    type="number"
                    min="0.0"
                    max="1"
                    step="0.01"
                    value={settings.samStabilityScoreThresh}
                    onChange={(e) => update("samStabilityScoreThresh", e.target.value)}
                    className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    رفع هذا العدد يجعل النظام يحتفظ فقط بالأقنعة الأكثر ثباتاً، مما يقلل الضوضاء. خفضه يسمح بمزيد من الأقنعة الأقل ثباتاً وقد يزيد التغطية.
                  </p>
                </label>
              </div>

              <div className="rounded-3xl bg-slate-50 p-6 border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900">ملاحظات مهمة</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-600 list-disc list-inside">
                  <li>كل تغيير يُحفظ تلقائياً في المتصفح.</li>
                  <li>يُستخدم هذا التكوين عند رفع صورة جديدة عبر بوابة الرفع.</li>
                  <li>خفض القيم يقلل من عدد الأقنعة الصغيرة الزائدة.</li>
                  <li>رفع القيم يزيد من دقة التقسيم لكنه قد يؤدي إلى نتائج أكبر.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-lg border border-slate-200 mt-6">
            <h2 className="text-2xl font-semibold text-slate-900">🎨 المظهر وتنسيق الخرائط الافتراضي</h2>
            <p className="mt-2 text-slate-600">حدد ألوان، سماكة، وأشكال الخطوط الافتراضية للمعالم المستخرجة (مباني، طرق، أراضي، إلخ).</p>
            
            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
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
                  <div key={key} className="bg-slate-50 p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="font-semibold text-slate-800 border-b pb-2 mb-2">{item.label}</div>
                    
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600">اللون الافتراضي:</span>
                      <input
                        type="color"
                        value={cfg.color}
                        onChange={(e) => updateGlobalStyle(key, "color", e.target.value)}
                        className="w-10 h-8 rounded border cursor-pointer p-0"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>سماكة الخط:</span>
                        <span className="font-bold">{cfg.width}px</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={cfg.width}
                        onChange={(e) => updateGlobalStyle(key, "width", parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>شفافية التعبئة:</span>
                        <span className="font-bold">{Math.round(cfg.fillOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={cfg.fillOpacity}
                        onChange={(e) => updateGlobalStyle(key, "fillOpacity", parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600">شكل الخط:</span>
                      <select
                        value={cfg.dash}
                        onChange={(e) => updateGlobalStyle(key, "dash", e.target.value)}
                        className="bg-white text-slate-700 px-2 py-1 rounded border text-sm focus:outline-none focus:border-blue-500"
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
