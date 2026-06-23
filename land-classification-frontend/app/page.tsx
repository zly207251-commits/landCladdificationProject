"use client";

import { useState } from "react";
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import UploadPortal from "./components/UploadPortal";
import ProcessingDashboard from "./components/ProcessingDashboard";

type AppState = 'upload' | 'processing' | 'results';

export default function Home() {
  const [appState, setAppState] = useState<AppState>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const router = useRouter();

  // معالجة اكتمال الرفع
  const handleUploadComplete = (fileInfo: any) => {
    const tid = fileInfo?.task_id || fileInfo?.taskId || fileInfo?.fileId;
    setJobId(tid || null);
    setAppState('processing');
  };

  // معالجة اكتمال المعالجة
  const handleProcessingComplete = () => {
    // بعد اكتمال المعالجة، ننتقل إلى صفحة النتائج مع task_id
    if (jobId) {
      router.push(`/results?task_id=${jobId}`);
    } else {
      setAppState('results');
    }
  };

  const handleBackToHome = () => {
    setJobId(null);
    setAppState('upload');
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 p-4 md:p-8">
      {/* Header */}
      <header className="text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-2">
          🌍 وكيل تصنيف الأراضي الذكي
        </h1>
        <p className="text-gray-600 text-lg">
          نظام ذكاء اصطناعي لتحليل وتصنيف المساحات الجغرافية
        </p>
        <div className="mt-2 flex justify-center gap-4 flex-wrap">
          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
            🤖 نظام فريق الوكلاء
          </span>
            <a href="/cesium" className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">🛰️ Cesium Viewer</a>
          <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
            🔄 Human-in-the-Loop
          </span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-gray-600">ابدأ برفع الصورة الجوية ثم تابع حالة المهمة حتى اكتمال التحليل.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/history" className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
              📜 سجل المهام السابقة
            </Link>
            <Link href="/settings" className="inline-flex items-center rounded-full bg-slate-100 px-4 py-2 text-slate-800 transition hover:bg-slate-200">
              ⚙️ إعدادات SAM
            </Link>
            <button
              onClick={handleBackToHome}
              className="inline-flex items-center rounded-full bg-white px-4 py-2 text-gray-700 shadow-sm transition hover:bg-gray-100"
            >
              🏠 العودة للرئيسية
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mb-8">
        <div className="grid gap-6 lg:grid-cols-[1fr,0.7fr]">
          <div className="rounded-3xl bg-white p-6 shadow-lg">
            <h2 className="text-2xl font-semibold text-slate-900 mb-3">عرض Globe مستقل</h2>
            <p className="text-slate-600 leading-relaxed">
              يمكنك فتح صفحة عرض ثلاثية الأبعاد شبيهة بـ Google Earth باستخدام NASA GIBS وطبقات المعالم.
            </p>
          </div>
          <div className="rounded-3xl bg-white p-6 shadow-lg flex items-center justify-center">
            <a
              href="/globe"
              className="inline-flex items-center justify-center rounded-2xl bg-blue-600 px-6 py-4 text-white text-base font-semibold transition hover:bg-blue-700"
            >
              افتح عارض Globe مستقل
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        {appState === 'upload' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 gap-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-3xl shadow-lg text-center">
                  <div className="w-14 h-14 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">🎯</span>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">تصنيف دقيق</h3>
                  <p className="text-sm text-gray-600">
                    يستخدم النظام أفضل نموذج لتحليل المساحات الجغرافية.
                  </p>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-lg text-center">
                  <div className="w-14 h-14 mx-auto bg-blue-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">⚡</span>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">متابعة مباشرة</h3>
                  <p className="text-sm text-gray-600">
                    راقب حالة المعالجة بعد الرفع واضغط على النتائج عند اكتمال المهمة.
                  </p>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-lg text-center">
                  <div className="w-14 h-14 mx-auto bg-purple-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">📂</span>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">سجل المهام</h3>
                  <p className="text-sm text-gray-600">
                    افتح صفحة السجل لرؤية آخر المهام السابقة بسهولة.
                  </p>
                </div>
              </div>

              <UploadPortal
                onUploadComplete={handleUploadComplete}
                onProcessingStart={() => setAppState('processing')}
              />
            </div>
          </div>
        )}

        {appState === 'processing' && (
          <ProcessingDashboard
            jobId={jobId || undefined}
            onComplete={handleProcessingComplete}
            onError={(error) => alert(error)}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="mt-12 text-center text-gray-500 text-sm">
        <p>🌐 نظام فريق الوكلاء للذكاء الاصطناعي الجغرافي</p>
      </footer>
    </main>
  );
}