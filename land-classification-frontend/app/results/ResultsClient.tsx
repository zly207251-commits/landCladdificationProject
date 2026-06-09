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

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-4">نتائج المهمة</h1>

      {loading && <p className="text-sm text-gray-600">جاري جلب التقرير...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {report && (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="font-semibold">الحالة: {report.status}</h3>
            <p className="text-sm text-gray-600">صورة: {report.image_path}</p>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-2">الطبقات ({report.layers.length})</h3>
            <div className="space-y-3">
              {report.layers.map((ly: any, idx: number) => (
                <div key={idx} className="p-3 border rounded">
                  <div className="flex flex-col md:flex-row justify-between gap-4">
                    <div>
                      <h4 className="font-semibold">{ly.layer_name}</h4>
                      <p className="text-sm text-gray-600">المساحة: {ly.area_sq_meters} م²</p>
                      <p className="text-sm text-gray-600">تفاصيل: {ly.area_agricultural}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm">تعداد المضلع: {ly.polygons_count}</p>
                      <p className="text-sm">تصنيف محلي: {JSON.stringify(ly.local_classification)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
