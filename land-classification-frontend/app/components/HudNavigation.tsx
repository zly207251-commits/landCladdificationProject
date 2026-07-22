"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { API_CONFIG } from "@/app/lib/map-config";

export default function HudNavigation() {
  const pathname = usePathname();
  const [serverOnline, setServerOnline] = useState<boolean>(true);
  const [isLightMode, setIsLightMode] = useState<boolean>(true);

  // التحقق من حالة الخادم دورياً
  useEffect(() => {
    const checkServer = async () => {
      try {
        const resp = await fetch(API_CONFIG.baseURL, { method: "GET", cache: "no-store" });
        setServerOnline(resp.ok);
      } catch {
        setServerOnline(false);
      }
    };
    
    checkServer();
    const interval = setInterval(checkServer, 10000);
    return () => clearInterval(interval);
  }, []);

  // استعادة السمة وحجم الخط والسماكة المحفوظة عند تحميل أي صفحة
  useEffect(() => {
    const savedTheme = localStorage.getItem("app_theme") || "parchment";
    document.documentElement.setAttribute("data-theme", savedTheme);
    setIsLightMode(savedTheme === "parchment");

    const savedFontSize = localStorage.getItem("app_font_size");
    if (savedFontSize) {
      document.documentElement.style.fontSize = `${savedFontSize}px`;
    }

    const savedFontWeight = localStorage.getItem("app_font_weight");
    if (savedFontWeight) {
      document.body.style.fontWeight = savedFontWeight;
    }
  }, []);

  const navLinks = [
    { href: "/", icon: "🏠", label: "الرئيسية", activeOnExact: true },
    { href: "/survey", icon: "🛰️", label: "استيراد وتحليل جديد", activeOnExact: false },
    { href: "/history", icon: "📜", label: "سجل المطابقة", activeOnExact: false },
    { href: "/globe", icon: "🌐", label: "عارض Globe 3D", activeOnExact: false },
    { href: "/themes", icon: "🎨", label: "استوديو السمات", activeOnExact: false },
    { href: "/settings", icon: "⚙️", label: "الإعدادات", activeOnExact: false }
  ];

  const isActive = (link: typeof navLinks[0]) => {
    if (link.activeOnExact) {
      return pathname === link.href;
    }
    return pathname.startsWith(link.href);
  };

  const toggleTheme = () => {
    const newTheme = isLightMode ? "autocad" : "parchment";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("app_theme", newTheme);
    setIsLightMode(!isLightMode);
  };

  return (
    <header className="w-full bg-[#212830]/90 backdrop-blur-md border-b border-slate-800 sticky top-0 z-50 px-4 md:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
      {/* Brand logo */}
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-3xl">🌍</span>
        <div>
          <h1 className="text-base md:text-lg font-bold text-white tracking-tight flex items-center gap-2">
            Geo-AI Swarm <span className="text-xs px-2 py-0.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded font-mono-tech font-bold">V2.0</span>
          </h1>
          <p className="text-[11px] text-slate-300 font-medium hidden sm:block">منصة هندسة المساحة والتخطيط العمراني</p>
        </div>
      </div>

      {/* Responsive Nav Links with Icons + Tooltips */}
      <nav className="flex flex-wrap items-center gap-1.5 overflow-x-auto py-1">
        {navLinks.map((link) => {
          const active = isActive(link);
          return (
            <Link
              key={link.href}
              href={link.href}
              title={`${link.icon} ${link.label}`}
              className={`px-3 py-2 rounded-xl text-xs md:text-sm font-bold transition flex items-center gap-2 group relative shrink-0 ${
                active
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-md ring-1 ring-cyan-400/20"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/90 border border-transparent"
              }`}
            >
              <span className="text-lg md:text-xl group-hover:scale-110 transition-transform">{link.icon}</span>
              <span className="hidden md:inline whitespace-nowrap">{link.label}</span>
              
              {/* Custom CSS Hover Tooltip for icon mode */}
              <span className="absolute bottom-[-34px] left-1/2 -translate-x-1/2 px-2.5 py-1 bg-black/90 text-cyan-300 text-[10px] rounded-lg border border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-xl hidden sm:block">
                {link.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Status Indicators and Theme Toggle */}
      <div className="flex items-center gap-3 text-xs font-mono-tech font-bold shrink-0">
        <button 
          onClick={toggleTheme}
          className="p-2 rounded-full bg-slate-950/50 border border-slate-700/50 hover:bg-slate-800 transition-colors"
          title={isLightMode ? "الوضع الداكن" : "الوضع الفاتح"}
        >
          {isLightMode ? "🌙" : "☀️"}
        </button>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-950 border border-slate-800">
          <span className={`w-2 h-2 rounded-full ${serverOnline ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`}></span>
          <span className="text-slate-300">{serverOnline ? "Online" : "Offline"}</span>
        </div>
        <span className="text-slate-400 hidden xl:inline">EPSG:4326</span>
      </div>
    </header>
  );
}
