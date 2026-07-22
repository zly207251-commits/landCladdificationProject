"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { API_CONFIG } from "@/app/lib/map-config";

export default function HudNavigation() {
  const pathname = usePathname();
  const [serverOnline, setServerOnline] = useState<boolean>(true);

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

  const navLinks = [
    { href: "/", label: "🏠 الرئيسية", activeOnExact: true },
    { href: "/survey", label: "🛰️ استيراد وتحليل جديد", activeOnExact: false },
    { href: "/history", label: "📜 سجل السجلات والمطابقة", activeOnExact: false },
    { href: "/cesium", label: "🛰️ عارض Cesium 3D", activeOnExact: false },
    { href: "/globe", label: "🌐 عارض Globe مستقل", activeOnExact: false },
    { href: "/settings", label: "⚙️ إعدادات النموذج", activeOnExact: false }
  ];

  const isActive = (link: typeof navLinks[0]) => {
    if (link.activeOnExact) {
      return pathname === link.href;
    }
    return pathname.startsWith(link.href);
  };

  return (
    <header className="w-full bg-[#212830]/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-50 px-4 md:px-8 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-4">
      {/* Brand logo */}
      <div className="flex items-center gap-2">
        <span className="text-2xl">🌍</span>
        <div>
          <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-1.5">
            Geo-AI Swarm <span className="text-[10px] px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded font-mono-tech font-normal">V2.0</span>
          </h1>
          <p className="text-[9px] text-slate-400 mt-0.5">منصة هندسة المساحة والتخطيط العمراني</p>
        </div>
      </div>

      {/* Nav Links */}
      <nav className="flex flex-wrap items-center gap-1">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              isActive(link)
                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                : "text-slate-400 hover:text-white hover:bg-slate-900"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Status Indicators */}
      <div className="flex items-center gap-3 text-[10px] font-mono-tech">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950 border border-slate-850">
          <span className={`w-1.5 h-1.5 rounded-full ${serverOnline ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`}></span>
          <span className="text-slate-400">{serverOnline ? "Server: Online" : "Server: Offline"}</span>
        </div>
        <span className="text-slate-600">EPSG:4326</span>
      </div>
    </header>
  );
}
