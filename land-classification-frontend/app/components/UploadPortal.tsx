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
  const [samPredIoUThresh, setSamPredIoUThresh] = useState('0.45');
  const [samStabilityScoreThresh, setSamStabilityScoreThresh] = useState('0.30');
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
          if (metadata.styling) {
            formData.append('styling', JSON.stringify(metadata.styling));
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
    completeForm.append('image_type', metadata.image_type);
    completeForm.append('geospatial_crs', metadata.geospatial_crs);
    completeForm.append('use_geo_metadata', String(metadata.use_geo_metadata));
    completeForm.append('pixel_scale_meters', String(metadata.pixel_scale_meters));
    completeForm.append('ref_latitude', String(metadata.ref_latitude));
    completeForm.append('ref_longitude', String(metadata.ref_longitude));
    completeForm.append('sam_use_fallback', String(metadata.sam_use_fallback));
    completeForm.append('sam_min_mask_region_area', String(metadata.sam_min_mask_region_area));
    completeForm.append('sam_points_per_side', String(metadata.sam_points_per_side));
    completeForm.append('sam_pred_iou_thresh', String(metadata.sam_pred_iou_thresh));
    completeForm.append('sam_stability_score_thresh', String(metadata.sam_stability_score_thresh));
    if (metadata.tfw_content) {
      completeForm.append('tfw_content', metadata.tfw_content);
    }
    if (metadata.styling) {
      completeForm.append('styling', JSON.stringify(metadata.styling));
    }
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
      tfw_content: tfwContent,
      styling: (() => {
        try {
          const stored = window.localStorage.getItem('map_style_settings');
          return stored ? JSON.parse(stored) : null;
        } catch { return null; }
      })()
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
    <div className="engineering-glass glass-glow-cyan p-8 rounded-3xl relative">
      <h2 className="text-xl font-bold mb-6 text-white flex items-center gap-2">
        <span>📥</span> بوابة استيراد وتوجيه البيانات الجغرافية
      </h2>

      {/* اختيار نوع الصورة */}
      <div className="mb-6 p-5 bg-slate-950/50 rounded-2xl border border-slate-800">
        <p className="font-semibold text-slate-200 mb-3 text-sm">نوع الصورة والمخطط الجغرافي</p>
        <div className="flex flex-wrap gap-3 mb-3">
          <button
            type="button"
            onClick={() => setImageType('regular')}
            disabled={isUploading}
            className={`px-4 py-2 rounded-xl border text-xs font-semibold transition ${imageType === 'regular' ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold' : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-cyan-500/50 hover:text-white'}`}
          >
            صورة عادية (أبعاد مترية)
          </button>
          <button
            type="button"
            onClick={() => setImageType('geospatial')}
            disabled={isUploading}
            className={`px-4 py-2 rounded-xl border text-xs font-semibold transition ${imageType === 'geospatial' ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold' : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-cyan-500/50 hover:text-white'}`}
          >
            صورة جغرافية مسقطة
          </button>
          <button
            type="button"
            onClick={() => { setImageType('kml'); setUploadMode('file'); }}
            disabled={isUploading}
            className={`px-4 py-2 rounded-xl border text-xs font-semibold transition ${imageType === 'kml' ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold' : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-cyan-500/50 hover:text-white'}`}
          >
            📁 تحليل KML / GeoJSON فوري
          </button>
        </div>
        <p className="text-xs text-slate-400">
          {imageType === 'kml' 
            ? 'ارفع ملف KML أو GeoJSON صغير للمنطقة، وسيجلب السيرفر صور القمر الصناعي ويبدأ تحليلها فوراً!' 
            : 'اختر إذا كانت الصورة تحتوي على بيانات جغرافية مضمنة أو تحتاج إدخال بيانات الإسقاط يدوياً.'}
        </p>
      </div>

      {/* إعدادات القياس والإحداثيات */}
      {imageType !== 'kml' ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <div className="p-5 bg-slate-950/50 rounded-2xl border border-slate-800">
            <h3 className="font-semibold text-slate-200 mb-4 text-xs tracking-wider uppercase text-cyan-400">📐 معايير الصورة القياسية</h3>
            
            <label className="block mb-3 text-xs text-slate-300">
              <span className="block mb-1.5 text-slate-400">مقياس البكسل (متر لكل بكسل)</span>
              <input
                type="number"
                value={pixelScale}
                onChange={(e) => setPixelScale(e.target.value)}
                step="0.01"
                min="0.01"
                disabled={isUploading}
                className="w-full bg-slate-900 rounded-xl border border-slate-800 px-3 py-2 text-white font-mono-tech text-sm focus:outline-none focus:border-cyan-500 transition"
              />
            </label>
            
            <label className="block mb-3 text-xs text-slate-300">
              <span className="block mb-1.5 text-slate-400">خط العرض المرجعي (Center Lat)</span>
              <input
                type="number"
                value={refLatitude}
                onChange={(e) => setRefLatitude(e.target.value)}
                step="0.0001"
                disabled={isUploading}
                className="w-full bg-slate-900 rounded-xl border border-slate-800 px-3 py-2 text-white font-mono-tech text-sm focus:outline-none focus:border-cyan-500 transition"
              />
            </label>
            
            <label className="block text-xs text-slate-300">
              <span className="block mb-1.5 text-slate-400">خط الطول المرجعي (Center Lon)</span>
              <input
                type="number"
                value={refLongitude}
                onChange={(e) => setRefLongitude(e.target.value)}
                step="0.0001"
                disabled={isUploading}
                className="w-full bg-slate-900 rounded-xl border border-slate-800 px-3 py-2 text-white font-mono-tech text-sm focus:outline-none focus:border-cyan-500 transition"
              />
            </label>
          </div>

          {imageType === 'geospatial' && (
            <div className="p-5 bg-slate-950/50 rounded-2xl border border-slate-800">
              <h3 className="font-semibold text-slate-200 mb-4 text-xs tracking-wider uppercase text-cyan-400">🌐 الإسقاط الجغرافي للمهمة</h3>
              
              <label className="flex items-center gap-3 mb-4 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useGeoMetadata}
                  onChange={(e) => setUseGeoMetadata(e.target.checked)}
                  disabled={isUploading}
                  className="h-4 w-4 rounded border-slate-800 bg-slate-900 text-cyan-500 focus:ring-cyan-500/20 focus:ring-offset-slate-950"
                />
                <span>استخدام بيانات GeoTIFF المضمنة إذا كانت متاحة (تلقائي)</span>
              </label>
              
              <label className="block text-xs text-slate-300 mb-3">
                <span className="block mb-1.5 text-slate-400">نظام الإحداثيات المرجعي (CRS)</span>
                <input
                  type="text"
                  value={geoCrs}
                  onChange={(e) => setGeoCrs(e.target.value)}
                  disabled={isUploading}
                  className="w-full bg-slate-900 rounded-xl border border-slate-800 px-3 py-2 text-white font-mono-tech text-sm focus:outline-none focus:border-cyan-500 transition"
                />
              </label>
              
              <label className="block text-xs text-slate-300">
                <span className="block mb-1.5 text-slate-400">ملف الإحداثيات المصاحب (TFW / World File) - اختياري</span>
                <input
                  type="file"
                  accept=".tfw,.jgw,.pgw,.wld"
                  onChange={handleTfwFileChange}
                  disabled={isUploading}
                  className="w-full bg-slate-900 rounded-xl border border-slate-800 px-3 py-2 text-slate-400 focus:outline-none focus:border-cyan-500 transition text-xs"
                />
              </label>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-6 grid gap-4 lg:grid-cols-1">
          <div className="p-5 bg-slate-950/50 rounded-2xl border border-slate-800">
            <h3 className="font-semibold text-slate-200 mb-4 text-xs tracking-wider uppercase text-cyan-400">🛰️ إعدادات خريطة القمر الصناعي</h3>
            <label className="block text-xs text-slate-300">
              <span className="block mb-1.5 text-slate-400">مستوى دقة القمر الصناعي (Zoom Level)</span>
              <input
                type="number"
                value={zoom}
                onChange={(e) => setZoom(e.target.value)}
                min="14"
                max="21"
                disabled={isUploading}
                className="w-full bg-slate-900 rounded-xl border border-slate-800 px-3 py-2 text-white font-mono-tech text-sm focus:outline-none focus:border-cyan-500 transition"
              />
              <span className="text-[10px] text-slate-500 block mt-1.5">مستوى التقريب الافتراضي هو 18 (يعطي دقة 0.5 متر لكل بكسل تقريباً).</span>
            </label>
          </div>
        </div>
      )}

      {/* مواصفات الرفع الفنية */}
      <div className="mb-6 p-4 bg-cyan-950/20 border border-cyan-800/30 rounded-2xl">
        <h3 className="font-semibold text-cyan-300 mb-2 text-xs">📋 مواصفات ومحددات الاستيراد الفنية:</h3>
        {imageType === 'kml' ? (
          <ul className="text-xs text-slate-400 space-y-1">
            <li>• <strong className="text-cyan-400">الحجم الأقصى لملف المسح:</strong> 10 ميجابايت</li>
            <li>• <strong className="text-cyan-400">التنسيقات المدعومة:</strong> KML, GeoJSON, JSON</li>
            <li>• <strong className="text-cyan-400">سرعة التحليل المترية:</strong> فائقة السرعة (بين 10-20 ثانية)</li>
            <li>• <strong className="text-cyan-400">نظام الإحداثيات المستهدف:</strong> WGS 84 (EPSG:4326)</li>
          </ul>
        ) : (
          <ul className="text-xs text-slate-400 space-y-1">
            <li>• <strong className="text-cyan-400">الحجم الأقصى للصورة الجوية:</strong> 1 جيجابايت (Chunked Upload مفعل)</li>
            <li>• <strong className="text-cyan-400">التنسيقات المدعومة:</strong> JPG, PNG, TIFF, GeoTIFF</li>
            <li>• <strong className="text-cyan-400">وقت المعالجة المترية:</strong> 120 ثانية كحد أقصى</li>
            <li>• <strong className="text-cyan-400">إعدادات ذكاء SAM:</strong> يتم ربطها من إعدادات النظام المخصصة</li>
          </ul>
        )}
      </div>

      {imageType !== 'kml' && (
        <div className="mb-6 p-5 bg-slate-950/50 rounded-2xl border border-slate-800">
          <h3 className="font-semibold text-slate-200 mb-3 text-xs">وضع وقناة استيراد الملف</h3>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setUploadMode('file')}
              disabled={isUploading}
              className={`px-4 py-2 rounded-xl border text-xs font-semibold transition ${uploadMode === 'file' ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold' : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-cyan-500/50 hover:text-white'}`}
            >
              تحميل ملف محلي من الجهاز
            </button>
            <button
              type="button"
              onClick={() => setUploadMode('url')}
              disabled={isUploading}
              className={`px-4 py-2 rounded-xl border text-xs font-semibold transition ${uploadMode === 'url' ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold' : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-cyan-500/50 hover:text-white'}`}
            >
              رابط سحابي خارجي (Google Drive)
            </button>
          </div>
        </div>
      )}

      {uploadMode === 'url' ? (
        <div className="mb-6 p-5 bg-slate-950/50 rounded-2xl border border-slate-800">
          <label className="block text-xs text-slate-300 mb-4">
            <span className="block mb-2 text-slate-400">أدخل رابط Google Drive أو رابط خارجي للملف</span>
            <input
              type="url"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              disabled={isUploading}
              placeholder="https://drive.google.com/..."
              className="w-full bg-slate-900 rounded-xl border border-slate-800 px-3 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition text-sm font-mono-tech"
            />
          </label>
          <button
            type="button"
            onClick={uploadRemoteUrl}
            disabled={isUploading || !remoteUrl.trim()}
            className="px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <span>🔗</span> استيراد ومعالجة من الرابط
          </button>
        </div>
      ) : (
        <div className="mb-6">
          <label className="block text-slate-300 mb-2.5 text-xs font-semibold">
            {imageType === 'kml' ? 'ملف الرفع المساحي KML أو GeoJSON' : 'ملف الصورة الجوية'}
          </label>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center transition cursor-pointer relative ${
              isDragActive
                ? 'border-cyan-400 bg-cyan-950/20'
                : 'border-slate-800 hover:border-cyan-500/40 bg-slate-950/30'
            } ${isUploading ? 'opacity-50 cursor-not-allowed radar-sweep' : ''}`}
          >
            <input {...getInputProps()} disabled={isUploading} />
            
            {isUploading ? (
              <div className="space-y-4 relative z-10">
                <div className="w-12 h-12 mx-auto relative">
                  <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-400"></div>
                </div>
                <p className="text-cyan-400 font-medium text-sm">جاري رفع ومعالجة الملف على خادم GIS...</p>
                
                {/* شريط التقدم النيوني */}
                <div className="max-w-xs mx-auto bg-slate-900 rounded-full h-2 border border-slate-800 overflow-hidden">
                  <div
                    className="bg-cyan-400 h-full rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="text-xs font-mono-tech text-slate-400">{uploadProgress}%</p>
              </div>
            ) : (
              <div className="py-2">
                <span className="text-4xl block mb-3 text-slate-500">📤</span>
                <p className="text-sm text-slate-200 font-semibold">
                  {isDragActive ? 'أفلت الملف هنا للتشخيص المساحي...' : 'اسحب ملف القياس هنا أو انقر لاختياره'}
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  {imageType === 'kml' ? 'التنسيقات: KML, GeoJSON, JSON' : 'التنسيقات: JPG, PNG, TIFF, GeoTIFF'}
                </p>
                <p className="text-[10px] text-slate-600 mt-1">
                  {imageType === 'kml' ? '(الحد الأقصى: 10 ميجابايت)' : '(الحد الأقصى: 1 جيجابايت)'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* اختيار منطقة الدراسة */}
      <div className="mb-6">
        <label className="block text-slate-300 mb-2 text-xs font-semibold">
          منطقة الدراسة والأوقاف الجغرافية المرجعية
        </label>
        <select
          value={selectedRegion}
          onChange={(e) => setSelectedRegion(e.target.value)}
          className="w-full p-3 bg-slate-900 border border-slate-800 text-slate-300 rounded-xl focus:outline-none focus:border-cyan-500 transition text-xs"
          disabled={isUploading}
        >
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-slate-500 mt-1.5">
          يساعد في توجيه إسقاط الإحداثيات تلقائياً وضبط الخرائط المرجعية للمحافظات
        </p>
      </div>

      {/* معلومات تشخيص الملف بعد الاختيار */}
      {fileInfo && (
        <div className="mb-6 p-4 bg-emerald-950/20 border border-emerald-800/40 rounded-2xl">
          <h4 className="font-semibold text-emerald-400 mb-2 text-xs flex items-center gap-1.5">
            <span>✓</span> تم تشخيص وتجهيز الملف للمهمة
          </h4>
          <div className="space-y-1.5 text-xs text-slate-400 font-mono-tech">
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span>اسم الملف:</span>
              <span className="text-slate-200">{fileInfo.name}</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span>الحجم الكلي:</span>
              <span className="text-slate-200">{fileInfo.size} MB</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span>القناة المستخدمة:</span>
              <span className="text-slate-200">{fileInfo.type}</span>
            </div>
            <div className="flex justify-between">
              <span>نطاق المنطقة المحددة:</span>
              <span className="text-slate-200">
                {regions.find(r => r.id === fileInfo.region)?.name}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* رسائل خطأ تشخيص البيانات */}
      {error && (
        <div className="mb-6 p-4 bg-red-950/20 border border-red-800/40 rounded-2xl">
          <h4 className="font-semibold text-red-400 mb-1.5 text-xs flex items-center gap-1.5">
            <span>⚠️</span> خطأ تشخيص البيانات
          </h4>
          <p className="text-xs text-slate-400 leading-relaxed">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-[10px] text-red-400 hover:text-red-300 underline mt-2"
          >
            تجاهل الخطأ وإغلاق
          </button>
        </div>
      )}
    </div>
  );
}