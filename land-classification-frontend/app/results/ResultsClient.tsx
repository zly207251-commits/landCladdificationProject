"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { API_CONFIG } from "@/app/lib/map-config";
import ExportCenter from "@/app/components/ExportCenter";
import AuditInterface from "@/app/components/AuditInterface";

interface ResultsClientProps {
  taskId: string;
}

export default function ResultsClient({ taskId }: ResultsClientProps) {
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [taskLogs, setTaskLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const router = useRouter();

  const AGENT_LABELS: Record<string, string> = {
    COORDINATOR: 'وكيل المنسق',
    PROJECTION_AGENT: 'وكيل الإسقاط',
    LAND_AGENT: 'وكيل الأراضي',
    ORCHESTRATOR: 'منسق المهمة',
    EXTRACTOR: 'مستخرج الحدود',
    REVIEWER: 'وكيل الناقد'
  };

  const AGENT_COLORS: Record<string, string> = {
    COORDINATOR: 'border-blue-300 bg-blue-50',
    PROJECTION_AGENT: 'border-green-300 bg-green-50',
    LAND_AGENT: 'border-red-300 bg-red-50',
    ORCHESTRATOR: 'border-slate-300 bg-slate-50',
    EXTRACTOR: 'border-emerald-300 bg-emerald-50',
    REVIEWER: 'border-orange-300 bg-orange-50'
  };

  const getAgentLabel = (agent?: string) => {
    if (!agent) return 'وكيل غير معروف';
    return AGENT_LABELS[agent.toUpperCase()] || agent;
  };

  const getAgentCardClasses = (agent?: string) => {
    if (!agent) return 'border-gray-200 bg-gray-50';
    return AGENT_COLORS[agent.toUpperCase()] || 'border-gray-200 bg-gray-50';
  };

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.report.replace('{task_id}', taskId)}`;
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Server ${resp.status}: ${text}`);
      }
      const data = await resp.json();
      setReport(data);
    } catch (err: any) {
      setError(err?.message || 'خطأ في جلب التقرير');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [taskId]);

  useEffect(() => {
    const fetchLogs = async () => {
      if (!report?.task_id) return;
      setLogsLoading(true);
      setLogsError(null);

      try {
        const url = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.logs.replace('{task_id}', report.task_id)}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Server ${resp.status}: ${text}`);
        }
        const data = await resp.json();
        setTaskLogs(data.logs || []);
      } catch (err: any) {
        setLogsError(err?.message || 'خطأ في جلب سجل المهمة');
      } finally {
        setLogsLoading(false);
      }
    };

    fetchLogs();
  }, [report?.task_id]);

  const toggleLogs = () => {
    setShowLogs((prev) => !prev);
  };

  const handleDeleteTask = async () => {
    if (!window.confirm("هل أنت متأكد من مسح كافة البيانات والمخططات المساحية لهذه المهمة نهائياً من الخادم؟")) return;
    try {
      const resp = await fetch(`${API_CONFIG.baseURL}/tasks/${taskId}`, {
        method: 'DELETE'
      });
      if (!resp.ok) throw new Error("فشل الحذف من الخادم");
      alert("تم مسح المهمة بنجاح.");
      router.push("/");
    } catch (e: any) {
      alert("خطأ أثناء المسح: " + e.message);
    }
  };

  const imageSrc = report?.image_url ? `${API_CONFIG.baseURL}${report.image_url}` : null;
  const processedImageSrc = report?.processed_image_url ? `${API_CONFIG.baseURL}${report.processed_image_url}` : null;
  const globeViewerLink = report?.task_id ? `/globe?task_id=${report.task_id}` : null;

  const classificationMeta: Record<string, { icon: string; label: string; color: string }> = {
    class_name: { icon: '🏷️', label: 'التسمية', color: 'bg-blue-50 text-blue-700' },
    soil_type: { icon: '🌱', label: 'نوع التربة', color: 'bg-green-50 text-green-700' },
    water_relation: { icon: '💧', label: 'العلاقة بالماء', color: 'bg-cyan-50 text-cyan-700' },
  };

  const renderLocalClassification = (classification: Record<string, any>) => {
    if (!classification || Object.keys(classification).length === 0) {
      return <span className="text-gray-500">-</span>;
    }

    return (
      <div className="space-y-2">
        {Object.entries(classification).map(([key, value]) => {
          const meta = classificationMeta[key] || { icon: '📌', label: key, color: 'bg-gray-100 text-gray-800' };
          return (
            <div key={key} className={`rounded-xl border px-3 py-2 ${meta.color} border-current`}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </div>
              <div className="mt-1 text-sm text-gray-700">{value}</div>
            </div>
          );
        })}
      </div>
    );
  };

  const normalizePolygon = (polygon: any) => {
    if (!Array.isArray(polygon) || polygon.length === 0) return [];

    let ring = polygon;
    if (Array.isArray(polygon[0]) && Array.isArray(polygon[0][0])) {
      if (Array.isArray(polygon[0][0])) {
        ring = polygon[0];
      }
    }

    if (!Array.isArray(ring[0]) || ring[0].length < 2) return [];

    // تفترض الخريطة أن الباكند يعطي GeoJSON قياسيًا ([lon, lat]).
    // نُبسّط المعالجة ونمسك بالإحداثيات كما هي لتجنّب قلب القيم الخاطئ.
    const normalizedRing = ring
      .filter((coord: any) => Array.isArray(coord) && coord.length >= 2)
      .map((coord: any) => {
        const [a, b] = coord;
        if (typeof a !== 'number' || typeof b !== 'number') return null;
        return [a, b];
      })
      .filter((coord: any) => coord !== null);

    if (normalizedRing.length < 4) return [];

    const first = normalizedRing[0];
    const last = normalizedRing[normalizedRing.length - 1];
    if (!first || !last) return [];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      normalizedRing.push(first);
    }

    return [normalizedRing];
  };

  const isValidPolygon = (geometry: any) => {
    return (
      geometry?.type === 'Polygon' &&
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length > 0 &&
      Array.isArray(geometry.coordinates[0]) &&
      geometry.coordinates[0].length >= 4
    );
  };

  const taskFeatures = report?.layers?.flatMap((ly: any, idx: number) => {
    if (!ly.geo_polygons || ly.geo_polygons.length === 0) return [];

    return ly.geo_polygons.flatMap((polygon: any, polygonIdx: number) => {
      const coordinates = normalizePolygon(polygon);
      const feature = {
        id: `feature_${idx + 1}_${polygonIdx + 1}`,
        properties: {
          name: ly.layer_name,
          classification: ly.local_classification?.class_name || ly.layer_name,
          layer_type: ly.layer_name,
          area: ly.area_sq_meters,
          description: ly.description,
          local_classification: ly.local_classification,
          area_agricultural: ly.area_agricultural
        },
        geometry: {
          type: 'Polygon',
          coordinates
        }
      };

      return isValidPolygon(feature.geometry) ? feature : [];
    });
  }) || [];

  const availableLayerNames = report?.layers?.map((ly: any) => ly.layer_name) || [];

  const formatDate = (value: string | undefined) => {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString('ar-EG', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return value;
    }
  };

  const agentSteps = [
    {
      id: 'coordinator',
      title: 'وكيل المنسق',
      description: 'يبدأ المهمة ويوجهها بين الوكلاء ويحدد الخطوة التالية.',
      color: 'bg-blue-50 text-blue-700'
    },
    {
      id: 'projection_agent',
      title: 'وكيل الإسقاط',
      description: 'يستخرج حدود القطع من الصورة ويحوّلها إلى إحداثيات جغرافية.',
      color: 'bg-green-50 text-green-700'
    },
    {
      id: 'land_agent',
      title: 'وكيل الأراضي',
      description: 'يصنّف قطع الأرض ويضيف الوصف المحلي ونوع التربة وعلاقة المياه.',
      color: 'bg-red-50 text-red-700'
    }
  ];

  const getAgentMessageCardStyles = (agentName?: string) => {
    if (!agentName) return "bg-slate-950/40 border-slate-850 text-slate-300";
    const name = agentName.toUpperCase();
    if (name.includes("COORDINATOR") || name.includes("ORCHESTRATOR")) return "bg-slate-950/40 border-blue-900/30 text-blue-300";
    if (name.includes("PROJECTION")) return "bg-slate-950/40 border-emerald-900/30 text-emerald-300";
    if (name.includes("LAND")) return "bg-slate-950/40 border-red-900/30 text-red-300";
    return "bg-slate-950/40 border-purple-900/30 text-purple-300";
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <span>📋</span> تقرير القياس والمطابقة المساحية
          </h1>
          <p className="text-xs text-slate-400 mt-1">تفاصيل نتائج التشخيص الجغرافي وحساب المساحات للأراضي.</p>
        </div>
        
        <Link href="/" className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300">
          العينة التوجيهية الرئيسية 🏠
        </Link>
      </div>

      {loading && (
        <div className="py-12 text-center text-xs text-slate-400 font-mono-tech">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400 mx-auto mb-3"></div>
          Generating geospatial survey report...
        </div>
      )}
      
      {error && <div className="p-4 bg-red-950/20 border border-red-800/30 text-red-400 text-xs rounded-2xl">{error}</div>}

      {report && (
        <div className="space-y-8">
          {/* معلومات المهمة */}
          <div className="engineering-glass glass-glow-cyan p-6 rounded-3xl">
            <h3 className="font-bold text-slate-200 text-sm mb-4 border-b border-slate-800 pb-2">🌐 تفاصيل ومعايير الإسقاط</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-right text-xs text-slate-300 font-mono-tech">
                <tbody>
                  <tr className="border-b border-slate-800/60">
                    <th className="py-3 px-4 font-semibold text-slate-400 text-right w-1/3">معرف المهمة (TASK_ID)</th>
                    <td className="py-3 px-4 select-all text-white">{report.task_id}</td>
                  </tr>
                  <tr className="border-b border-slate-800/60">
                    <th className="py-3 px-4 font-semibold text-slate-400 text-right">حالة المعالجة</th>
                    <td className="py-3 px-4 text-cyan-400 font-bold">{report.status}</td>
                  </tr>
                  <tr className="border-b border-slate-800/60">
                    <th className="py-3 px-4 font-semibold text-slate-400 text-right">تاريخ المعالجة</th>
                    <td className="py-3 px-4">{formatDate(report.created_at)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/60">
                    <th className="py-3 px-4 font-semibold text-slate-400 text-right">آخر تحديث للسجلات</th>
                    <td className="py-3 px-4">{formatDate(report.updated_at)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/60">
                    <th className="py-3 px-4 font-semibold text-slate-400 text-right">دقة البكسل المترية</th>
                    <td className="py-3 px-4">{report.metadata?.pixel_scale_meters ?? '-'} م/بكسل</td>
                  </tr>
                  <tr className="border-b border-slate-800/60">
                    <th className="py-3 px-4 font-semibold text-slate-400 text-right">Latitude Center</th>
                    <td className="py-3 px-4">{report.metadata?.ref_latitude ?? '-'}</td>
                  </tr>
                  <tr>
                    <th className="py-3 px-4 font-semibold text-slate-400 text-right">Longitude Center</th>
                    <td className="py-3 px-4">{report.metadata?.ref_longitude ?? '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* قسم المعاينة المباشرة للصور الجوية وروابط التحميل */}
          <div className="engineering-glass glass-glow-cyan p-6 rounded-3xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
                  <span>🖼️</span> الصور الجوية والمعالجة للمهمة
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">معاينة مباشرة ومقارنة متوازية للصورة الأصلية والصورة المعالجة بالذكاء الاصطناعي.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {imageSrc && (
                  <a
                    href={imageSrc}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-1.5 rounded-xl bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/40 text-cyan-300 text-xs font-bold transition flex items-center gap-1.5"
                  >
                    <span>📥</span> فتح الصورة الأصلية HD
                  </a>
                )}
                {processedImageSrc && (
                  <a
                    href={processedImageSrc}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-800/40 text-emerald-300 text-xs font-bold transition flex items-center gap-1.5"
                  >
                    <span>🎨</span> فتح الصورة المعالجة HD
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => router.push(`/results/images?task_id=${taskId}`)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold transition flex items-center gap-1.5"
                >
                  <span>🔍</span> شاشة المقارنة المتوازية
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {imageSrc && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3 space-y-2">
                  <span className="text-xs font-bold text-slate-300 block">الصورة الجوية المرفوعة:</span>
                  <div className="rounded-xl overflow-hidden bg-black/40 border border-slate-850 h-56 flex items-center justify-center">
                    <img src={imageSrc} alt="Original Aerial Image" className="max-h-full max-w-full object-contain" />
                  </div>
                </div>
              )}

              {processedImageSrc && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3 space-y-2">
                  <span className="text-xs font-bold text-slate-300 block">الصورة المعالجة والمسقطة:</span>
                  <div className="rounded-xl overflow-hidden bg-black/40 border border-slate-850 h-56 flex items-center justify-center">
                    <img src={processedImageSrc} alt="Processed Image" className="max-h-full max-w-full object-contain" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* سير عمل وكلاء الذكاء الاصطناعي */}
          <div className="engineering-glass glass-glow-cyan p-6 rounded-3xl">
            <h3 className="font-bold text-slate-200 text-sm mb-4 border-b border-slate-800 pb-2">🤖 هيكلية وسير عمل فريق الوكلاء</h3>
            <div className="grid gap-4 sm:grid-cols-3 text-xs">
              {agentSteps.map((agent) => (
                <div key={agent.id} className="rounded-2xl border border-slate-850 p-4 bg-slate-950/40">
                  <h4 className="font-bold text-slate-200 mb-2 text-xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                    {agent.title}
                  </h4>
                  <p className="text-slate-400 leading-relaxed">{agent.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* سجل ورسائل الوكلاء */}
          <div className="engineering-glass glass-glow-cyan p-6 rounded-3xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-slate-200 text-sm">💬 سجل اتصالات الوكلاء المساحين</h3>
              <div className="flex flex-wrap gap-2">
                {(imageSrc || processedImageSrc) && (
                  <button
                    type="button"
                    onClick={() => router.push(`/results/images?task_id=${taskId}`)}
                    className="px-3 py-1.5 rounded-xl border border-slate-800 text-slate-300 hover:text-white transition text-xs font-semibold"
                  >
                    🖼️ معاينة الخرائط والصور
                  </button>
                )}
                {globeViewerLink && (
                  <a
                    href={globeViewerLink}
                    className="px-3 py-1.5 rounded-xl bg-cyan-950/40 border border-cyan-800/40 text-cyan-300 hover:bg-cyan-950/60 transition text-xs font-semibold"
                  >
                    🛰️ فتح عارض الـ Globe ثلاثي الأبعاد
                  </a>
                )}
                <button
                  type="button"
                  onClick={fetchReport}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition text-xs font-semibold"
                >
                  🔄 تحديث
                </button>
                <button
                  type="button"
                  onClick={toggleLogs}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition text-xs font-semibold"
                >
                  {showLogs ? '🙈 إخفاء المحادثات' : '💬 عرض المحادثات'}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteTask}
                  className="px-3 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-900/30 text-red-400 hover:text-red-300 transition text-xs font-bold"
                >
                  🗑️ حذف المهمة
                </button>
              </div>
            </div>

            {showLogs && (
              <div className="mt-4 space-y-4 max-h-[500px] overflow-y-auto pr-1">
                {logsLoading && <div className="text-center text-xs text-slate-500 font-mono-tech">Loading swarm messages...</div>}
                {logsError && <p className="text-xs text-red-400">{logsError}</p>}
                {!logsLoading && !logsError && taskLogs.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-4">لم تتبادل شبكة الوكلاء أي رسائل خارجية بعد.</p>
                )}
                {!logsLoading && taskLogs.length > 0 && (
                  <div className="space-y-4">
                    {taskLogs.map((log, idx) => (
                      <div key={idx} className={`rounded-2xl border p-4 ${getAgentMessageCardStyles(log.agent)}`}>
                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start border-b border-slate-900 pb-2">
                          <div>
                            <div className="text-xs font-bold text-white">{getAgentLabel(log.agent)}</div>
                            <div className="text-[10px] text-slate-500 font-mono-tech mt-0.5">{(log.type || '').toUpperCase()}</div>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono-tech">{formatDate(log.timestamp || log.created_at)}</span>
                        </div>
                        <p className="mt-3 text-xs text-slate-300 leading-relaxed whitespace-pre-line font-sans">{log.content || log.message || 'بدون محتوى'}</p>
                        
                        {log.data && typeof log.data === 'object' && Object.keys(log.data).length > 0 && (
                          <div className="mt-3 rounded-xl bg-slate-950/60 border border-slate-900 p-3">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">معلومات الإسقاط الهندسية</div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {Object.entries(log.data).map(([key, value]) => (
                                <div key={key} className="rounded-lg bg-slate-900/60 border border-slate-900 p-2 font-mono-tech text-[10px]">
                                  <div className="text-slate-500 font-semibold">{key}</div>
                                  <div className="mt-1 text-slate-300 break-words">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ملخص طبقات الأراضي */}
          <div className="engineering-glass glass-glow-cyan p-6 rounded-3xl">
            <h3 className="font-bold text-slate-200 text-sm mb-4 border-b border-slate-800 pb-2">📊 ملخص وتثمين المساحات حسب الطبقات ({report.layers?.length ?? 0})</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-right text-xs text-slate-300 font-mono-tech">
                <thead className="bg-slate-950/50 text-slate-200 border-b border-slate-800 font-semibold">
                  <tr>
                    <th className="py-3 px-4 text-right">اسم الطبقة الهندسية</th>
                    <th className="py-3 px-4 text-right">المساحة (متر مربع)</th>
                    <th className="py-3 px-4 text-right">المساحة (فدان/قيراط/سهم)</th>
                    <th className="py-3 px-4 text-right">عدد المضلعات</th>
                    <th className="py-3 px-4 text-right">الوصف والتحليل المترولوجي</th>
                    <th className="py-3 px-4 text-right">توجيه التثمين المحلي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {report.layers?.map((ly: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-950/20 transition">
                      <td className="py-3 px-4 font-bold text-white">{ly.layer_name}</td>
                      <td className="py-3 px-4">{ly.area_sq_meters ?? '-'} م²</td>
                      <td className="py-3 px-4 text-cyan-400">{ly.area_agricultural ?? '-'}</td>
                      <td className="py-3 px-4">{ly.polygons_count ?? '-'}</td>
                      <td className="py-3 px-4 text-slate-400 leading-relaxed font-sans">{ly.description || '-'}</td>
                      <td className="py-3 px-4">{renderLocalClassification(ly.local_classification)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* لوحة التدقيق والتصدير الجغرافي */}
          <div className="grid gap-6">
            <div className="engineering-glass p-6 rounded-3xl">
              <h4 className="font-bold text-white text-sm mb-4 border-b border-slate-800 pb-2 flex items-center gap-1.5">
                <span>🔍</span> تدقيق ومطابقة مضلعات المهمة المساحية
              </h4>
              <AuditInterface
                taskId={report.task_id}
                initialFeatures={taskFeatures}
                center={report.map_center ?? null}
                zoom={report.map_zoom ?? null}
                onSaveCorrections={(corrections) => {
                  console.log('Saved corrections for previous task:', corrections);
                }}
              />
            </div>
            
            <div className="engineering-glass p-6 rounded-3xl">
              <h4 className="font-bold text-white text-sm mb-4 border-b border-slate-800 pb-2 flex items-center gap-1.5">
                <span>📥</span> استخراج وتصدير المخطط بصيغ هندسية متعددة
              </h4>
              <ExportCenter
                jobId={report.task_id}
                availableLayers={availableLayerNames}
                reportData={report}
                onExport={() => {
                  // Extended behavior if needed
                }}
              />
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
