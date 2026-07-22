"use client";

import { useEffect, useState } from "react";
import { useRouter } from 'next/navigation';
import { API_CONFIG } from "@/app/lib/map-config";

interface TaskSummary {
  task_id: string;
  status: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export default function TaskHistoryPanel() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_CONFIG.baseURL}${API_CONFIG.endpoints.tasks}?limit=50`, {
        cache: 'no-store',
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Server ${resp.status}: ${text}`);
      }
      const data = await resp.json();
      setTasks(data.tasks || []);
    } catch (err: any) {
      setError(err?.message || "تعذر جلب قائمة المهام الجغرافية.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("هل أنت متأكد من رغبتك في مسح كافة البيانات والصور المساحية لهذه المهمة نهائياً من الخادم؟")) return;
    
    try {
      const resp = await fetch(`${API_CONFIG.baseURL}/tasks/${taskId}`, {
        method: 'DELETE'
      });
      if (!resp.ok) {
        throw new Error("فشل حذف السجلات من الخادم");
      }
      setTasks(prev => prev.filter(t => t.task_id !== taskId));
    } catch (err: any) {
      alert("خطأ أثناء المسح: " + err.message);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const renderStatusBadge = (status: string) => {
    const lower = status.toLowerCase();
    const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold border";
    if (lower.includes("completed") || lower.includes("done") || lower.includes("مكتملة")) {
      return `${base} bg-emerald-950/40 text-emerald-400 border-emerald-800/40`;
    }
    if (lower.includes("failed") || lower.includes("error") || lower.includes("فشل")) {
      return `${base} bg-red-950/40 text-red-400 border-red-800/40`;
    }
    if (lower.includes("running") || lower.includes("processing") || lower.includes("قيد التنفيذ")) {
      return `${base} bg-amber-950/40 text-amber-400 border-amber-800/40 animate-pulse`;
    }
    return `${base} bg-slate-950/40 text-slate-400 border-slate-800`;
  };

  return (
    <div className="engineering-glass glass-glow-cyan p-6 rounded-3xl relative">
      <div className="flex items-center justify-between gap-3 mb-6 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>📜</span> أرشيف السجلات المساحية
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">سجل كامل بمهام تحليل الأراضي المنفذة قديماً من قبل الوكلاء.</p>
        </div>
        <button
          type="button"
          onClick={fetchTasks}
          className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/40 text-slate-300 hover:text-white transition text-xs font-semibold"
        >
          تحديث الأرشيف
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400 font-mono-tech">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400 mx-auto mb-3"></div>
          Loading tasks from database...
        </div>
      ) : error ? (
        <div className="p-4 bg-red-950/20 border border-red-800/30 text-red-400 text-xs rounded-2xl">{error}</div>
      ) : tasks.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-slate-800 rounded-2xl text-xs text-slate-500">
          لا توجد مهام محفوظة حالياً. ابدأ برفع مخطط مساحي جديد.
        </div>
      ) : (
        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
          {tasks.map((task) => (
            <div
              key={task.task_id}
              className="group rounded-2xl bg-slate-950/30 border border-slate-850 p-4 transition hover:border-cyan-500/30 hover:shadow-lg relative"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <span className="text-[10px] text-slate-500 font-mono-tech">TASK_ID</span>
                  <h3 className="text-xs font-bold text-slate-200 font-mono-tech select-all">{task.task_id}</h3>
                </div>
                
                <div className="flex flex-wrap gap-2 items-center">
                  <span className={renderStatusBadge(task.status)}>{task.status}</span>
                  
                  <button
                    type="button"
                    onClick={() => router.push(`/results?task_id=${task.task_id}`)}
                    className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold transition"
                  >
                    استعراض المخطط الجغرافي
                  </button>
                  
                  <button
                    type="button"
                    onClick={(e) => handleDeleteTask(task.task_id, e)}
                    className="p-1.5 bg-red-950/30 hover:bg-red-900/60 text-red-400 border border-red-900/20 rounded-xl transition text-xs flex items-center justify-center"
                    title="مسح السجلات نهائياً"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              
              <div className="mt-4 grid gap-3 grid-cols-3 text-xs">
                <div className="rounded-xl bg-slate-950/50 p-2.5 border border-slate-900">
                  <p className="text-[10px] text-slate-500 font-semibold">تاريخ الإنشاء</p>
                  <p className="mt-1 text-slate-300 font-mono-tech">{new Date(task.created_at).toLocaleDateString('ar-EG')}</p>
                </div>
                <div className="rounded-xl bg-slate-950/50 p-2.5 border border-slate-900">
                  <p className="text-[10px] text-slate-500 font-semibold">توقيت المعالجة</p>
                  <p className="mt-1 text-slate-300 font-mono-tech">{new Date(task.created_at).toLocaleTimeString('ar-EG')}</p>
                </div>
                <div className="rounded-xl bg-slate-950/50 p-2.5 border border-slate-900">
                  <p className="text-[10px] text-slate-500 font-semibold">تصنيف التحليل</p>
                  <p className="mt-1 text-slate-300">{task.metadata?.image_type === 'kml' ? 'مسار KML' : task.metadata?.image_type === 'geospatial' ? 'GeoTIFF' : 'أبعاد مترية'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
