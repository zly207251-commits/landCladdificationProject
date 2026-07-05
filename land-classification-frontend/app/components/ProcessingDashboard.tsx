"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { API_CONFIG, PROCESSING_STAGES } from '@/app/lib/map-config';
import TileProgress from './TileProgress';

interface ProcessingDashboardProps {
  jobId?: string;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export default function ProcessingDashboard({ jobId, onComplete, onError }: ProcessingDashboardProps) {
  const router = useRouter();
  const [currentStage, setCurrentStage] = useState<string>('upload');
  const [stages, setStages] = useState<any[]>([]);
  const [processingTime, setProcessingTime] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [estimatedTime, setEstimatedTime] = useState<number>(120);
  
  // حالة سجلات الوكلاء
  const [logs, setLogs] = useState<any[]>([]);
  const [logsSummary, setLogsSummary] = useState<any>(null);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);

  // جلب سجلات الوكلاء من الخادم
  const fetchLogs = async (taskId: string) => {
    setLogsLoading(true);
    try {
      const endpoint = `${API_CONFIG.baseURL}/tasks/${taskId}/logs`;
      const resp = await fetch(endpoint, { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        setLogs(data.logs || []);
        setLogsSummary(data.log_summary);
      }
    } catch (err) {
      console.warn('fetchLogs error', err);
    } finally {
      setLogsLoading(false);
    }
  };

  // جلب السجلات كل 5 ثوانٍ أثناء المعالجة
  useEffect(() => {
    if (!jobId || !isProcessing) return;
    
    fetchLogs(jobId);
    const interval = setInterval(() => fetchLogs(jobId), 5000);
    return () => clearInterval(interval);
  }, [jobId, isProcessing]);

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
    setBackendStatus(null);
    setPollError(null);
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
        const endpoint = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.status.replace('{task_id}', taskId)}`;
        const resp = await fetch(endpoint, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`Status ${resp.status}`);
        const data = await resp.json();
        setBackendStatus(data.status);
        setPollError(null);

        if (data.status === 'COMPLETED') {
          setCurrentStage('gis_generation');
          setProcessingTime(estimatedTime);
          setIsProcessing(false);
          setRetryError(null);
          setRetryMessage(null);
          if (onComplete) onComplete();
          stopped = true;
          return;
        }

        if (data.status === 'FAILED') {
          setCurrentStage('specialist_processing');
          setIsProcessing(false);
          setRetryError(null);
          setRetryMessage('المهمة فشلت على الخادم. يمكنك إعادة المحاولة دون إعادة الرفع.');
          if (onError) onError('المهمة فشلت في الخادم');
          stopped = true;
          return;
        }

        // إيقاف الاستعلام عند عدم وجود المهمة
        if (data.status === 'NOT_FOUND') {
          setPollError('المهمة غير موجودة في قاعدة البيانات.');
          setIsProcessing(false);
          stopped = true;
          return;
        }

        if (data.status === 'PENDING') {
          setCurrentStage('upload');
        } else if (data.status === 'RUNNING') {
          setCurrentStage('agent_classification');
        } else {
          setCurrentStage('specialist_processing');
        }

        setProcessingTime((prev) => Math.min(prev + 3, estimatedTime));
      } catch (err) {
        console.warn('pollStatus error', err);
        setPollError('تعذّر الاتصال بخادم الحالة. حاول التحقق من اتصال الخادم أو إعادة تحميل الصفحة.');
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
          onClick={() => router.refresh()}
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
        
<div className="flex flex-wrap gap-2 items-center">
        {jobId && (
          <div className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
            رقم المهمة: {jobId}
          </div>
        )}
        {backendStatus && (
          <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
            حالة الخادم: {backendStatus}
          </div>
        )}
      </div>
      {pollError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <strong>خطأ حالة المهمة:</strong> {pollError}
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

      {/* تقدم معالجة القطع */}
      {jobId && (
        <TileProgress taskId={jobId} isProcessing={isProcessing} />
      )}

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
          onClick={() => router.refresh()}
          className="py-3 px-6 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition-colors"
        >
          🔄 إعادة تحميل
        </button>
      </div>

      {retryMessage && (
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
          {retryMessage}
        </div>
      )}

      {retryError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {retryError}
        </div>
      )}

      {backendStatus === 'FAILED' && (
        <div className="mt-6 flex flex-col gap-3">
          <button
            disabled={isRetrying}
            onClick={async () => {
              if (!jobId) return;
              setIsRetrying(true);
              setRetryError(null);
              setRetryMessage('جارٍ إعادة محاولة المعالجة...');

              try {
                const resp = await fetch(`${API_CONFIG.baseURL}/tasks/${jobId}/retry`, {
                  method: 'POST'
                });
                if (!resp.ok) {
                  const txt = await resp.text();
                  throw new Error(`فشل إعادة المحاولة: ${resp.status} ${txt}`);
                }

                setRetryMessage('تم إرسال طلب إعادة المحاولة. سيتم متابعة الحالة الآن.');
                setIsProcessing(true);
                setTimeout(() => startProcessing(), 500);
              } catch (err) {
                setRetryError(err instanceof Error ? err.message : 'حدث خطأ أثناء إعادة المحاولة');
                setRetryMessage(null);
              } finally {
                setIsRetrying(false);
              }
            }}
            className="py-3 px-6 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700 transition-all shadow-lg"
          >
            {isRetrying ? '⏳ جاري إعادة المحاولة...' : '🔁 إعادة محاولة المعالجة'}
          </button>
        </div>
      )}

      {/* 📋 سجلات الوكلاء بالتفصيل */}
      {jobId && (
        <div className="mt-6 pt-6 border-t border-gray-200">
          <button
            onClick={() => {
              setShowLogs(!showLogs);
              if (!showLogs) fetchLogs(jobId);
            }}
            className="w-full flex items-center justify-between p-4 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">📋</span>
              <div className="text-right">
                <h3 className="font-semibold text-purple-800">سجلات وكلاء المعالجة</h3>
                <p className="text-sm text-purple-600">
                  {logsSummary?.total_messages || 0} رسالة • آخر: {logsSummary?.last_message?.sender || '-'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {logsLoading && <span className="text-purple-600">جاري التحميل...</span>}
              <span className={`transform transition-transform ${showLogs ? 'rotate-180' : ''}`}>▼</span>
            </div>
          </button>

          {showLogs && (
            <div className="mt-4 p-4 bg-gray-900 rounded-lg max-h-96 overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-gray-400 text-center">لا توجد سجلات بعد</p>
              ) : (
                <div className="space-y-2 font-mono text-sm">
                  {logs.map((log: any, index: number) => (
                    <div
                      key={log.id || index}
                      className={`p-2 rounded border-l-4 ${
                        log.type === 'ERROR' ? 'border-red-500 bg-red-900/30' :
                        log.type === 'WARNING' ? 'border-yellow-500 bg-yellow-900/30' :
                        log.type === 'COMPLETED' ? 'border-green-500 bg-green-900/30' :
                        'border-blue-500 bg-blue-900/30'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="text-gray-400 text-xs">
                          {new Date(log.created_at).toLocaleTimeString('ar-SA')}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          log.type === 'ERROR' ? 'bg-red-600 text-white' :
                          log.type === 'WARNING' ? 'bg-yellow-600 text-white' :
                          log.type === 'COMPLETED' ? 'bg-green-600 text-white' :
                          'bg-blue-600 text-white'
                        }`}>
                          {log.sender}
                        </span>
                      </div>
                      <p className="text-gray-200 mt-1">{log.content}</p>
                      {log.payload && Object.keys(log.payload).length > 0 && (
                        <pre className="text-gray-500 text-xs mt-1 overflow-x-auto">
                          {JSON.stringify(log.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* تذييل */}
      <div className="mt-6 pt-6 border-t border-gray-200">
        <p className="text-sm text-gray-500 text-center">
          ⚡ النظام مصمم حسب مواصفات ملف الورد: نظام فريق وكلاء مع ذاكرة مشتركة وتكامل متعدد
        </p>
      </div>
    </div>
  );
}