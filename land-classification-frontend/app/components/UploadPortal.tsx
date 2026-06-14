"use client";

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { API_CONFIG } from '@/app/lib/map-config';

interface UploadPortalProps {
  onUploadComplete?: (fileInfo: any) => void;
  onProcessingStart?: () => void;
}

type ImageType = 'regular' | 'geospatial';

export default function UploadPortal({ onUploadComplete, onProcessingStart }: UploadPortalProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileInfo, setFileInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>('riyadh');
  const [imageType, setImageType] = useState<ImageType>('regular');
  const [pixelScale, setPixelScale] = useState('0.5');
  const [refLatitude, setRefLatitude] = useState('24.7136');
  const [refLongitude, setRefLongitude] = useState('46.6753');
  const [geoCrs, setGeoCrs] = useState('EPSG:4326');
  const [useGeoMetadata, setUseGeoMetadata] = useState(true);

  // المناطق المتاحة (من الفرونت اند الحالي + PDF)
  const regions = [
    { id: 'riyadh', name: 'منطقة 1 - الرياض', coordinates: [24.7136, 46.6753] },
    { id: 'jeddah', name: 'منطقة 2 - جدة', coordinates: [21.4858, 39.1925] },
    { id: 'dammam', name: 'منطقة 3 - الدمام', coordinates: [26.4207, 50.0888] },
    { id: 'custom', name: 'منطقة مخصصة', coordinates: null }
  ];

  // أنواع الملفات المدعومة
  const acceptedFiles = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/tiff': ['.tiff', '.tif'],
    'application/octet-stream': ['.geotiff', '.tif'] // GeoTIFF
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const fileInfo = {
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2),
        type: file.type,
        lastModified: new Date(file.lastModified).toLocaleString('ar-SA'),
        region: selectedRegion,
        imageType,
        geoCrs,
        useGeoMetadata
      };

      setFileInfo(fileInfo);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('image_type', imageType);
      formData.append('geospatial_crs', geoCrs);
      formData.append('use_geo_metadata', String(useGeoMetadata));
      formData.append('pixel_scale_meters', pixelScale);
      formData.append('ref_latitude', refLatitude);
      formData.append('ref_longitude', refLongitude);

      const resp = await fetch(`${API_CONFIG.baseURL}${API_CONFIG.endpoints.upload}`, {
        method: 'POST',
        body: formData
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`فشل في رفع الملف: ${resp.status} ${txt}`);
      }

      const result = await resp.json();

      setUploadProgress(100);
      setTimeout(() => setIsUploading(false), 400);

      if (onUploadComplete) onUploadComplete(result);
      if (onProcessingStart) onProcessingStart();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير معروف');
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [selectedRegion, imageType, pixelScale, refLatitude, refLongitude, geoCrs, useGeoMetadata, onUploadComplete, onProcessingStart]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptedFiles,
    maxSize: 100 * 1024 * 1024, // 100 ميغابايت (من PDF)
    multiple: false
  });

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-semibold mb-6 text-gray-800">
        بوابة رفع الصور الجوية
      </h2>

      {/* اختيار نوع الصورة */}
      <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
        <p className="font-semibold text-slate-800 mb-3">نوع الصورة</p>
        <div className="flex flex-wrap gap-3 mb-3">
          <button
            type="button"
            onClick={() => setImageType('regular')}
            disabled={isUploading}
            className={`px-4 py-2 rounded-lg border text-sm font-medium ${imageType === 'regular' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-blue-500'}`}
          >
            صورة عادية
          </button>
          <button
            type="button"
            onClick={() => setImageType('geospatial')}
            disabled={isUploading}
            className={`px-4 py-2 rounded-lg border text-sm font-medium ${imageType === 'geospatial' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-blue-500'}`}
          >
            صورة جغرافية
          </button>
        </div>
        <p className="text-sm text-slate-500">
          اختر إذا كانت الصورة تحتوي على بيانات جغرافية مضمنة أو تحتاج إدخال بيانات الإسقاط يدوياً.
        </p>
      </div>

      {/* إعدادات القياس والإحداثيات */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-3">إعدادات الصورة</h3>
          <label className="block mb-3 text-sm text-slate-700">
            <span className="block mb-1">مقياس البكسل (متر/بكسل)</span>
            <input
              type="number"
              value={pixelScale}
              onChange={(e) => setPixelScale(e.target.value)}
              step="0.01"
              min="0.01"
              disabled={isUploading}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block mb-3 text-sm text-slate-700">
            <span className="block mb-1">خط العرض المرجعي</span>
            <input
              type="number"
              value={refLatitude}
              onChange={(e) => setRefLatitude(e.target.value)}
              step="0.0001"
              disabled={isUploading}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block text-sm text-slate-700">
            <span className="block mb-1">خط الطول المرجعي</span>
            <input
              type="number"
              value={refLongitude}
              onChange={(e) => setRefLongitude(e.target.value)}
              step="0.0001"
              disabled={isUploading}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>

        {imageType === 'geospatial' && (
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <h3 className="font-semibold text-slate-800 mb-3">معلومات الصورة الجغرافية</h3>
            <label className="flex items-center gap-3 mb-4 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={useGeoMetadata}
                onChange={(e) => setUseGeoMetadata(e.target.checked)}
                disabled={isUploading}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              استخدام بيانات GeoTIFF المضمنة إذا كانت متاحة
            </label>
            <label className="block text-sm text-slate-700">
              <span className="block mb-1">نظام الإحداثيات (CRS)</span>
              <input
                type="text"
                value={geoCrs}
                onChange={(e) => setGeoCrs(e.target.value)}
                disabled={isUploading}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <p className="text-xs text-slate-500 mt-3">
              إذا كان الملف يحتوي على بيانات جغرافية، سيحاول النظام استخدامها؛ وإلا سيعتمد على القيم اليدوية أعلاه.
            </p>
          </div>
        )}
      </div>

      {/* معلومات النظام */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h3 className="font-semibold text-blue-800 mb-2">📋 مواصفات الرفع:</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• <strong>الحجم الأقصى:</strong> 100 ميغابكسل (من ملف PDF)</li>
          <li>• <strong>الصيغ المدعومة:</strong> JPG, PNG, TIFF, GeoTIFF</li>
          <li>• <strong>وقت المعالجة:</strong> 120 ثانية كحد أقصى (من PDF)</li>
          <li>• <strong>نظام الإحداثيات:</strong> WGS 84 (EPSG:4326)</li>
        </ul>
      </div>

      {/* منطقة سحب وإفلات */}
      <div className="mb-6">
        <label className="block text-gray-700 mb-2 font-medium">
          اختر صورة جوية
        </label>
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
            isDragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-blue-500'
          } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input {...getInputProps()} disabled={isUploading} />
          
          {isUploading ? (
            <div className="space-y-4">
              <div className="w-16 h-16 mx-auto">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
              </div>
              <p className="text-gray-600 font-medium">جاري رفع الملف...</p>
              
              {/* شريط التقدم */}
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <p className="text-sm text-gray-500">{uploadProgress}%</p>
            </div>
          ) : (
            <>
              <svg
                className="w-16 h-16 mx-auto text-gray-400 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-lg text-gray-600">
                {isDragActive ? 'أفلت الملف هنا...' : 'اسحب الملف هنا أو انقر للاختيار'}
              </p>
              <p className="text-sm text-gray-400 mt-2">
                يدعم: JPG, PNG, TIFF, GeoTIFF
              </p>
              <p className="text-xs text-gray-400 mt-1">
                (حتى 100 ميغابكسل)
              </p>
            </>
          )}
        </div>
      </div>

      {/* اختيار المنطقة */}
      <div className="mb-6">
        <label className="block text-gray-700 mb-2 font-medium">
          منطقة الدراسة (اختياري)
        </label>
        <select
          value={selectedRegion}
          onChange={(e) => setSelectedRegion(e.target.value)}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={isUploading}
        >
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </select>
        <p className="text-sm text-gray-500 mt-1">
          يساعد في تحسين دقة الإحداثيات الجغرافية
        </p>
      </div>

      {/* معلومات الملف المرفوع */}
      {fileInfo && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h4 className="font-semibold text-green-800 mb-2">
            ✓ تم اختيار الملف بنجاح
          </h4>
          <div className="space-y-2 text-sm text-green-700">
            <div className="flex justify-between">
              <span>اسم الملف:</span>
              <span className="font-medium">{fileInfo.name}</span>
            </div>
            <div className="flex justify-between">
              <span>الحجم:</span>
              <span className="font-medium">{fileInfo.size} ميجابايت</span>
            </div>
            <div className="flex justify-between">
              <span>النوع:</span>
              <span className="font-medium">{fileInfo.type}</span>
            </div>
            <div className="flex justify-between">
              <span>المنطقة:</span>
              <span className="font-medium">
                {regions.find(r => r.id === fileInfo.region)?.name}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* رسائل الخطأ */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <h4 className="font-semibold text-red-800 mb-2">⚠️ خطأ في الرفع</h4>
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-sm text-red-600 hover:text-red-800"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* معلومات النظام المستقبلي */}
      <div className="mt-8 p-4 bg-purple-50 rounded-lg border border-purple-200">
        <h3 className="font-semibold text-purple-800 mb-2">
          🚀 النظام المستقبلي:
        </h3>
        <ul className="text-sm text-purple-700 space-y-1">
          <li>• <strong>نظام فريق الوكلاء:</strong> منسق + مقتطف + متخصصين + ناقد</li>
          <li>• <strong>ذاكرة مشتركة:</strong> قاعدة بيانات + نظام رسائل</li>
          <li>• <strong>حلقة التدقيق البشري:</strong> تعلم من التصحيحات</li>
          <li>• <strong>تكامل متعدد:</strong> ويب + أندرويد + GIS</li>
        </ul>
      </div>
    </div>
  );
}