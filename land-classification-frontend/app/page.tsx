"use client";

import { useState } from "react";
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import UploadPortal from "./components/UploadPortal";
import ProcessingDashboard from "./components/ProcessingDashboard";
import dynamic from 'next/dynamic';
import { useEffect } from 'react';

// MapViewer is client-only and uses leaflet; load dynamically
const MapViewer = dynamic(() => import('./components/MapViewer'), { ssr: false });

type AppState = 'upload' | 'processing';

export default function Home() {
  const [appState, setAppState] = useState<AppState>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const [mapGeojson, setMapGeojson] = useState<any | undefined>(undefined);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState<number | null>(null);
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

  // جلب أحدث مهمة وعرض مضلعاتها على الخريطة
  useEffect(() => {
    let mounted = true;
    async function loadLatest() {
      try {
        const res = await fetch('/tasks?limit=5');
        if (!res.ok) return;
        const data = await res.json();
        const tasks = data?.tasks || [];
        if (!tasks.length) return;

        // اختر أول مهمة موجودة (الأحدث)
        const latest = tasks[0];
        const tid = latest.task_id;
        if (!tid) return;

        const rep = await fetch(`/tasks/${tid}/report`);
        if (!rep.ok) return;
        const repJson = await rep.json();
        if (!mounted) return;

        if (repJson.geojson) setMapGeojson(repJson.geojson);
        if (repJson.map_center) setMapCenter(repJson.map_center as [number, number]);
        if (repJson.map_zoom) setMapZoom(repJson.map_zoom as number);
      } catch (err) {
        // silent
        console.warn('Failed to load latest task for map', err);
      }
    }
    loadLatest();
    return () => { mounted = false; };
  }, []);

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

      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-gray-600">ابدأ برفع الصورة الجوية ثم تابع حالة المهمة حتى اكتمال التحليل.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/history" className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
              📜 سجل المهام السابقة
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

      {/* خريطة تفاعلية تظهر المعالم الأحدث */}
      <div className="max-w-7xl mx-auto mb-8 h-96">
        <div className="h-full bg-white rounded-3xl shadow-lg p-2">
          <MapViewer
            geojsonData={mapGeojson}
            center={mapCenter}
            zoom={mapZoom}
          />
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