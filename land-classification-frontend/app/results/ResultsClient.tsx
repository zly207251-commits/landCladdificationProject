"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_CONFIG } from "@/app/lib/map-config";

interface ResultsClientProps {
  taskId: string;
}

export default function ResultsClient({ taskId }: ResultsClientProps) {
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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

  const imageSrc = report?.image_url ? `${API_CONFIG.baseURL}${report.image_url}` : null;

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

          {imageSrc && (
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
