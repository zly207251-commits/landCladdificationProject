"use client";

import { useState, useEffect } from 'react';
import { PROCESSING_STAGES } from '@/app/lib/map-config';

interface ProcessingDashboardProps {
  jobId?: string;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export default function ProcessingDashboard({ jobId, onComplete, onError }: ProcessingDashboardProps) {
  const [currentStage, setCurrentStage] = useState<string>('upload');
  const [stages, setStages] = useState<any[]>([]);
  const [processingTime, setProcessingTime] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [estimatedTime, setEstimatedTime] = useState<number>(120); // 120 ثانية من PDF

  // تهيئة مراحل المعالجة
  useEffect(() => {
    const allStages = Object.values(PROCESSING_STAGES);
    setStages(allStages);
  }, []);

  // محاكاة عملية المعالجة
  const startProcessing = () => {
    if (isProcessing || !jobId) return;

    setIsProcessing(true);
    setProcessingTime(0);
    setCurrentStage('upload');
    pollStatus(jobId);
  };

  // تشغيل المعالجة تلقائياً عندما يصل معرف المهمة
  useEffect(() => {
    if (jobId && !isProcessing) {
      startProcessing();
    }
  }, [jobId]);

  // دالة الاستعلام الدوري عن حالة المهمة في الباكند
  const pollStatus = (taskId: string) => {
    let stopped = false;

    const check = async () => {
      try {
        const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}${PROCESSING_STAGES ? '' : ''}`;
        // بناء رابط الحالة
        const statusEndpoint = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000') +
          (PROCESSING_STAGES ? '' : '');

        const endpoint = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000') +
          `/tasks/${taskId}/status`;

        const resp = await fetch(endpoint);
        if (!resp.ok) throw new Error(`Status ${resp.status}`);
        const data = await resp.json();
        setBackendStatus(data.status);

        if (data.status === 'COMPLETED') {
          setCurrentStage('gis_generation');
          setIsProcessing(false);
          if (onComplete) onComplete();
          stopped = true;
          return;
        }
        if (data.status === 'FAILED') {
          setIsProcessing(false);
          if (onError) onError('المهمة فشلت في الخادم');
          stopped = true;
          return;
        }

        // خريطة تقريبية للمراحل حسب حالة الخادم
        if (data.status === 'PENDING') setCurrentStage('upload');
        else setCurrentStage('agent_classification');

      } catch (err) {
        // لا نكسر الحلقة عند أخطاء مؤقتة، ولكن نبلغ اليوزر إن دامت
        console.warn('pollStatus error', err);
      }

      if (!stopped) {
        setTimeout(check, 3000);
      }
    };

    check();
  };

  // حالة المرحلة
  const getStageStatus = (stageId: string) => {
    const stageIndex = stages.findIndex(s => s.id === stageId);
    const currentIndex = stages.findIndex(s => s.id === currentStage);
    
    if (stageIndex < currentIndex) return 'completed';
    if (stageIndex === currentIndex) return 'in-progress';
    return 'pending';
  };

  // تنسيق الوقت
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // بيانات كل مرحلة
  const getStageDetails = (stageId: string) => {
    const status = getStageStatus(stageId);
    
    const statusConfig: Record<string, any> = {
      'completed': { icon: '✅', color: 'bg-green-100', textColor: 'text-green-700' },
      'in-progress': { icon: '🔄', color: 'bg-blue-100', textColor: 'text-blue-700' },
      'pending': { icon: '⏳', color: 'bg-gray-100', textColor: 'text-gray-500' }
    };

    const config = statusConfig[status] || statusConfig.pending;
    const stage = PROCESSING_STAGES[stageId as keyof typeof PROCESSING_STAGES];

    return { ...config, ...stage };
  };

  if (!jobId) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">لا توجد مهمة حالية</h2>
        <p className="text-gray-600 mb-6">
          لم يتم رفع أي صورة بعد. ارفع صورة لبدء مهمة جديدة ومتابعة حالة المعالجة.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
        >
          العودة إلى الرفع
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">
          لوحة تتبع المعالجة
        </h2>
        
        {jobId && (
          <div className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
            رقم المهمة: {jobId}
          </div>
        )}
      </div>

      {/* شريط التقدم الرئيسي */}
      <div className="mb-8">
        <div className="flex justify-between mb-2">
          <span className="text-gray-600 font-medium">التقدم الكلي</span>
          <span className="text-gray-800 font-semibold">
            {Math.round((processingTime / estimatedTime) * 100)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div
            className="bg-gradient-to-r from-blue-500 to-green-500 h-4 rounded-full transition-all duration-500"
            style={{ 
              width: `${Math.min(100, (processingTime / estimatedTime) * 100)}%` 
            }}
          ></div>
        </div>
        <div className="flex justify-between mt-2 text-sm text-gray-500">
          <span>الوقت المنقضي: {formatTime(processingTime)}</span>
          <span>الوقت المتبقي: {formatTime(Math.max(0, estimatedTime - processingTime))}</span>
        </div>
      </div>

      {/* مراحل المعالجة */}
      <div className="mb-8">
        <h3 className="font-semibold mb-4 text-gray-800 border-b pb-2">
          مراحل المعالجة التفصيلية
        </h3>
        
        <div className="space-y-4">
          {Object.keys(PROCESSING_STAGES).map((stageKey) => {
            const details = getStageDetails(stageKey);
            
            return (
              <div
                key={stageKey}
                className={`p-4 rounded-lg border transition-all ${details.color} ${details.textColor} ${
                  details.status === 'in-progress' ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <span className="text-xl">{details.icon}</span>
                    <div>
                      <h4 className="font-semibold">{details.name}</h4>
                      <p className="text-sm opacity-80">{details.description}</p>
                    </div>
                  </div>
                  
                  {details.status === 'in-progress' && (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500 mr-2"></div>
                      <span className="text-sm font-medium">جاري التنفيذ...</span>
                    </div>
                  )}
                </div>
                
                {/* معلومات إضافية للمرحلة */}
                {details.status === 'in-progress' && (
                  <div className="mt-3 pt-3 border-t border-opacity-50 border-current">
                    <div className="flex justify-between text-sm">
                      <span>الوكلاء النشطين:</span>
                      <span className="font-medium">
                        {stageKey.includes('orchestrator') && 'المنسق'}
                        {stageKey.includes('extractor') && 'المقتطف'}
                        {stageKey.includes('agent') && 'وكيل الأراضي'}
                        {stageKey.includes('reviewer') && 'الناقد'}
                        {stageKey.includes('gis') && 'محرك التصدير'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* معلومات النظام */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* معلومات التقنية */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-semibold mb-2 text-gray-800">📊 معلومات تقنية</h4>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• وقت المعالجة: {estimatedTime} ثانية</li>
            <li>• المراحل النشطة: {stages.filter(s => getStageStatus(s.id) === 'in-progress').length}</li>
            <li>• الوكلاء: {Object.keys(PROCESSING_STAGES).length} وكيل</li>
            <li>• حالة النظام: {isProcessing ? 'نشط' : 'جاهز'}</li>
          </ul>
        </div>

        {/* نظام الوكلاء */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-semibold mb-2 text-blue-800">🤖 نظام فريق الوكلاء</h4>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• <strong>المنسق:</strong> يوزع المهام</li>
            <li>• <strong>المقتطف:</strong> يرسم المعالم</li>
            <li>• <strong>المتخصصون:</strong> يصنفون الأنواع</li>
            <li>• <strong>الناقد:</strong> يكتشف التناقضات</li>
          </ul>
        </div>

        {/* الذاكرة المشتركة */}
        <div className="bg-green-50 p-4 rounded-lg">
          <h4 className="font-semibold mb-2 text-green-800">💾 الذاكرة المشتركة</h4>
          <ul className="text-sm text-green-700 space-y-1">
            <li>• قاعدة بيانات: SQLite/Redis</li>
            <li>• نظام رسائل: Queue/WebSocket</li>
            <li>• حالة المهام: محفوظة</li>
            <li>• قابلية التوسع: Plug-and-Play</li>
          </ul>
        </div>
      </div>

      {/* أزرار التحكم */}
      <div className="flex gap-4">
        {!isProcessing ? (
          <button
            onClick={startProcessing}
            className="flex-1 py-3 px-6 bg-gradient-to-r from-blue-600 to-green-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-green-700 transition-all shadow-lg hover:shadow-xl"
          >
            🚀 بدء المعالجة
          </button>
        ) : (
          <button
            disabled
            className="flex-1 py-3 px-6 bg-gray-400 text-white rounded-xl font-semibold cursor-not-allowed"
          >
            🔄 جاري المعالجة...
          </button>
        )}
        
        <button
          onClick={() => window.location.reload()}
          className="py-3 px-6 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
        >
          🔄 إعادة تحميل
        </button>
      </div>

      {/* تذييل */}
      <div className="mt-6 pt-6 border-t border-gray-200">
        <p className="text-sm text-gray-500 text-center">
          ⚡ النظام مصمم حسب مواصفات ملف الورد: نظام فريق وكلاء مع ذاكرة مشتركة وتكامل متعدد
        </p>
      </div>
    </div>
  );
}