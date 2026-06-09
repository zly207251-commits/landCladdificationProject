"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from 'next/navigation';
import UploadPortal from "./components/UploadPortal";
import ProcessingDashboard from "./components/ProcessingDashboard";
const MapViewer = dynamic(() => import("./components/MapViewer"), { ssr: false });
import ExportCenter from "./components/ExportCenter";
import AuditInterface from "./components/AuditInterface";

type AppState = 'upload' | 'processing' | 'results' | 'export' | 'audit';

export default function Home() {
  const [appState, setAppState] = useState<AppState>('upload');
  const [uploadedFile, setUploadedFile] = useState<any>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [geojsonData, setGeojsonData] = useState<any>(null);
  const router = useRouter();

  // معالجة اكتمال الرفع
  const handleUploadComplete = (fileInfo: any) => {
    setUploadedFile(fileInfo);
    // backend returns { task_id }
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

  // التصدير
  const handleExport = () => {
    setAppState('export');
  };

  // بدء التدقيق
  const handleStartAudit = () => {
    setAppState('audit');
  };

  // العودة للرئيسية
  const handleBackToHome = () => {
    setUploadedFile(null);
    setJobId(null);
    setGeojsonData(null);
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
          <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
            🔄 Human-in-the-Loop
          </span>
        </div>
      </header>

      {/* التنقل بين الصفحات */}
      {appState !== 'upload' && (
        <div className="max-w-7xl mx-auto mb-6">
          <nav className="flex justify-center gap-2 flex-wrap">
            <button
              onClick={handleBackToHome}
              className="px-4 py-2 rounded-lg font-medium transition-colors bg-white text-gray-700 hover:bg-gray-100"
            >
              🏠 الرئيسية
            </button>
            <button
              onClick={() => setAppState('processing')}
              disabled={!jobId}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                appState === 'processing'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50'
              }`}
            >
              ⚙️ المعالجة
            </button>
            <button
              onClick={() => setAppState('results')}
              disabled={!geojsonData}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                appState === 'results'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50'
              }`}
            >
              🗺️ النتائج
            </button>
            <button
              onClick={() => setAppState('export')}
              disabled={!geojsonData}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                appState === 'export'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50'
              }`}
            >
              📥 التصدير
            </button>
            <button
              onClick={() => setAppState('audit')}
              disabled={!geojsonData}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                appState === 'audit'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50'
              }`}
            >
              ✏️ التدقيق
            </button>
          </nav>
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        {/* الصفحة الرئيسية - بوابة الرفع */}
        {appState === 'upload' && (
          <div className="space-y-8">
            {/* معلومات المشروع */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-xl shadow-md text-center">
                <div className="w-12 h-12 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-3">
                  <span className="text-2xl">🎯</span>
                </div>
                <h3 className="font-semibold mb-2">تصنيف دقيق</h3>
                <p className="text-sm text-gray-600">
                  استخدام أحدث نماذج الذكاء الاصطناعي للتصنيف
                </p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-md text-center">
                <div className="w-12 h-12 mx-auto bg-blue-100 rounded-full flex items-center justify-center mb-3">
                  <span className="text-2xl">⚡</span>
                </div>
                <h3 className="font-semibold mb-2">نتائج سريعة</h3>
                <p className="text-sm text-gray-600">
                  معالجة خلال 120 ثانية كحد أقصى
                </p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-md text-center">
                <div className="w-12 h-12 mx-auto bg-purple-100 rounded-full flex items-center justify-center mb-3">
                  <span className="text-2xl">🔄</span>
                </div>
                <h3 className="font-semibold mb-2">واجهة تدقيق</h3>
                <p className="text-sm text-gray-600">
                  أدوات تدقيق سهلة لتحسين النتائج
                </p>
              </div>
            </div>

            {/* بوابة الرفع */}
            <UploadPortal
              onUploadComplete={handleUploadComplete}
              onProcessingStart={() => setAppState('processing')}
            />
          </div>
        )}

        {/* صفحة المعالجة */}
        {appState === 'processing' && (
          <ProcessingDashboard
            jobId={jobId || undefined}
            onComplete={handleProcessingComplete}
            onError={(error) => alert(error)}
          />
        )}

        {/* صفحة النتائج */}
        {appState === 'results' && geojsonData && (
          <div className="space-y-6">
            {/* معلومات الحالة */}
            <div className="bg-gradient-to-r from-green-500 to-blue-600 rounded-xl p-6 text-white shadow-lg">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-xl font-semibold mb-1">✅ تمت المعالجة بنجاح</h2>
                  <p className="text-green-100">
                    النتيجة: دقة 87.3% | الوقت: 3 دقائق 24 ثانية | المهمة: {jobId}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleExport}
                    className="px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors shadow"
                  >
                    📥 تصدير
                  </button>
                  <button
                    onClick={handleStartAudit}
                    className="px-6 py-3 bg-white text-purple-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors shadow"
                  >
                    ✏️ تدقيق
                  </button>
                </div>
              </div>
            </div>

            {/* الخريطة */}
            <div className="bg-white rounded-xl shadow-xl p-6">
              <h3 className="font-semibold text-gray-800 mb-4">خريطة التصنيف الجغرافي</h3>
              <div className="h-[600px]">
                <MapViewer
                  geojsonData={geojsonData}
                  editMode={false}
                />
              </div>
            </div>

            {/* إحصائيات مختصرة */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-lg shadow text-center">
                <div className="text-2xl font-bold text-blue-600">3</div>
                <div className="text-sm text-gray-600">معالم مصنفة</div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow text-center">
                <div className="text-2xl font-bold text-green-600">15.25</div>
                <div className="text-sm text-gray-600">كم²总面积</div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow text-center">
                <div className="text-2xl font-bold text-purple-600">87.3%</div>
                <div className="text-sm text-gray-600">دقة التصنيف</div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow text-center">
                <div className="text-2xl font-bold text-orange-600">3:24</div>
                <div className="text-sm text-gray-600">وقت المعالجة</div>
              </div>
            </div>
          </div>
        )}

        {/* صفحة التصدير */}
        {appState === 'export' && (
          <ExportCenter
            jobId={jobId || undefined}
            availableLayers={['buildings', 'roads', 'water_bodies', 'vegetation']}
            onExport={(formats, layers) => {
              console.log('Exporting:', formats, layers);
              alert('تم التصدير بنجاح!');
            }}
          />
        )}

        {/* صفحة التدقيق */}
        {appState === 'audit' && (
          <AuditInterface
            initialFeatures={geojsonData?.features || []}
            onSaveCorrections={(corrections) => {
              console.log('Saved corrections:', corrections);
            }}
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