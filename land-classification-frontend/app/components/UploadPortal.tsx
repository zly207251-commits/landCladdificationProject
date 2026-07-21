"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import Link from 'next/link';
import { API_CONFIG } from '@/app/lib/map-config';

interface UploadPortalProps {
  onUploadComplete?: (fileInfo: any) => void;
  onProcessingStart?: () => void;
}

interface SamSettings {
  samUseFallback: boolean;
  samMinMaskRegionArea: string;
  samPointsPerSide: string;
  samPredIoUThresh: string;
  samStabilityScoreThresh: string;
}

type ImageType = 'regular' | 'geospatial' | 'kml';

export default function UploadPortal({ onUploadComplete, onProcessingStart }: UploadPortalProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileInfo, setFileInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>('sanaa');
  const [imageType, setImageType] = useState<ImageType>('regular');
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [pixelScale, setPixelScale] = useState('0.5');
  const [refLatitude, setRefLatitude] = useState('15.3694');
  const [refLongitude, setRefLongitude] = useState('44.1910');
  const [geoCrs, setGeoCrs] = useState('EPSG:4326');
  const [useGeoMetadata, setUseGeoMetadata] = useState(true);
  const [samUseFallback, setSamUseFallback] = useState(false);
  const [samMinMaskRegionArea, setSamMinMaskRegionArea] = useState('500');
  const [samPointsPerSide, setSamPointsPerSide] = useState('16');
  const [samPredIoUThresh, setSamPredIoUThresh] = useState('0.86');
  const [samStabilityScoreThresh, setSamStabilityScoreThresh] = useState('0.85');
  const [tfwContent, setTfwContent] = useState<string | null>(null);
  const [zoom, setZoom] = useState('18');

  const handleTfwFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setTfwContent(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string || '';
      setTfwContent(text);
    };
    reader.readAsText(file);
  };

  const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4MB per chunk to stay below common GitHub.dev/proxy and server 413 limits
  const UPLOAD_CONCURRENCY = 6; // Maximize parallel upload requests for maximum speed
  const MAX_RETRIES = 2;

  const buildUploadId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `upload_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  };

  // poll ref to allow cleanup
  const pollRef = useRef<number | null>(null);

  const uploadFileChunks = async (file: File, uploadId: string, metadata: Record<string, any>) => {
    // Dynamic chunk size: 12MB for large files (>150MB) to reduce HTTP connection overhead and speed up uploads, 4MB default
    const CHUNK_SIZE_BYTES = file.size > 150 * 1024 * 1024 ? 12 * 1024 * 1024 : 4 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE_BYTES));
    const totalBytes = file.size;

    const getChunkBounds = (chunkIndex: number) => {
      const start = chunkIndex * CHUNK_SIZE_BYTES;
      return { start, end: Math.min(start + CHUNK_SIZE_BYTES, file.size) };
    };

    const bytesUploading: Record<number, number> = {};
    let bytesCompleted = 0;

    const updateOverallProgress = () => {
      const uploadingSum = Object.values(bytesUploading).reduce((a, b) => a + b, 0);
      const progress = Math.round(((bytesCompleted + uploadingSum) / totalBytes) * 100);
      setUploadProgress(Math.min(100, Math.max(0, progress)));
    };

    const uploadChunkWithProgress = (chunkIndex: number, start: number, end: number) => {
      return new Promise<void>((resolve, reject) => {
        const attemptUpload = (attempt: number) => {
          const chunkBlob = file.slice(start, end);
          const formData = new FormData();
          formData.append('upload_id', uploadId);
          formData.append('chunk_index', String(chunkIndex));
          formData.append('total_chunks', String(totalChunks));
          formData.append('filename', file.name);
          formData.append('file', chunkBlob, file.name);
          formData.append('image_type', metadata.image_type);
          formData.append('geospatial_crs', metadata.geospatial_crs);
          formData.append('use_geo_metadata', String(metadata.use_geo_metadata));
          formData.append('pixel_scale_meters', metadata.pixel_scale_meters);
          formData.append('ref_latitude', metadata.ref_latitude);
          formData.append('ref_longitude', metadata.ref_longitude);
          formData.append('sam_use_fallback', String(metadata.sam_use_fallback));
          formData.append('sam_min_mask_region_area', metadata.sam_min_mask_region_area);
          formData.append('sam_points_per_side', metadata.sam_points_per_side);
          formData.append('sam_pred_iou_thresh', metadata.sam_pred_iou_thresh);
          formData.append('sam_stability_score_thresh', metadata.sam_stability_score_thresh);
          if (metadata.tfw_content) {
            formData.append('tfw_content', metadata.tfw_content);
          }

          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${API_CONFIG.baseURL}${API_CONFIG.endpoints.upload}/chunk`);
          xhr.timeout = 60000;

          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              bytesUploading[chunkIndex] = ev.loaded;
              updateOverallProgress();
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const chunkSize = end - start;
              bytesCompleted += chunkSize;
              delete bytesUploading[chunkIndex];
              updateOverallProgress();
              resolve();
            } else if (attempt < MAX_RETRIES) {
              setTimeout(() => attemptUpload(attempt + 1), 500 * (attempt + 1));
            } else {
              reject(new Error(`فشل في رفع الجزء ${chunkIndex + 1}: ${xhr.status} ${xhr.responseText}`));
            }
          };

          xhr.onerror = () => {
            if (attempt < MAX_RETRIES) {
              setTimeout(() => attemptUpload(attempt + 1), 500 * (attempt + 1));
            } else {
              reject(new Error('Network error أثناء رفع الجزء'));
            }
          };
          xhr.ontimeout = () => {
            if (attempt < MAX_RETRIES) {
              setTimeout(() => attemptUpload(attempt + 1), 500 * (attempt + 1));
            } else {
              reject(new Error('انتهت مهلة رفع الجزء'));
            }
          };
          xhr.onabort = () => reject(new Error('Upload aborted'));
          xhr.send(formData);
        };

        attemptUpload(0);
      });
    };

    const chunks: Array<{ idx: number; start: number; end: number }> = [];
    for (let idx = 0; idx < totalChunks; idx += 1) {
      const { start, end } = getChunkBounds(idx);
      chunks.push({ idx, start, end });
    }

    let active = 0;
    let pointer = 0;

    await new Promise<void>((resolve, reject) => {
      const runNext = () => {
        if (pointer >= chunks.length && active === 0) {
          resolve();
          return;
        }

        while (active < UPLOAD_CONCURRENCY && pointer < chunks.length) {
          const { idx, start, end } = chunks[pointer++];
          active += 1;
          bytesUploading[idx] = 0;
          uploadChunkWithProgress(idx, start, end)
            .then(() => {
              active -= 1;
              runNext();
            })
            .catch((err) => {
              reject(err);
            });
        }
      };

      runNext();
    });

    // finalize
    const completeForm = new FormData();
    completeForm.append('upload_id', uploadId);
    const completeResp = await fetch(`${API_CONFIG.baseURL}${API_CONFIG.endpoints.upload}/chunk/complete`, {
      method: 'POST',
      body: completeForm
    });

    if (!completeResp.ok) {
      const txt = await completeResp.text();
      throw new Error(`فشل إنهاء التحميل: ${completeResp.status} ${txt}`);
    }

    return completeResp.json();
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('land_agent_sam_settings');
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as SamSettings;
      setSamUseFallback(parsed.samUseFallback ?? false);
      setSamMinMaskRegionArea(parsed.samMinMaskRegionArea ?? '500');
      setSamPointsPerSide(parsed.samPointsPerSide ?? '16');
      setSamPredIoUThresh(parsed.samPredIoUThresh ?? '0.45');
      setSamStabilityScoreThresh(parsed.samStabilityScoreThresh ?? '0.30');
    } catch {
      return;
    }
  }, []);

  // cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current as number);
      }
    };
  }, []);

  // تحديث الإحداثيات تلقائياً عند تغيير المنطقة
  useEffect(() => {
    const region = regions.find(r => r.id === selectedRegion);
    if (region && region.coordinates) {
      setRefLatitude(String(region.coordinates[0]));
      setRefLongitude(String(region.coordinates[1]));
    }
  }, [selectedRegion]);

  // المناطق المتاحة (محافظات اليمن وهيئات الأوقاف)
  const regions = [
    { id: 'sanaa', name: 'أوقاف محافظة صنعاء', coordinates: [15.3694, 44.1910] },
    { id: 'ibb', name: 'أوقاف محافظة إب', coordinates: [13.9669, 44.1833] },
    { id: 'taiz', name: 'أوقاف محافظة تعز', coordinates: [13.5794, 44.0206] },
    { id: 'dhamar', name: 'أوقاف محافظة ذمار', coordinates: [14.5422, 44.4078] },
    { id: 'hodeidah', name: 'أوقاف محافظة الحديدة', coordinates: [14.7979, 42.9530] },
    { id: 'hadramout', name: 'أوقاف محافظة حضرموت', coordinates: [14.5147, 49.1242] },
    { id: 'custom', name: 'منطقة مخصصة (إدخال يدوي)', coordinates: null }
  ];

  // أنواع الملفات المدعومة
  const acceptedFiles: Record<string, string[]> = imageType === 'kml' ? {
    'application/vnd.google-earth.kml+xml': ['.kml'],
    'application/geo+json': ['.geojson', '.json']
  } : {
    'image/*': ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.geotiff']
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    if (imageType === 'kml') {
      const fileInfo = {
        name: file.name,
        size: (file.size / 1024).toFixed(2) + ' KB',
        type: file.type || 'KML/GeoJSON',
        lastModified: new Date(file.lastModified).toLocaleString('ar-SA'),
        region: selectedRegion,
        imageType,
      };
      setFileInfo(fileInfo);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('zoom', zoom);
      formData.append('tile_template', 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}');
      formData.append('country', 'Yemen');
      formData.append('sam_use_fallback', String(samUseFallback));
      formData.append('sam_min_mask_region_area', String(samMinMaskRegionArea));
      formData.append('sam_points_per_side', String(samPointsPerSide));
      formData.append('sam_pred_iou_thresh', String(samPredIoUThresh));
      formData.append('sam_stability_score_thresh', String(samStabilityScoreThresh));

      try {
        setUploadProgress(25);
        const response = await fetch(`${API_CONFIG.baseURL}/tasks/analyze/kml`, {
          method: 'POST',
          body: formData,
        });
        setUploadProgress(75);
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.detail || 'فشل إرسال ملف الخريطة للتحليل');
        }
        const result = await response.json();
        setUploadProgress(100);
        setTimeout(() => setIsUploading(false), 400);

        if (onUploadComplete) onUploadComplete(result);
        if (onProcessingStart) onProcessingStart();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'حدث خطأ غير معروف');
        setIsUploading(false);
        setUploadProgress(0);
      }
      return;
    }

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

    const uploadMetadata = {
      image_type: imageType,
      geospatial_crs: geoCrs,
      use_geo_metadata: useGeoMetadata,
      pixel_scale_meters: pixelScale,
      ref_latitude: refLatitude,
      ref_longitude: refLongitude,
      sam_use_fallback: samUseFallback,
      sam_min_mask_region_area: samMinMaskRegionArea,
      sam_points_per_side: samPointsPerSide,
      sam_pred_iou_thresh: samPredIoUThresh,
      sam_stability_score_thresh: samStabilityScoreThresh,
      tfw_content: tfwContent
    };

    const uploadId = buildUploadId();

    try {
      const result = await uploadFileChunks(file, uploadId, uploadMetadata);

      setUploadProgress(100);
      setTimeout(() => setIsUploading(false), 400);

      if (onUploadComplete) onUploadComplete(result);
      if (onProcessingStart) onProcessingStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير معروف');
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [selectedRegion, imageType, zoom, pixelScale, refLatitude, refLongitude, geoCrs, useGeoMetadata, samUseFallback, samMinMaskRegionArea, samPointsPerSide, samPredIoUThresh, samStabilityScoreThresh, onUploadComplete, onProcessingStart]);

  const uploadRemoteUrl = useCallback(async () => {
    if (!remoteUrl.trim()) {
      setError('الرجاء إدخال رابط الملف');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    setFileInfo({
      name: remoteUrl,
      size: '??',
      type: 'remote',
      lastModified: new Date().toLocaleString('ar-SA'),
      region: selectedRegion,
      imageType,
      geoCrs,
      useGeoMetadata
    });

    const formData = new FormData();
    formData.append('remote_url', remoteUrl.trim());
    formData.append('image_type', imageType);
    formData.append('geospatial_crs', geoCrs);
    formData.append('use_geo_metadata', String(useGeoMetadata));
    formData.append('pixel_scale_meters', pixelScale);
    formData.append('ref_latitude', refLatitude);
    formData.append('ref_longitude', refLongitude);
    formData.append('sam_use_fallback', String(samUseFallback));
    formData.append('sam_min_mask_region_area', samMinMaskRegionArea);
    formData.append('sam_points_per_side', samPointsPerSide);
    formData.append('sam_pred_iou_thresh', samPredIoUThresh);
    formData.append('sam_stability_score_thresh', samStabilityScoreThresh);

    try {
      const response = await fetch(`${API_CONFIG.baseURL}${API_CONFIG.endpoints.upload}/remote`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`فشل إرسال الرابط: ${response.status} ${text}`);
      }

      const result = await response.json();
      const taskId = result?.task_id;

      // start polling messages to show download progress
      if (taskId) {
        if (pollRef.current !== null) {
          clearInterval(pollRef.current as number);
        }

        pollRef.current = window.setInterval(async () => {
          try {
            const statusResp = await fetch(`${API_CONFIG.baseURL}${API_CONFIG.endpoints.status.replace('{task_id}', taskId)}`);
            let statusJson: any = null;

            if (statusResp.ok) {
              statusJson = await statusResp.json();
              const st = statusJson.status;
              if (st === 'COMPLETED' || st === 'FAILED') {
                if (pollRef.current !== null) {
                  clearInterval(pollRef.current as number);
                  pollRef.current = null;
                }
                setUploadProgress(100);
              }
            }

            const msgResp = await fetch(`${API_CONFIG.baseURL}/tasks/${taskId}/messages`);
            if (msgResp.ok) {
              const msgsJson = await msgResp.json();
              const msgs = msgsJson.messages || [];
              let lastDownloadMsg: any = null;
              let lastErrorMsg: string | null = null;

              for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (!lastErrorMsg && (m.message_type === 'ERROR' || m.message_type === 'FAILED')) {
                  lastErrorMsg = m.content;
                }
                if (!lastDownloadMsg && m.message_type === 'DOWNLOAD_PROGRESS') {
                  lastDownloadMsg = m;
                }
                if (lastErrorMsg && lastDownloadMsg) break;
              }

              if (lastDownloadMsg) {
                const p = lastDownloadMsg.payload || {};
                if (p.percent != null) {
                  setUploadProgress(p.percent);
                } else if (p.total && p.downloaded) {
                  setUploadProgress(Math.round((p.downloaded / p.total) * 100));
                }
              }

              if (statusJson?.status === 'FAILED' && lastErrorMsg) {
                setError(`فشلت مهمة التحميل: ${lastErrorMsg}`);
              }
            }
          } catch (e) {
            // ignore polling errors, keep attempting
          }
        }, 1500);
      }

      if (!taskId) {
        setUploadProgress(100);
        setTimeout(() => setIsUploading(false), 400);
      }

      if (onUploadComplete) onUploadComplete(result);
      if (onProcessingStart) onProcessingStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير معروف أثناء إرسال الرابط');
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [remoteUrl, selectedRegion, imageType, pixelScale, refLatitude, refLongitude, geoCrs, useGeoMetadata, samUseFallback, samMinMaskRegionArea, samPointsPerSide, samPredIoUThresh, samStabilityScoreThresh, onUploadComplete, onProcessingStart]);

  const onDropRejected = useCallback((fileRejections: any[]) => {
    try {
      const reasons = fileRejections.map(fr => fr.errors.map((e: any) => e.message).join('; ')).join('; ');
      setError(`الملف مرفوض: ${reasons}`);
    } catch {
      setError('الملف مرفوض أو غير مدعوم.');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: acceptedFiles,
    maxSize: 1024 * 1024 * 1024, // 1 جيجابايت
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
          <button
            type="button"
            onClick={() => { setImageType('kml'); setUploadMode('file'); }}
            disabled={isUploading}
            className={`px-4 py-2 rounded-lg border text-sm font-medium ${imageType === 'kml' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-blue-500'}`}
          >
            📁 تحليل KML / GeoJSON فوري
          </button>
        </div>
        <p className="text-sm text-slate-500">
          {imageType === 'kml' 
            ? 'ارفع ملف KML أو GeoJSON صغير للمنطقة، وسيجلب السيرفر صور القمر الصناعي ويبدأ تحليلها فوراً!' 
            : 'اختر إذا كانت الصورة تحتوي على بيانات جغرافية مضمنة أو تحتاج إدخال بيانات الإسقاط يدوياً.'}
        </p>
      </div>

      {/* إعدادات القياس والإحداثيات */}
      {imageType !== 'kml' ? (
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
              <label className="block text-sm text-slate-700 mt-4">
                <span className="block mb-1">ملف الإحداثيات المصاحب (TFW / World File) - اختياري</span>
                <input
                  type="file"
                  accept=".tfw,.jgw,.pgw,.wld"
                  onChange={handleTfwFileChange}
                  disabled={isUploading}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </label>
              <p className="text-xs text-slate-500 mt-3">
                إذا كان الملف يحتوي على بيانات جغرافية، سيحاول النظام استخدامها؛ وإلا سيعتمد على القيم اليدوية أعلاه.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-6 grid gap-4 lg:grid-cols-1">
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <h3 className="font-semibold text-slate-800 mb-3">إعدادات خريطة القمر الصناعي</h3>
            <label className="block mb-3 text-sm text-slate-700">
              <span className="block mb-1">مستوى دقة القمر الصناعي (Zoom Level)</span>
              <input
                type="number"
                value={zoom}
                onChange={(e) => setZoom(e.target.value)}
                min="14"
                max="21"
                disabled={isUploading}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-[10px] text-slate-400 block mt-1">مستوى التقريب الافتراضي هو 18 (يعطي دقة 0.5 متر لكل بكسل تقريباً).</span>
            </label>
          </div>
        </div>
      )}

      {/* معلومات النظام */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h3 className="font-semibold text-blue-800 mb-2">📋 مواصفات الرفع:</h3>
        {imageType === 'kml' ? (
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• <strong>الحجم الأقصى:</strong> 10 ميجابايت</li>
            <li>• <strong>الصيغ المدعومة:</strong> KML, GeoJSON, JSON</li>
            <li>• <strong>سرعة التحليل:</strong> فائقة السرعة (بين 10-20 ثانية)</li>
            <li>• <strong>نظام الإحداثيات:</strong> WGS 84 (EPSG:4326)</li>
          </ul>
        ) : (
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• <strong>الحجم الأقصى:</strong> 1 جيجابايت</li>
            <li>• <strong>الصيغ المدعومة:</strong> JPG, PNG, TIFF, GeoTIFF</li>
            <li>• <strong>وقت المعالجة:</strong> 120 ثانية كحد أقصى (من PDF)</li>
            <li>• <strong>نظام الإحداثيات:</strong> WGS 84 (EPSG:4326)</li>
            <li>• <strong>إعدادات SAM:</strong> يتم تحميلها من صفحة <Link href="/settings" className="text-blue-700 underline">الإعدادات</Link></li>
          </ul>
        )}
      </div>

      {imageType !== 'kml' && (
        <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-3">وضع الرفع</h3>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setUploadMode('file')}
              disabled={isUploading}
              className={`px-4 py-2 rounded-lg border text-sm font-medium ${uploadMode === 'file' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-blue-500'}`}
            >
              رفع ملف
            </button>
            <button
              type="button"
              onClick={() => setUploadMode('url')}
              disabled={isUploading}
              className={`px-4 py-2 rounded-lg border text-sm font-medium ${uploadMode === 'url' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:border-blue-500'}`}
            >
              رابط خارجي
            </button>
          </div>
          <p className="text-sm text-slate-500 mt-3">
            اختر رفع الملف مباشرةً إذا كان صغيراً، أو استخدم رابط الملف إذا كان كبيراً أو موجوداً في الخدمة السحابية.
          </p>
        </div>
      )}

      {uploadMode === 'url' ? (
        <div className="mb-6 p-6 bg-white rounded-2xl shadow-sm border border-slate-200">
          <label className="block text-sm text-slate-700 mb-3">
            <span className="block mb-1">أدخل رابط Google Drive أو رابط خارجي</span>
            <input
              type="url"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              disabled={isUploading}
              placeholder="https://drive.google.com/..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <button
            type="button"
            onClick={uploadRemoteUrl}
            disabled={isUploading || !remoteUrl.trim()}
            className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            استيراد من Google Drive / رابط خارجي
          </button>
          <p className="text-xs text-slate-500 mt-3">
            في هذا الوضع، سيقوم السيرفر بسحب الملف من Google Drive أو المصدر الخارجي بدون رفعه من جهازك.
          </p>
        </div>
      ) : (
        <div className="mb-6">
          <label className="block text-gray-700 mb-2 font-medium">
            {imageType === 'kml' ? 'اختر ملف KML أو GeoJSON للمنطقة' : 'اختر صورة جوية'}
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
                <p className="text-gray-600 font-medium">جاري رفع ومعالجة الملف...</p>
                
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
                  {imageType === 'kml' ? 'يدعم: KML, GeoJSON, JSON' : 'يدعم: JPG, PNG, TIFF, GeoTIFF'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {imageType === 'kml' ? '(حتى 10 ميجابايت)' : '(حتى 1 جيجابايت)'}
                </p>
              </>
            )}
          </div>
        </div>
      )}

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
          <div className="mt-3">
            <button
              onClick={() => setError(null)}
              className="text-sm text-red-600 hover:text-red-800"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
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