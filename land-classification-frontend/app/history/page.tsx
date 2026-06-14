import Link from "next/link";
import TaskHistoryPanel from "../components/TaskHistoryPanel";

export default function HistoryPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">سجل المهام</h1>
              <p className="mt-1 text-sm text-slate-600">
                عرض أحدث المهام المحفوظة في النظام ومتابعة حالة أي مهمة بسرعة.
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
            >
              العودة إلى الصفحة الرئيسية
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6">
        <TaskHistoryPanel />
      </main>
    </div>
  );
}
