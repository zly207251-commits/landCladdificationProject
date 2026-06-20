"use client";

import { useEffect, useState } from "react";
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
  const [showOriginalImage, setShowOriginalImage] = useState<boolean>(false);
  const [showProcessedImage, setShowProcessedImage] = useState<boolean>(false);

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

  useEffect(() => {
    const fetchReport = async () => {
      setLoading(true);
      try {
        const url = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.report.replace('{task_id}', taskId)}`;
        const resp = await fetch(url);
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

  const imageSrc = report?.image_url ? `${API_CONFIG.baseURL}${report.image_url}` : null;
  const processedImageSrc = report?.processed_image_url ? `${API_CONFIG.baseURL}${report.processed_image_url}` : null;

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

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-4">نتائج المهمة</h1>

      {loading && <p className="text-sm text-gray-600">جاري جلب التقرير...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {report && (
        <div className="space-y-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="font-semibold text-lg mb-4">معلومات المهمة</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-right text-sm text-gray-700">
                <tbody>
                  <tr className="border-b">
                    <th className="py-3 px-4 font-medium text-gray-900">معرف المهمة</th>
                    <td className="py-3 px-4">{report.task_id}</td>
                  </tr>
                  <tr className="border-b bg-gray-50">
                    <th className="py-3 px-4 font-medium text-gray-900">الحالة</th>
                    <td className="py-3 px-4">{report.status}</td>
                  </tr>
                  <tr className="border-b">
                    <th className="py-3 px-4 font-medium text-gray-900">تاريخ الإنشاء</th>
                    <td className="py-3 px-4">{formatDate(report.created_at)}</td>
                  </tr>
                  <tr className="border-b bg-gray-50">
                    <th className="py-3 px-4 font-medium text-gray-900">آخر تحديث</th>
                    <td className="py-3 px-4">{formatDate(report.updated_at)}</td>
                  </tr>
                  <tr className="border-b">
                    <th className="py-3 px-4 font-medium text-gray-900">مقياس البكسل</th>
                    <td className="py-3 px-4">{report.metadata?.pixel_scale_meters ?? '-'}</td>
                  </tr>
                  <tr className="border-b bg-gray-50">
                    <th className="py-3 px-4 font-medium text-gray-900">خط العرض المرجعي</th>
                    <td className="py-3 px-4">{report.metadata?.ref_latitude ?? '-'}</td>
                  </tr>
                  <tr>
                    <th className="py-3 px-4 font-medium text-gray-900">خط الطول المرجعي</th>
                    <td className="py-3 px-4">{report.metadata?.ref_longitude ?? '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="font-semibold text-lg mb-4">سير عمل الوكلاء</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {agentSteps.map((agent) => (
                <div key={agent.id} className={`rounded-2xl border border-gray-200 p-4 ${agent.color}`}>
                  <h4 className="font-semibold text-base mb-2">{agent.title}</h4>
                  <p className="text-sm text-gray-700">{agent.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-lg">سجل الوكلاء</h3>
              <div className="flex flex-wrap gap-3">
                {processedImageSrc && (
                  <button
                    type="button"
                    onClick={() => setShowProcessedImage((prev) => !prev)}
                    className="rounded-full border border-green-300 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 transition hover:bg-green-100"
                  >
                    {showProcessedImage ? 'إخفاء الصورة النهائية' : 'عرض الصورة النهائية'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowOriginalImage((prev) => !prev)}
                  className="rounded-full border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                  {showOriginalImage ? 'إخفاء الصورة الأصلية' : 'عرض الصورة الأصلية'}
                </button>
                <button
                  type="button"
                  onClick={toggleLogs}
                  className="rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  {showLogs ? 'إخفاء رسائل المهمة' : 'عرض رسائل ووكلاء المهمة'}
                </button>
              </div>
            </div>

            {showLogs && (
              <div className="mt-4 space-y-3">
                {logsLoading && <p className="text-sm text-gray-600">جاري جلب سجل الوكلاء...</p>}
                {logsError && <p className="text-sm text-red-600">{logsError}</p>}
                {!logsLoading && !logsError && taskLogs.length === 0 && (
                  <p className="text-sm text-gray-500">لا توجد رسائل سجل متاحة بعد.</p>
                )}
                {!logsLoading && taskLogs.length > 0 && (
                  <div className="space-y-3">
                    {taskLogs.map((log, idx) => (
                      <div key={idx} className={`rounded-2xl border p-4 ${getAgentCardClasses(log.agent)}`}>
                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">{getAgentLabel(log.agent)}</div>
                            <div className="text-xs text-gray-500">{(log.type || '').toUpperCase()}</div>
                          </div>
                          <span className="text-xs text-gray-500">{formatDate(log.timestamp || log.created_at)}</span>
                        </div>
                        <p className="mt-3 text-sm text-gray-700 whitespace-pre-line">{log.content || log.message || 'بدون محتوى'}</p>
                        {log.data && typeof log.data === 'object' && Object.keys(log.data).length > 0 && (
                          <div className="mt-3 rounded-xl bg-white border border-gray-200 p-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">تفاصيل إضافية</div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {Object.entries(log.data).map(([key, value]) => (
                                <div key={key} className="rounded-lg bg-gray-100 p-2">
                                  <div className="text-[11px] font-semibold text-gray-600">{key}</div>
                                  <div className="mt-1 text-sm text-gray-800 break-words">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</div>
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

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="font-semibold text-lg mb-4">ملخص الطبقات ({report.layers?.length ?? 0})</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-right text-sm text-gray-700">
                <thead className="bg-gray-100 text-gray-900">
                  <tr>
                    <th className="py-3 px-4">الطبقة</th>
                    <th className="py-3 px-4">المساحة (م²)</th>
                    <th className="py-3 px-4">تفاصيل المساحة</th>
                    <th className="py-3 px-4">عدد المضلعات</th>
                    <th className="py-3 px-4">الوصف</th>
                    <th className="py-3 px-4">التصنيف المحلي</th>
                  </tr>
                </thead>
                <tbody>
                  {report.layers?.map((ly: any, idx: number) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="py-3 px-4 font-medium text-gray-900">{ly.layer_name}</td>
                      <td className="py-3 px-4">{ly.area_sq_meters ?? '-'}</td>
                      <td className="py-3 px-4">{ly.area_agricultural ?? '-'}</td>
                      <td className="py-3 px-4">{ly.polygons_count ?? '-'}</td>
                      <td className="py-3 px-4">{ly.description || '-'}</td>
                      <td className="py-3 px-4">{renderLocalClassification(ly.local_classification)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {showProcessedImage && processedImageSrc && (
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="font-semibold text-lg mb-4">الصورة النهائية بعد التعديل</h3>
              <img
                src={processedImageSrc}
                alt="الصورة النهائية للمهمة"
                className="w-full rounded-lg border border-gray-200 object-contain"
              />
            </div>
          )}

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="font-semibold text-lg mb-4">أدوات التصدير والتدقيق للمهمة السابقة</h3>
            <div className="grid gap-6">
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                <h4 className="font-semibold mb-3">تدقيق المهمة</h4>
                <AuditInterface
                  initialFeatures={taskFeatures}
                  center={report.map_center ?? null}
                  zoom={report.map_zoom ?? null}
                  onSaveCorrections={(corrections) => {
                    console.log('Saved corrections for previous task:', corrections);
                  }}
                />
              </div>
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                <h4 className="font-semibold mb-3">تصدير المهمة</h4>
                <ExportCenter
                  jobId={report.task_id}
                  availableLayers={availableLayerNames}
                  reportData={report}
                  onExport={() => {
                    // يمكن توسيع السلوك لاحقًا
                  }}
                />
              </div>
            </div>
          </div>

          {showOriginalImage && imageSrc && (
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="font-semibold text-lg mb-4">الصورة المرفوعة للمهمة</h3>
              <img
                src={imageSrc}
                alt="صورة المهمة"
                className="w-full rounded-lg border border-gray-200 object-contain"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
