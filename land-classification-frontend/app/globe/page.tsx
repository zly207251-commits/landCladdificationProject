import Link from "next/link";
import GlobeViewerShell from "./GlobeViewerShell";
import { Suspense } from "react";

export default function GlobePage() {
  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="rounded-3xl bg-white p-6 shadow-lg">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">عارض Globe 3D</h1>
              <p className="mt-2 text-slate-600">عرض شبيه بـ Google Earth باستخدام NASA GIBS مع دعم طبقات المعالم.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/" className="rounded-full bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
                العودة للرئيسية
              </Link>
              <Link href="/history" className="rounded-full bg-slate-100 px-4 py-2 text-slate-900 transition hover:bg-slate-200">
                سجل المهام
              </Link>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6">
          <div className="rounded-3xl bg-white p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-slate-900 mb-3">طبقة المعالم من المهمة</h2>
            <p className="text-slate-600">إذا تم تحديد معرف مهمة في رابط الـ URL، سيتم تحميل طبقة المعالم الخاصة بها فوق خريطة NASA GIBS.</p>
            <p className="mt-3 text-sm text-slate-500">مثال: <code className="rounded bg-slate-100 px-2 py-1">/globe?task_id=task_1234abcd</code></p>
          </div>

          <div className="rounded-3xl bg-white p-0 shadow-lg overflow-hidden">
            <Suspense fallback={<div className="p-6">جارٍ تحميل العارض ثلاثي الأبعاد…</div>}>
              <GlobeViewerShell />
            </Suspense>
          </div>
        </section>
      </div>
    </main>
  );
}
