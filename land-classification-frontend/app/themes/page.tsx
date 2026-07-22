"use client";

import { useEffect, useState } from "react";
import HudNavigation from "@/app/components/HudNavigation";

interface ThemeOption {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  bgHex: string;
  cardHex: string;
  accentHex: string;
  textHex: string;
  badge: string;
}

export default function ThemesPage() {
  const [currentTheme, setCurrentTheme] = useState<string>("autocad");
  const [fontSize, setFontSize] = useState<number>(18);
  const [fontWeight, setFontWeight] = useState<number>(600);

  useEffect(() => {
    // استعادة السمة
    const savedTheme = localStorage.getItem("app_theme") || "autocad";
    setCurrentTheme(savedTheme);
    document.documentElement.setAttribute("data-theme", savedTheme);

    // استعادة حجم الخط
    const savedSize = localStorage.getItem("app_font_size");
    if (savedSize) {
      const sizeNum = parseInt(savedSize, 10);
      setFontSize(sizeNum);
      document.documentElement.style.fontSize = `${sizeNum}px`;
    } else {
      document.documentElement.style.fontSize = "18px";
    }

    // استعادة سماكة الخط
    const savedWeight = localStorage.getItem("app_font_weight");
    if (savedWeight) {
      const weightNum = parseInt(savedWeight, 10);
      setFontWeight(weightNum);
      document.body.style.fontWeight = String(weightNum);
    }
  }, []);

  const handleApplyTheme = (themeId: string) => {
    setCurrentTheme(themeId);
    localStorage.setItem("app_theme", themeId);
    document.documentElement.setAttribute("data-theme", themeId);
  };

  const handleApplyFontSize = (sizePx: number) => {
    setFontSize(sizePx);
    localStorage.setItem("app_font_size", String(sizePx));
    document.documentElement.style.fontSize = `${sizePx}px`;
  };

  const handleApplyFontWeight = (weight: number) => {
    setFontWeight(weight);
    localStorage.setItem("app_font_weight", String(weight));
    document.body.style.fontWeight = String(weight);
  };

  const themes: ThemeOption[] = [
    {
      id: "autocad",
      name: "نمط أوتوكاد الكلاسيكي (AutoCAD Slate)",
      subtitle: "النمط المطفأ المانع لإجهاد العين أثناء العمل الطويل",
      description: "يوفر خلفية رمادية مزرقة مطفأة (#212830) بنمط أوتوكاد الكلاسيكي المستقر، مع إبراز النصوص باللون الأبيض وسماكة واضحة لتسهيل القراءة.",
      bgHex: "#212830",
      cardHex: "#2b343f",
      accentHex: "#06b6d4",
      textHex: "#ffffff",
      badge: "النمط الافتراضي"
    },
    {
      id: "obsidian",
      name: "أسود أوبسيديان فائق التباين (Deep Obsidian)",
      subtitle: "أسود داكن مع إضاءة نيون سماوية عالية الوضوح",
      description: "خلفية سوداء داكنة جداً (#090d16) تعزز التباين والعمق، مع كروت كحلية ناعمة وتوهج سماوي ساطع لإبراز العناوين وأرقام الجداول الجغرافية.",
      bgHex: "#090d16",
      cardHex: "#111827",
      accentHex: "#00f2fe",
      textHex: "#ffffff",
      badge: "أقصى تباين"
    },
    {
      id: "charcoal",
      name: "فحمي زمردي هادئ (Charcoal Emerald)",
      subtitle: "مظهر هندسي دافئ مع ألوان الزمرد الطبيعية",
      description: "يمزج بين لون الفحم الدافئ (#121619) ولمسات الزمرد الأخضر الجذاب (#10b981) لمنح الواجهة مظهر خريطة رادار تخصصي وفخم.",
      bgHex: "#121619",
      cardHex: "#1a2126",
      accentHex: "#10b981",
      textHex: "#f8fafc",
      badge: "أنظمة الـ GIS"
    },
    {
      id: "parchment",
      name: "ورقي فاتح عالي التباين (Light Parchment)",
      subtitle: "نمط فاتح ناصع للعمل الميداني والإضاءة الساطعة",
      description: "خلفية فاتحة مريحة للعين (#f1f5f9) مع كروت بيضاء ناصعة ونصوص كحلية داكنة، ممتازة جداً عند الاستخدام تحت أشعة الشمس أو لطباعة التقارير.",
      bgHex: "#f1f5f9",
      cardHex: "#ffffff",
      accentHex: "#0284c7",
      textHex: "#0f172a",
      badge: "للاستخدام الميداني"
    }
  ];

  const fontSizeOptions = [
    { px: 16, label: "قياسي (16px)", note: "الحجم الافتراضي للـ Web" },
    { px: 18, label: "كبير (18px)", note: "موصى به - مريح للعين" },
    { px: 20, label: "كبير جداً (20px)", note: "وضوح مضاعف للشاشات" },
    { px: 22, label: "فائق الكبر (22px)", note: "أقصى تكبير للميدان" }
  ];

  const fontWeightOptions = [
    { weight: 500, label: "متوسط (Medium)" },
    { weight: 600, label: "عريض (Bold)" },
    { weight: 800, label: "بارز جداً (Extra Bold)" }
  ];

  return (
    <div className="min-h-screen transition-colors duration-300 pb-16">
      <HudNavigation />

      <main className="w-[95%] max-w-[1500px] mx-auto pt-8 space-y-8">
        {/* Header */}
        <div className="engineering-glass p-8 rounded-3xl border border-slate-700/50 shadow-2xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-4xl">🎨</span>
                <h1 className="text-2xl font-bold tracking-tight">استوديو التحكم بالسمات وأحجام الخطوط والأيقونات</h1>
              </div>
              <p className="text-sm opacity-80 mt-2 leading-relaxed max-w-3xl">
                يمكنك التبديل بين السمات والتصاميم، وتكبير أحجام الخطوط والأيقونات والسماكة أدناه بمتحكمات تفاعلية حية تمنحك أقصى درجات المقروئية والتحكم.
              </p>
            </div>

            <div className="flex flex-col gap-2 font-mono-tech text-xs bg-black/30 p-4 rounded-2xl border border-white/10 shrink-0">
              <div className="flex items-center justify-between gap-3">
                <span className="opacity-70">السمة النشطة:</span>
                <span className="font-bold text-cyan-400 px-2 py-0.5 bg-cyan-950/60 rounded border border-cyan-800/40">
                  {themes.find((t) => t.id === currentTheme)?.name.split(" ")[0]}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="opacity-70">مقياس الخطوط:</span>
                <span className="font-bold text-emerald-400 px-2 py-0.5 bg-emerald-950/60 rounded border border-emerald-800/40">
                  {fontSize}px (+{Math.round(((fontSize - 16) / 16) * 100)}%)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Font & Icon Size Controls Card */}
        <div className="engineering-glass glass-glow-cyan p-6 md:p-8 rounded-3xl space-y-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <span>🔍</span> التحكم الديناميكي بحجم الخطوط والأيقونات (Font & Icon Size Controller)
              </h2>
              <p className="text-xs opacity-75 mt-1">اختر الحجم والسماكة المناسبة لشاشتك؛ سيتغير حجم الأيقونات والخطوط والجداول فوراً على كافة صفحات الموقع.</p>
            </div>
          </div>

          {/* Size Selector Grid */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider opacity-80 block">اختر حجم النصوص والأيقونات:</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {fontSizeOptions.map((opt) => {
                const isSelected = fontSize === opt.px;
                return (
                  <button
                    key={opt.px}
                    onClick={() => handleApplyFontSize(opt.px)}
                    className={`p-4 rounded-2xl border transition text-right flex flex-col justify-between h-24 ${
                      isSelected
                        ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 ring-2 ring-cyan-400/50 shadow-lg"
                        : "bg-black/20 border-white/10 hover:border-white/30 text-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">{opt.label}</span>
                      {isSelected && <span className="text-xs text-cyan-400 font-bold">✓ نشط</span>}
                    </div>
                    <span className="text-[10px] opacity-70 font-mono-tech">{opt.note}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Font Weight Selector */}
          <div className="space-y-3 pt-2">
            <label className="text-xs font-bold uppercase tracking-wider opacity-80 block">اختر سماكة الخطوط (Font Weight):</label>
            <div className="grid grid-cols-3 gap-4">
              {fontWeightOptions.map((wOpt) => {
                const isWSelected = fontWeight === wOpt.weight;
                return (
                  <button
                    key={wOpt.weight}
                    onClick={() => handleApplyFontWeight(wOpt.weight)}
                    className={`py-3 px-4 rounded-2xl border transition text-center font-bold text-xs ${
                      isWSelected
                        ? "bg-emerald-500/20 border-emerald-400 text-emerald-300 ring-2 ring-emerald-400/40"
                        : "bg-black/20 border-white/10 hover:border-white/30 text-white"
                    }`}
                  >
                    {wOpt.label} {isWSelected && "✓"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Themes Grid */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span>🎭</span> اختر السمة والبنية اللونية (Color Themes)
          </h2>

          <div className="grid gap-6 md:grid-cols-2">
            {themes.map((theme) => {
              const isActive = currentTheme === theme.id;
              return (
                <div
                  key={theme.id}
                  className={`rounded-3xl border p-6 transition-all duration-300 relative flex flex-col justify-between ${
                    isActive
                      ? "ring-2 ring-cyan-400 border-cyan-400/80 shadow-[0_0_25px_rgba(6,182,212,0.25)]"
                      : "border-slate-800 hover:border-slate-600 hover:shadow-xl"
                  }`}
                  style={{ backgroundColor: theme.cardHex, color: theme.textHex }}
                >
                  <div>
                    {/* Top Bar */}
                    <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4 mb-4">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-black/20 border border-white/10">
                          {theme.badge}
                        </span>
                        <h3 className="text-lg font-bold mt-2" style={{ color: theme.textHex }}>
                          {theme.name}
                        </h3>
                        <p className="text-xs opacity-75 mt-0.5">{theme.subtitle}</p>
                      </div>

                      {isActive && (
                        <span className="text-xs font-bold px-3 py-1 bg-cyan-500/20 text-cyan-400 border border-cyan-400/40 rounded-full flex items-center gap-1 shrink-0">
                          ✓ نشطة حالياً
                        </span>
                      )}
                    </div>

                    <p className="text-xs leading-relaxed opacity-85 mb-6">{theme.description}</p>

                    {/* Live Mini Preview Box */}
                    <div
                      className="p-4 rounded-2xl border mb-6 space-y-3 font-mono-tech text-xs"
                      style={{ backgroundColor: theme.bgHex, borderColor: "rgba(255,255,255,0.15)" }}
                    >
                      <div className="text-[10px] opacity-60 font-bold uppercase tracking-wider">معاينة عناصر الواجهة الحية</div>
                      
                      <div className="flex items-center justify-between p-2.5 rounded-xl" style={{ backgroundColor: theme.cardHex }}>
                        <span className="font-bold">معلم مساحي #10398</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: `${theme.accentHex}22`, color: theme.accentHex }}>
                          640.17 م²
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full overflow-hidden bg-black/30">
                          <div className="h-full w-3/4 rounded-full" style={{ backgroundColor: theme.accentHex }}></div>
                        </div>
                        <span className="text-[10px] opacity-75">75%</span>
                      </div>
                    </div>
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={() => handleApplyTheme(theme.id)}
                    disabled={isActive}
                    className={`w-full py-3 px-4 rounded-2xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                      isActive
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-default"
                        : "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/30"
                    }`}
                  >
                    {isActive ? "✓ هذه السمة مطبقة الآن" : "🎨 تطبيق هذه السمة على الموقع بالكامل"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
