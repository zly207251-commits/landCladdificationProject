import { Suspense } from "react";
import Link from "next/link";
import ResultsClient from "./ResultsClient";

interface ResultsPageProps {
  searchParams: Promise<{
    task_id?: string | string[];
  }>;
}

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  const resolvedSearchParams = await searchParams;
  const rawTaskId = resolvedSearchParams?.task_id;
  const taskId = Array.isArray(rawTaskId) ? rawTaskId[0] : rawTaskId;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-800">نتيجة المهمة</h1>
            <Link href="/" className="px-4 py-2 bg-gray-600 text-white rounded-lg">
              الصفحة الرئيسية
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {taskId ? (
          <Suspense fallback={<p className="text-sm text-gray-600">جاري تحميل نتائج المهمة...</p>}>
            <ResultsClient taskId={taskId} />
          </Suspense>
        ) : (
          <p>لم يتم تمرير معرف المهمة (task_id) في الرابط. الرجاء العودة من صفحة الرفع.</p>
        )}
      </main>
    </div>
  );
}
