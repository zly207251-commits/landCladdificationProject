"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { API_CONFIG } from "@/app/lib/map-config";

interface Task {
  task_id: string;
  status: string;
  created_at: string;
  metadata?: {
    image_type?: string;
  };
}

export default function Home() {
  const [stats, setStats] = useState({
    totalTasks: 0,
    completedTasks: 0,
    estimatedAreaFeddan: 0,
    activeAgents: 5,
    dbStatus: "Online"
  });
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // جلب إحصائيات النظام العامة من السيرفر
  useEffect(() => {
    fetch(`${API_CONFIG.baseURL}/tasks`)
      .then(res => {
        if (!res.ok) throw new Error("Server error");
        return res.json();
      })
      .then(data => {
        const tasks: Task[] = data.tasks || [];
        const completed = tasks.filter(t => t.status === 'COMPLETED').length;
        const estimatedArea = completed * 12.4; // حساب تقديري: فدان لكل مهمة مكتملة

        setStats(prev => ({
          ...prev,
          totalTasks: tasks.length,
          completedTasks: completed,
          estimatedAreaFeddan: Math.round(estimatedArea * 10) / 10,
          dbStatus: "Online"
        }));
        setRecentTasks(tasks.slice(0, 5)); // جلب آخر 5 مهام فقط
      })
      .catch(err => {
        console.error("Error loading stats:", err);
        // التحقق مما إذا كان السيرفر نفسه يعمل
        fetch(API_CONFIG.baseURL, { cache: "no-store" })
          .then(res => {
            if (res.ok) {
              setStats(prev => ({ ...prev, dbStatus: "تعذر الاتصال بقاعدة البيانات" }));
            } else {
              setStats(prev => ({ ...prev, dbStatus: "Offline" }));
            }
          })
          .catch(() => {
            setStats(prev => ({ ...prev, dbStatus: "Offline" }));
          });
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-[#0b0f19] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#0b0f19] to-black p-4 md:p-8 relative">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b1a_1px,transparent_1px),linear-gradient(to_bottom,#1e293b1a_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none"></div>

      {/* Main Dashboard Grid */}
      <div className="max-w-7xl mx-auto relative z-10 space-y-8">
        
        {/* Welcome HUD Header */}
        <section className="border-b border-slate-800 pb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              لوحة التحكم المركزية - Geo-AI Swarm
            </h1>
            <p className="text-xs text-slate-400 mt-1">بوابة المساحة المدنية الذكية لتصنيف الأراضي وتثمين التربة محلياً.</p>
          </div>
        </section>

        {/* Dashboard Counters HUD */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="engineering-glass glass-glow-cyan p-4.5 rounded-2xl flex flex-col">
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider">إجمالي المساحة الممسوحة</span>
            <span className="text-2xl font-bold text-white font-mono-tech mt-1">{stats.estimatedAreaFeddan} <span className="text-xs text-cyan-400 font-normal">فدان</span></span>
          </div>
          <div className="engineering-glass glass-glow-cyan p-4.5 rounded-2xl flex flex-col">
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider">إجمالي المخططات الهندسية</span>
            <span className="text-2xl font-bold text-white font-mono-tech mt-1">{stats.totalTasks} <span className="text-xs text-cyan-400 font-normal">مخطط</span></span>
          </div>
          <div className="engineering-glass glass-glow-cyan p-4.5 rounded-2xl flex flex-col">
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider">وكلاء الذكاء الاصطناعي</span>
            <span className="text-2xl font-bold text-white font-mono-tech mt-1">{stats.activeAgents} <span className="text-xs text-cyan-400 font-normal">نشط</span></span>
          </div>
          <div className="engineering-glass glass-glow-cyan p-4.5 rounded-2xl flex flex-col">
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider">حالة اتصال قاعدة البيانات</span>
            <span className="text-2xl font-bold text-emerald-400 font-mono-tech mt-1">{stats.dbStatus}</span>
          </div>
        </section>

        {/* Giant Glowing Action Launchpad */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link href="/survey" className="engineering-glass glass-glow-cyan hover:scale-[1.01] transition-all p-6 rounded-3xl flex flex-col justify-between h-48 border-l-4 border-l-cyan-400">
            <div>
              <span className="text-3xl">🛰️</span>
              <h3 className="text-white font-bold text-sm mt-3">منصة استيراد وتحليل جديد</h3>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">ارفع الصور الجوية أو ملفات الـ KML وشغّل شبكة وكلاء المعالجة لاستخراج المخططات وتثمين التربة فوراً.</p>
            </div>
            <span className="text-[10px] text-cyan-400 font-mono-tech self-end font-bold">LAUNCH HUB →</span>
          </Link>

          <Link href="/history" className="engineering-glass glass-glow-cyan hover:scale-[1.01] transition-all p-6 rounded-3xl flex flex-col justify-between h-48 border-l-4 border-l-cyan-400">
            <div>
              <span className="text-3xl">📜</span>
              <h3 className="text-white font-bold text-sm mt-3">أرشيف السجلات والمطابقة</h3>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">استعرض مخططات الأراضي المكتملة سابقاً، وقارن مساحات الأوقاف، وتتبع التدقيق وحمل الملفات الهندسية.</p>
            </div>
            <span className="text-[10px] text-cyan-400 font-mono-tech self-end font-bold">OPEN REGISTRY →</span>
          </Link>

          <Link href="/cesium" className="engineering-glass glass-glow-cyan hover:scale-[1.01] transition-all p-6 rounded-3xl flex flex-col justify-between h-48 border-l-4 border-l-cyan-400">
            <div>
              <span className="text-3xl">🌐</span>
              <h3 className="text-white font-bold text-sm mt-3">الـ WebGlobe والقص المباشر</h3>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">تصفح خريطة الأرض التفاعلية، ارسم وحدد مناطقك مساحياً ونزلها فوراً بصيغة AutoCAD DXF أو KML.</p>
            </div>
            <span className="text-[10px] text-cyan-400 font-mono-tech self-end font-bold">OPEN MAPS →</span>
          </Link>
        </section>

        {/* Dashboard Bottom Layout: Info + Recent Activity */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Recent Activity Panel */}
          <div className="lg:col-span-2 engineering-glass p-6 rounded-3xl space-y-4">
            <h3 className="font-bold text-slate-200 text-xs tracking-wider uppercase border-b border-slate-800 pb-2">📋 آخر المهام الجغرافية النشطة</h3>
            
            {loading ? (
              <div className="py-6 text-center text-xs text-slate-500 font-mono-tech">Loading recent activities...</div>
            ) : recentTasks.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">لا توجد سجلات معالجة مسجلة بعد.</div>
            ) : (
              <div className="space-y-3">
                {recentTasks.map((task) => (
                  <div key={task.task_id} className="flex justify-between items-center bg-slate-950/40 border border-slate-850 p-3.5 rounded-xl hover:border-cyan-500/20 transition">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-bold text-slate-300 font-mono-tech select-all">{task.task_id}</span>
                      <span className="text-[9px] text-slate-500 font-mono-tech">{new Date(task.created_at).toLocaleString('ar-EG')}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                        task.status === 'COMPLETED' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/40' :
                        task.status === 'FAILED' ? 'bg-red-950/40 text-red-400 border-red-900/40' :
                        'bg-amber-950/40 text-amber-400 border-amber-900/40 animate-pulse'
                      }`}>{task.status}</span>
                      <Link href={`/results?task_id=${task.task_id}`} className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg text-[10px] text-slate-300 transition">
                        استعراض 🔍
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Swarm Agents System Info */}
          <div className="engineering-glass p-6 rounded-3xl space-y-4">
            <h3 className="font-bold text-slate-200 text-xs tracking-wider uppercase border-b border-slate-800 pb-2">🧠 معمارية وكلاء الأراضي</h3>
            <div className="space-y-3.5 text-[11px] leading-relaxed text-slate-400">
              <div className="flex gap-2">
                <span className="text-cyan-400">❶</span>
                <p><strong>وكيل المنسق:</strong> يتلقى طلبات الرفع ويقسم الصورة الجغرافية الكبيرة إلى قطع (Tiles) متساوية لتبسيط معالجتها متوازياً.</p>
              </div>
              <div className="flex gap-2">
                <span className="text-cyan-400">❷</span>
                <p><strong>وكيل الإسقاط:</strong> يقوم بتحليل صور الـ GeoTIFF ورسم الحدود الجغرافية بدقة وتطبيق النموذج المرجعي CRS للمحافظات.</p>
              </div>
              <div className="flex gap-2">
                <span className="text-cyan-400">❸</span>
                <p><strong>وكيل الأراضي:</strong> يصنف الأراضي المحلية إلى (جِرْبَة، رَفْد، كُرْوَة) ويحدد نوعية التربة وتبعيتها المائية بمفردات مساحية أصيلة.</p>
              </div>
            </div>
          </div>

        </section>
      </div>
    </main>
  );
}