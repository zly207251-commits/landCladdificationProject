"use client";

import { useState } from "react";
import Link from "next/link";

export default function AuditPage() {
  const [layer, setLayer] = useState("vegetation");
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const layers = [
    { id: "vegetation", name: "غطاء نباتي", color: "bg-green-500" },
    { id: "water", name: "مسطحات مائية", color: "bg-blue-500" },
    { id: "urban", name: "عمراني", color: "bg-gray-600" },
    { id: "bare_soil", name: "أرض عارية", color: "bg-amber-600" },
    { id: "cropland", name: "أرض زراعية", color: "bg-yellow-500" },
  ];

  const handleSubmit = async () => {
    setIsSubmitting(true);
    // TODO: ربط مع الباك اند
    setTimeout(() => {
      setIsSubmitting(false);
      alert("تم إرسال التعديل بنجاح!");
      setComment("");
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-800">
              واجهة التدقيق
            </h1>
            <div className="flex items-center space-x-4 space-x-reverse">
              <Link
                href="/results"
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                عودة للنتائج
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Instructions */}
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-8 rounded">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="mr-3">
              <p className="text-sm text-yellow-700">
                استخدم أدوات التدقيق لتقييم دقة التصنيف وتحسين النتائج. يمكنك تغيير تصنيف أي منطقة وإضافة ملاحظات.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Map Section */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-xl overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="font-semibold text-gray-800">خريطة التدقيق</h3>
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                  وضع التدقيق
                </span>
              </div>
              <div className="relative">
                {/* Placeholder for map */}
                <div className="h-[500px] bg-gray-200 flex items-center justify-center relative overflow-hidden">
                  <div className="text-center">
                    <svg
                      className="w-24 h-24 text-gray-400 mb-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 7m0 13V7"
                      />
                    </svg>
                    <p className="text-gray-500">عرض الخريطة للتدقيق (سيظهر هنا)</p>
                  </div>
                  
                  {/* Legend */}
                  <div className="absolute bottom-4 right-4 bg-white p-4 rounded-lg shadow-lg">
                    <h4 className="font-semibold mb-3 text-gray-800">أداة التدقيق</h4>
                    <p className="text-sm text-gray-600 mb-3">
                      انقر على منطقة في الخريطة لتغيير تصنيفها
                    </p>
                    <div className="space-y-2">
                      {layers.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setLayer(item.id)}
                          className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
                            item.id === layer ? "ring-2 ring-blue-500 bg-blue-50" : "hover:bg-gray-100"
                          }`}
                        >
                          <div className="flex items-center">
                            <div
                              className={`w-4 h-4 rounded ${item.color} mr-2`}
                            ></div>
                            <span className="text-sm text-gray-700">{item.name}</span>
                          </div>
                          {item.id === layer && (
                            <svg
                              className="w-5 h-5 text-blue-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex gap-4">
              <button className="flex-1 py-3 px-6 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors shadow-lg">
                📊 تقرير التدقيق
              </button>
              <button className="flex-1 py-3 px-6 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors shadow-lg">
                ✅ حفظ وتعديل
              </button>
            </div>
          </div>

          {/* Audit Form */}
          <div className="space-y-6">
            {/* Layer Selection */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="font-semibold mb-4 text-gray-800 border-b pb-3">
                تعديل الطبقات
              </h3>
              
              <div className="mb-4">
                <label className="block text-gray-700 mb-2 font-medium">
                  المنطقة المحددة
                </label>
                <div className="p-3 bg-gray-100 rounded-lg">
                  <p className="text-sm text-gray-600">
                    المساحة: 0.45 كم²
                  </p>
                  <p className="text-sm text-gray-600">
                    التصنيف الحالي: {layers.find(l => l.id === layer)?.name}
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-gray-700 mb-2 font-medium">
                  التصنيف الجديد
                </label>
                <select
                  value={layer}
                  onChange={(e) => setLayer(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  {layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex items-center">
                  <div
                    className={`w-6 h-6 rounded mr-2 ${layers.find(l => l.id === layer)?.color}`}
                  ></div>
                  <span className="text-sm text-gray-600">
                    سيتم تغيير التصنيف إلى: {layers.find(l => l.id === layer)?.name}
                  </span>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-gray-700 mb-2 font-medium">
                  ملاحظات (اختياري)
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="أضف ملاحظاتك هنا..."
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent min-h-[100px]"
                ></textarea>
              </div>

              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className={`w-full py-4 px-6 rounded-lg font-semibold text-white transition-all ${
                  isSubmitting
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
                }`}
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    جاري الحفظ...
                  </span>
                ) : (
                  "💾 حفظ التعديلات"
                )}
              </button>
            </div>

            {/* Summary */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="font-semibold mb-4 text-gray-800 border-b pb-3">
                إحصائيات التدقيق
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">التعديلات المقترحة</span>
                  <span className="font-semibold text-purple-600">12</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">تم حفظها</span>
                  <span className="font-semibold text-green-600">8</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">الملاحظات</span>
                  <span className="font-semibold text-blue-600">5</span>
                </div>
              </div>
            </div>

            {/* Next Steps */}
            <div className="bg-purple-50 rounded-xl shadow-lg p-6">
              <h3 className="font-semibold mb-3 text-purple-800 border-b pb-3">
                الخطوات التالية
              </h3>
              <ul className="space-y-2 text-sm text-purple-700">
                <li className="flex items-start">
                  <span className="w-6 h-6 rounded-full bg-purple-200 text-purple-800 flex items-center justify-center mr-2 text-xs font-bold">1</span>
                  <span>تدقيق جميع الطبقات الرئيسية</span>
                </li>
                <li className="flex items-start">
                  <span className="w-6 h-6 rounded-full bg-purple-200 text-purple-800 flex items-center justify-center mr-2 text-xs font-bold">2</span>
                  <span>إضافة ملاحظات تفصيلية</span>
                </li>
                <li className="flex items-start">
                  <span className="w-6 h-6 rounded-full bg-purple-200 text-purple-800 flex items-center justify-center mr-2 text-xs font-bold">3</span>
                  <span>حفظ التعديلات</span>
                </li>
                <li className="flex items-start">
                  <span className="w-6 h-6 rounded-full bg-purple-200 text-purple-800 flex items-center justify-center mr-2 text-xs font-bold">4</span>
                  <span>إعادة التصنيف المحسّن</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
