"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { API_CONFIG } from "@/app/lib/map-config";

export default function ResultsImagesShell() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const taskId = searchParams.get("task_id");
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) {
      setError("لم يتم تمرير معرف المهمة.");
      setLoading(false);
      return;
    }
    fetchReport();
  }, [taskId]);

  const fetchReport = async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_CONFIG.baseURL}${API_CONFIG.endpoints.report.replace('{task_id}', taskId)}`, {
        cache: "no-store",
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`فشل في جلب تقرير المهمة: ${resp.status} ${text}`);
      }
      setReport(await resp.json());
    } catch (err: any) {
      setError(err?.message || "حدث خطأ أثناء تحميل التقرير.");
    } finally {
      setLoading(false);
    }
  };

  const imageSrc = report?.image_url ? `${API_CONFIG.baseURL}${report.image_url}` : null;
  const processedImageSrc = report?.processed_image_url ? `${API_CONFIG.baseURL}${report.processed_image_url}` : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">صور المهمة</h1>
            <p className="mt-1 text-sm text-slate-600">عرض الصورة الأصلية والصورة النهائية المعدلة لمهمة التحليل.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex items-center rounded-full bg-white px-4 py-2 text-slate-700 border border-slate-200 hover:bg-slate-50"
            >
              العودة لصفحة النتائج
            </button>
            <button
              type="button"
              onClick={fetchReport}
              className="inline-flex items-center rounded-full bg-slate-100 px-4 py-2 text-slate-700 border border-slate-200 hover:bg-slate-200"
            >
              تحديث التقرير
            </button>
            <Link
              href="/"
              className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              العودة للرئيسية
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6">
        {loading && <p className="text-sm text-slate-600">جارٍ تحميل تفاصيل الصور...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!loading && !error && !taskId && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-700">
            لم يتم تحديد معرف المهمة في الرابط.
          </div>
        )}

        {!loading && !error && taskId && (
          <div className="space-y-8">
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="bg-white rounded-3xl shadow p-6">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">الصورة الأصلية</h2>
                    <p className="text-sm text-slate-500">الصورة المرفوعة قبل التعديل.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{imageSrc ? 'متاحة' : 'غير متاحة'}</span>
                </div>
                {imageSrc ? (
                  <img src={imageSrc} alt="الصورة الأصلية" className="w-full rounded-3xl border border-slate-200 object-contain" />
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
                    لا توجد صورة أصلية متاحة.
                  </div>
                )}
              </div>

              <div className="bg-white rounded-3xl shadow p-6">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">الصورة النهائية بعد التعديل</h2>
                    <p className="text-sm text-slate-500">الصورة الناتجة بعد إشارات الوكلاء والمعالجة.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{processedImageSrc ? 'متاحة' : 'غير متاحة'}</span>
                </div>
                {processedImageSrc ? (
                  <img src={processedImageSrc} alt="الصورة النهائية" className="w-full rounded-3xl border border-slate-200 object-contain" />
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
                    لم يتم إنشاء صورة نهائية بعد أو ليس لديها مسار محفوظ.
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-3">معلومات المهمة</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.15em] text-slate-500">معرف المهمة</p>
                  <p className="mt-2 text-sm text-slate-700">{taskId}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.15em] text-slate-500">الحالة</p>
                  <p className="mt-2 text-sm text-slate-700">{report?.status ?? '-'}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
