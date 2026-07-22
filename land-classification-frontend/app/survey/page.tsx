"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { API_CONFIG } from "@/app/lib/map-config";
import UploadPortal from "../components/UploadPortal";
import ProcessingDashboard from "../components/ProcessingDashboard";

type AppState = 'upload' | 'processing';
const STORAGE_KEY = 'land_classification_job_id';

export default function SurveyPage() {
  const [appState, setAppState] = useState<AppState>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const router = useRouter();

  // استعادة jobId إن وجد في المتصفح لمتابعة تقدم المهمة
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const storedJobId = window.localStorage.getItem(STORAGE_KEY);
    if (storedJobId) {
      const statusEndpoint = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.status.replace('{task_id}', storedJobId)}`;
      fetch(statusEndpoint)
        .then(res => res.json())
        .then(data => {
          if (data.status && data.status !== 'NOT_FOUND') {
            setJobId(storedJobId);
            setAppState('processing');
          } else {
            window.localStorage.removeItem(STORAGE_KEY);
          }
        })
        .catch(() => {
          window.localStorage.removeItem(STORAGE_KEY);
        })
        .finally(() => {
          setIsRestoring(false);
        });
    } else {
      setIsRestoring(false);
    }
  }, []);

  const handleUploadComplete = (fileInfo: any) => {
    const tid = fileInfo?.task_id || fileInfo?.taskId || fileInfo?.fileId;
    if (tid) {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, tid);
      }
      setJobId(tid);
      setAppState('processing');
    }
  };

  const handleProcessingComplete = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    if (jobId) {
      router.push(`/results?task_id=${jobId}`);
    } else {
      router.push('/');
    }
  };

  if (isRestoring) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="engineering-glass glass-glow-cyan p-8 rounded-3xl text-center max-w-sm w-full">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-400 mx-auto mb-4"></div>
          <p className="text-cyan-400 font-medium">جاري التحقق من مهمة التحليل النشطة...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f19] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#0b0f19] to-black p-4 md:p-8 relative">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b1a_1px,transparent_1px),linear-gradient(to_bottom,#1e293b1a_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none"></div>

      <div className="max-w-4xl mx-auto relative z-10 space-y-6">
        {/* Title HUD Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <span>🛰️</span> بوابة الرفع والمعالجة المساحية
            </h1>
            <p className="text-xs text-slate-400 mt-1">ابدأ برفع الصورة الجوية أو ملف الـ KML للبدء في تقسيم وتصنيف الأراضي والمباني.</p>
          </div>
        </div>

        {appState === 'upload' ? (
          <UploadPortal
            onUploadComplete={handleUploadComplete}
            onProcessingStart={() => setAppState('processing')}
          />
        ) : (
          <ProcessingDashboard
            jobId={jobId || undefined}
            onComplete={handleProcessingComplete}
            onError={(error) => alert(error)}
          />
        )}
      </div>
    </div>
  );
}
