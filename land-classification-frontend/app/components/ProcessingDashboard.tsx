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
      <div className="engineering-glass glass-glow-cyan p-8 text-center rounded-3xl">
        <h2 className="text-lg font-bold text-white mb-3">لا توجد مهمة مساحية نشطة حالياً</h2>
        <p className="text-xs text-slate-400 mb-6">
          لم يتم تحديد أو رفع أي مخطط مساحي بعد. الرجاء العودة للواجهة الرئيسية واستيراد ملف.
        </p>
        <button
          onClick={() => router.push('/')}
          className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold rounded-xl transition"
        >
          العودة للرئيسية المساحية 🏠
        </button>
      </div>
    );
  }

  return (
    <div className="engineering-glass glass-glow-cyan p-8 rounded-3xl relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>🔄</span> لوحة تتبع ومعالجة وكلاء Swarm
          </h2>
          <p className="text-xs text-slate-400 mt-1">متابعة حالة التشخيص الجغرافي وتقسيم القطع وتصنيف الأراضي بالثانية.</p>
        </div>
        
        <div className="flex flex-wrap gap-2 items-center text-xs font-mono-tech">
          <div className="px-3 py-1.5 bg-slate-950 border border-slate-800 text-slate-300 rounded-xl">
            TASK: {jobId}
          </div>
          {backendStatus && (
            <div className="px-3 py-1.5 bg-cyan-950/40 border border-cyan-800/40 text-cyan-400 rounded-xl font-bold">
              STATUS: {backendStatus}
            </div>
          )}
        </div>
      </div>

      {pollError && (
        <div className="mb-6 p-4 bg-red-950/20 border border-red-800/30 text-red-400 text-xs rounded-2xl">
          <strong>خطأ حالة الاتصال:</strong> {pollError}
        </div>
      )}

      {/* شريط التقدم الرئيسي */}
      <div className="mb-8 p-5 bg-slate-950/40 border border-slate-850 rounded-2xl">
        <div className="flex justify-between mb-2 text-xs">
          <span className="text-slate-400 font-semibold">معدل التقدم الكلي للعملية</span>
          <span className="text-white font-mono-tech font-bold">
            {Math.round((processingTime / estimatedTime) * 100)}%
          </span>
        </div>
        <div className="w-full bg-slate-900 border border-slate-850 rounded-full h-3 overflow-hidden">
          <div
            className="bg-gradient-to-r from-cyan-500 to-emerald-500 h-full rounded-full transition-all duration-500"
            style={{ 
              width: `${Math.min(100, (processingTime / estimatedTime) * 100)}%` 
            }}
          ></div>
        </div>
        <div className="flex justify-between mt-2.5 text-[10px] text-slate-500 font-mono-tech">
          <span>الوقت المنقضي: {formatTime(processingTime)}</span>
          <span>الوقت المتبقي المقدر: {formatTime(Math.max(0, estimatedTime - processingTime))}</span>
        </div>
      </div>

      {/* تقدم معالجة القطع */}
      <div className="mb-8">
        <TileProgress taskId={jobId} isProcessing={isProcessing} />
      </div>

      {/* مراحل المعالجة */}
      <div className="mb-8">
        <h3 className="font-bold text-slate-200 text-xs mb-4 border-b border-slate-850 pb-2 tracking-wider uppercase text-cyan-400">
          📍 مراحل وسير خط معالجة البيانات
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.keys(PROCESSING_STAGES).map((stageKey) => {
            const details = getStageDetails(stageKey);
            const status = getStageStatus(stageKey);
            
            return (
              <div
                key={stageKey}
                className={`p-4 rounded-2xl border transition-all text-xs flex flex-col justify-between ${
                  status === 'completed' ? 'bg-emerald-950/20 border-emerald-900/40 text-slate-300' :
                  status === 'in-progress' ? 'bg-cyan-950/20 border-cyan-500/40 text-white shadow-lg shadow-cyan-950/20' :
                  'bg-slate-950/30 border-slate-850 text-slate-500'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{details.icon}</span>
                    <div>
                      <h4 className="font-bold text-slate-200 text-xs">{details.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{details.description}</p>
                    </div>
                  </div>
                  
                  {status === 'in-progress' && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded font-bold text-[9px] animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                      معالجة
                    </div>
                  )}
                </div>
                
                {/* معلومات إضافية للمرحلة */}
                {status === 'in-progress' && (
                  <div className="mt-3 pt-3 border-t border-cyan-950 text-[10px] flex justify-between text-slate-400 font-mono-tech">
                    <span>الوكيل المستدعى:</span>
                    <span className="font-bold text-cyan-400">
                      {stageKey.includes('orchestrator') && 'ORCHESTRATOR'}
                      {stageKey.includes('extractor') && 'BOUNDARY_EXTRACTOR'}
                      {stageKey.includes('agent') && 'LAND_CLASSIFIER'}
                      {stageKey.includes('reviewer') && 'CRITIC_AGENT'}
                      {stageKey.includes('gis') && 'GIS_EXPORTER'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* معلومات النظام */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-xs">
        <div className="bg-slate-950/50 p-4 border border-slate-850 rounded-2xl">
          <h4 className="font-bold mb-2.5 text-slate-200 flex items-center gap-1">📊 مواصفات المعالجة</h4>
          <ul className="text-slate-400 space-y-1.5 font-mono-tech text-[10px]">
            <li>• وقت المحاكاة: {estimatedTime} ثانية</li>
            <li>• القنوات المفعلة: {stages.filter(s => getStageStatus(s.id) === 'in-progress').length} نشطة</li>
            <li>• إجمالي الوكلاء: {Object.keys(PROCESSING_STAGES).length} وكلاء مستقلين</li>
            <li>• حالة المحرك: {isProcessing ? 'Active Running' : 'Idle Ready'}</li>
          </ul>
        </div>

        <div className="bg-slate-950/50 p-4 border border-slate-850 rounded-2xl">
          <h4 className="font-bold mb-2.5 text-slate-200 flex items-center gap-1">🤖 أدوار وكلاء الذكاء الاصطناعي</h4>
          <ul className="text-slate-400 space-y-1.5 text-[10px]">
            <li>• <strong className="text-cyan-400">المنسق:</strong> يوجه المهام ويشرف على الاتصال.</li>
            <li>• <strong className="text-cyan-400">المقتطف:</strong> يستخرج المضلعات الهندسية عبر SAM.</li>
            <li>• <strong className="text-cyan-400">المتخصصون:</strong> يصنفون التربة ويسجلون المعالم.</li>
          </ul>
        </div>

        <div className="bg-slate-950/50 p-4 border border-slate-850 rounded-2xl">
          <h4 className="font-bold mb-2.5 text-slate-200 flex items-center gap-1">💾 سجل الذاكرة المشتركة</h4>
          <ul className="text-slate-400 space-y-1.5 text-[10px] font-mono-tech">
            <li>• Database: SQLite (shared_memory.db)</li>
            <li>• Channels: Event-Driven Message Bus</li>
            <li>• Task State: Persistent inside tables</li>
            <li>• Architecture: Decoupled routing</li>
          </ul>
        </div>
      </div>

      {/* أزرار التحكم */}
      <div className="flex gap-4">
        {!isProcessing ? (
          <button
            onClick={startProcessing}
            className="flex-1 py-3 px-6 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-xl font-bold text-xs transition-all shadow-lg"
          >
            🚀 بدء معالجة المهمة المساحية
          </button>
        ) : (
          <button
            disabled
            className="flex-1 py-3 px-6 bg-slate-850 border border-slate-800 text-slate-500 rounded-xl font-semibold text-xs cursor-not-allowed flex items-center justify-center gap-2"
          >
            <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-slate-400"></span>
            جاري المعالجة والتحليل الذكي...
          </button>
        )}
        
        <button
          onClick={() => router.refresh()}
          className="py-3 px-6 bg-slate-900 border border-slate-800 hover:border-slate-750 text-slate-300 rounded-xl font-semibold text-xs transition-colors"
        >
          🔄 إعادة تحميل
        </button>
      </div>

      {retryMessage && (
        <div className="mt-4 p-4 bg-amber-950/20 border border-amber-900/30 text-amber-400 text-xs rounded-2xl leading-relaxed">
          {retryMessage}
        </div>
      )}

      {retryError && (
        <div className="mt-4 p-4 bg-red-950/20 border border-red-800/30 text-red-400 text-xs rounded-2xl leading-relaxed">
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
            className="py-3 px-6 bg-amber-600 hover:bg-amber-500 text-slate-950 rounded-xl font-bold text-xs transition-all shadow-lg"
          >
            {isRetrying ? '⏳ جاري إعادة المحاولة...' : '🔁 إعادة محاولة معالجة المهمة'}
          </button>
        </div>
      )}

      {/* 📋 سجلات الوكلاء بالتفصيل */}
      {jobId && (
        <div className="mt-6 pt-6 border-t border-slate-800">
          <button
            onClick={() => {
              setShowLogs(!showLogs);
              if (!showLogs) fetchLogs(jobId);
            }}
            className="w-full flex items-center justify-between p-4 bg-slate-950/40 border border-slate-850 rounded-2xl hover:bg-slate-950/60 transition-colors text-xs"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">📋</span>
              <div className="text-right">
                <h3 className="font-bold text-slate-200">سجلات ومراسلات وكلاء المعالجة</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {logsSummary?.total_messages || 0} رسالة مسجلة بالذاكرة • آخر مرسل: {logsSummary?.last_message?.sender || '-'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {logsLoading && <span className="text-[10px] text-cyan-400 font-mono-tech">Loading logs...</span>}
              <span className="text-slate-400">▼</span>
            </div>
          </button>

          {showLogs && (
            <div className="mt-4 p-4 bg-slate-950 border border-slate-850 rounded-2xl max-h-96 overflow-y-auto font-mono-tech text-[11px] leading-relaxed">
              {logs.length === 0 ? (
                <p className="text-slate-500 text-center py-4">لا توجد رسائل سجل مسجلة بالذاكرة المساحية بعد.</p>
              ) : (
                <div className="space-y-3">
                  {logs.map((log: any, index: number) => (
                    <div
                      key={log.id || index}
                      className={`p-3 rounded-xl border-r-4 ${
                        log.type === 'ERROR' ? 'border-red-500 bg-red-950/20 text-red-300' :
                        log.type === 'WARNING' ? 'border-amber-500 bg-amber-950/20 text-amber-300' :
                        log.type === 'COMPLETED' ? 'border-emerald-500 bg-emerald-950/20 text-emerald-300' :
                        'border-cyan-500 bg-cyan-950/20 text-cyan-300'
                      }`}
                    >
                      <div className="flex justify-between items-center border-b border-slate-900/60 pb-1.5 mb-1.5">
                        <span className="text-slate-500 text-[9px]">
                          {new Date(log.created_at).toLocaleTimeString('ar-SA')}
                        </span>
                        <span className="font-bold uppercase text-[9px] tracking-wider">
                          {log.sender}
                        </span>
                      </div>
                      <p className="text-slate-200 mt-1 font-sans">{log.content}</p>
                      {log.payload && Object.keys(log.payload).length > 0 && (
                        <pre className="text-slate-500 text-[10px] mt-2 bg-black/30 p-2 rounded overflow-x-auto">
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
      <div className="mt-6 pt-6 border-t border-slate-800">
        <p className="text-[10px] text-slate-500 text-center">
          ⚡ النظام متكامل متعدد التنسيقات (ويب / أوتوكاد / غوغل إيرث) مع حلقة التدقيق البشري وإعادة التعلم.
        </p>
      </div>
    </div>
  );
}