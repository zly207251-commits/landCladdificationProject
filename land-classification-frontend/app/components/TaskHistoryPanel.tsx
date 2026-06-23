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
      const resp = await fetch(`${API_CONFIG.baseURL}${API_CONFIG.endpoints.tasks}?limit=10`, {
        cache: 'no-store',
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Server ${resp.status}: ${text}`);
      }
      const data = await resp.json();
      setTasks(data.tasks || []);
    } catch (err: any) {
      setError(err?.message || "تعذر جلب قائمة المهام.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const renderStatusBadge = (status: string) => {
    const lower = status.toLowerCase();
    const base = "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold";
    if (lower.includes("completed") || lower.includes("done") || lower.includes("مكتملة")) return `${base} bg-emerald-100 text-emerald-700`;
    if (lower.includes("failed") || lower.includes("error") || lower.includes("فشل")) return `${base} bg-red-100 text-red-700`;
    if (lower.includes("running") || lower.includes("processing") || lower.includes("قيد التنفيذ")) return `${base} bg-amber-100 text-amber-700`;
    return `${base} bg-slate-100 text-slate-700`;
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-lg">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">سجل المهام السابقة</h2>
          <p className="text-sm text-slate-500">اختر مهمة لعرض تفاصيلها بسرعة.</p>
        </div>
        <button
          type="button"
          onClick={fetchTasks}
          className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
        >
          تحديث القائمة
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">جاري تحميل آخر المهام...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-slate-500">لا توجد مهام محفوظة بعد.</p>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <div
              key={task.task_id}
              className="group rounded-3xl border border-slate-200 p-4 transition hover:border-blue-300 hover:shadow-lg"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm text-slate-500">معرف المهمة</p>
                  <h3 className="text-base font-semibold text-slate-900">{task.task_id}</h3>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className={renderStatusBadge(task.status)}>{task.status}</span>
                  <button
                    type="button"
                    onClick={() => router.push(`/results?task_id=${task.task_id}`)}
                    className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    استعراض المهمة
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">التاريخ</p>
                  <p className="mt-2 text-sm text-slate-700">{new Date(task.created_at).toLocaleString('ar-EG')}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">آخر تحديث</p>
                  <p className="mt-2 text-sm text-slate-700">{new Date(task.updated_at).toLocaleString('ar-EG')}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">نوع الصورة</p>
                  <p className="mt-2 text-sm text-slate-700">{task.metadata?.image_type || '-'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
