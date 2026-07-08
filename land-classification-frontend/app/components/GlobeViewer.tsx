"use client";

import { useEffect, useRef, useState } from "react";
import { API_CONFIG } from "@/app/lib/map-config";

const CESIUM_JS = "https://cesium.com/downloads/cesiumjs/releases/1.129/Build/Cesium/Cesium.js";
const CESIUM_CSS = "https://cesium.com/downloads/cesiumjs/releases/1.129/Build/Cesium/Widgets/widgets.css";

const NASA_GIBS_DEFAULT_LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor";
const NASA_GIBS_TILE_MATRIX = "GoogleMapsCompatible";

const IMAGERY_PROVIDERS = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    description: 'خريطة الشوارع العالمية',
  },
  {
    id: 'esri',
    label: 'Esri World Imagery',
    description: 'صور أقمار صناعية عالية الدقة',
  },
  {
    id: 'google',
    label: 'Google Satellite',
    description: 'Google Satellite عبر رابط   للـ tiles',
  },
  {
    id: 'gibs_truecolor',
    label: 'NASA GIBS TrueColor',
    description: 'صور الأقمار الصناعية NASA GIBS',
  },
  {
    id: 'gibs_viirs',
    label: 'NASA GIBS VIIRS',
    description: 'صور الأقمار الصناعية VIIRS اليومية',
  }
];

const loadCss = (href: string) => {
  if (document.querySelector(`link[href='${href}']`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
};

const loadScript = (src: string) => {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).Cesium) {
      resolve();
      return;
    }

    const existing = document.querySelector(`script[src='${src}']`);
    if (existing) {
      const interval = setInterval(() => {
        if ((window as any).Cesium) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      const interval = setInterval(() => {
        if ((window as any).Cesium) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    };
    script.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.body.appendChild(script);
  });
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function GlobeViewer({ taskId }: { taskId?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const selectionRef = useRef<HTMLDivElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [exportLink, setExportLink] = useState<string | null>(null);
  const [lat, setLat] = useState(24.7136);
  const [lon, setLon] = useState(46.6753);
  const [date, setDate] = useState(formatDate(new Date()));
  const [selectedProvider, setSelectedProvider] = useState<string>('google');
  const [selectedLayer, setSelectedLayer] = useState<string>(NASA_GIBS_DEFAULT_LAYER);
  const [tileZoom, setTileZoom] = useState<number>(17);
  const [statusMessage, setStatusMessage] = useState<string>("تحميل واجهة العرض...");
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const createImageryProvider = (providerId: string) => {
    const Cesium = (window as any).Cesium;
    if (!Cesium) return null;

    switch (providerId) {
      case 'osm':
        return new Cesium.OpenStreetMapImageryProvider({
          url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          credit: 'OpenStreetMap contributors',
        });
      case 'esri':
        return new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          credit: 'Esri World Imagery',
          maximumLevel: 19,
        });
      case 'google':
        return new Cesium.UrlTemplateImageryProvider({
          url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
          credit: 'Google Satellite',
          maximumLevel: 20,
        });
      case 'gibs_truecolor':
        return new Cesium.UrlTemplateImageryProvider({
          url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${NASA_GIBS_DEFAULT_LAYER}/default/${date}/${NASA_GIBS_TILE_MATRIX}/{z}/{y}/{x}.jpg`,
          credit: 'NASA GIBS',
          maximumLevel: 8,
        });
      case 'gibs_viirs':
        return new Cesium.UrlTemplateImageryProvider({
          url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/${NASA_GIBS_TILE_MATRIX}/{z}/{y}/{x}.jpg`,
          credit: 'NASA GIBS VIIRS',
          maximumLevel: 8,
        });
      default:
        return new Cesium.OpenStreetMapImageryProvider({
          url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          credit: 'OpenStreetMap contributors',
        });
    }
  };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        loadCss(CESIUM_CSS);
        await loadScript(CESIUM_JS);
        if (!mounted || !containerRef.current || !(window as any).Cesium) return;

        const Cesium = (window as any).Cesium;
        const imageryProvider = createImageryProvider(selectedProvider);
        if (!imageryProvider) {
          throw new Error('Unable to create imagery provider');
        }

        viewerRef.current = new Cesium.Viewer(containerRef.current, {
          imageryProvider,
          baseLayerPicker: false,
          timeline: false,
          animation: false,
          fullscreenButton: true,
          infoBox: true,
          selectionIndicator: true,
          sceneModePicker: true,
          navigationHelpButton: false,
          homeButton: true,
          vrButton: false,
          geocoder: false,
          scene3DOnly: true,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        });

        // التأكد من أن قوقل ماب هو طبقة الخلفية الافتراضية وإزالة الطبقات الافتراضية الأخرى
        const layers = viewerRef.current.imageryLayers;
        layers.removeAll();
        layers.addImageryProvider(imageryProvider);

        viewerRef.current.scene.globe.enableLighting = true;
        viewerRef.current.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 4_000_000),
        });

        if (taskId) {
          setStatusMessage("تحميل طبقة المعالم للمهمة...");
          try {
            const reportUrl = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.report.replace('{task_id}', taskId)}`;
            const response = await fetch(reportUrl);
            if (response.ok) {
              const taskReport = await response.json();
              if (taskReport.geojson) {
                const dataSource = await Cesium.GeoJsonDataSource.load(taskReport.geojson, {
                  stroke: Cesium.Color.YELLOW,
                  fill: Cesium.Color.YELLOW.withAlpha(0.2),
                  strokeWidth: 1,
                });
                viewerRef.current.dataSources.add(dataSource);
                const center = taskReport.map_center;
                if (center) {
                  viewerRef.current.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(center[1], center[0], 2500),
                    orientation: { pitch: Cesium.Math.toRadians(-45) },
                  });
                }
                setStatusMessage("تم تحميل طبقة المعالم بنجاح.");
              } else {
                setStatusMessage("لا توجد طبقة معالم للمهمة المحددة.");
              }
            } else {
              setStatusMessage("فشل في جلب بيانات المهمة.");
            }
          } catch (error) {
            console.warn(error);
            setStatusMessage("خطأ أثناء تحميل طبقة المعالم.");
          }
        } else {
          setStatusMessage("تم تحميل الخريطة العالمية بنجاح.");
        }

        setIsLoaded(true);
      } catch (error) {
        console.error(error);
        setStatusMessage("فشل تحميل Cesium أو طبقة العرض.");
      }
    };

    init();
    return () => {
      mounted = false;
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [taskId]);

  // أحداث التحديد باستخدام Cesium ScreenSpaceEventHandler
  useEffect(() => {
    const container = containerRef.current;
    const Cesium = (window as any).Cesium;
    if (!viewerRef.current || !Cesium || !container) return;
    const canvas = viewerRef.current.scene.canvas;
    if (!canvas) return;

    const getPointer = (position: any) => {
      const rect = container.getBoundingClientRect();
      return {
        x: position.x - rect.left,
        y: position.y - rect.top
      };
    };

    const handler = new Cesium.ScreenSpaceEventHandler(canvas);

    handler.setInputAction((movement: any) => {
      if (!selecting) return;
      const pos = getPointer(movement.position);
      setStartPoint(pos);
      if (selectionRef.current) {
        selectionRef.current.style.left = `${pos.x}px`;
        selectionRef.current.style.top = `${pos.y}px`;
        selectionRef.current.style.width = `0px`;
        selectionRef.current.style.height = `0px`;
        selectionRef.current.style.display = 'block';
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((movement: any) => {
      if (!selecting || !startPoint || !selectionRef.current) return;
      const pos = getPointer(movement.endPosition || movement.position);
      const left = Math.min(startPoint.x, pos.x);
      const top = Math.min(startPoint.y, pos.y);
      const width = Math.abs(startPoint.x - pos.x);
      const height = Math.abs(startPoint.y - pos.y);
      selectionRef.current.style.left = `${left}px`;
      selectionRef.current.style.top = `${top}px`;
      selectionRef.current.style.width = `${width}px`;
      selectionRef.current.style.height = `${height}px`;
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction((movement: any) => {
      if (!selecting || !startPoint || !selectionRef.current) return;
      const rect = selectionRef.current.getBoundingClientRect();
      const parentRect = container.getBoundingClientRect();
      const relativeRect = new DOMRect(rect.left - parentRect.left, rect.top - parentRect.top, rect.width, rect.height);
      setSelectionRect(relativeRect);
      setSelecting(false);
      setStartPoint(null);
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    return () => {
      handler.destroy();
    };
  }, [selecting, startPoint, isLoaded]);

  // تعطيل تحكم الكاميرا في Cesium أثناء التحديد لمنع السحب
  useEffect(() => {
    if (!viewerRef.current) return;
    try {
      const sc = viewerRef.current.scene.screenSpaceCameraController;
      if (selecting) {
        sc.enableRotate = false;
        sc.enableTranslate = false;
        sc.enableTilt = false;
        sc.enableZoom = false;
        sc.enableLook = false;
      } else {
        sc.enableRotate = true;
        sc.enableTranslate = true;
        sc.enableTilt = true;
        sc.enableZoom = true;
        sc.enableLook = true;
      }
    } catch (e) {
      // ignore
    }
  }, [selecting]);

  const toggleFullscreen = async () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      try { await el.requestFullscreen(); } catch (e) { console.warn(e); }
    } else {
      try { await document.exitFullscreen(); } catch (e) { console.warn(e); }
    }
  };

  const getLonLatFromScreen = (x: number, y: number) => {
    const Cesium = (window as any).Cesium;
    if (!viewerRef.current || !Cesium) return null;
    const cartesian = viewerRef.current.scene.camera.pickEllipsoid(
      new Cesium.Cartesian2(x, y),
      viewerRef.current.scene.globe.ellipsoid
    );
    if (!cartesian) return null;
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    return {
      lon: Cesium.Math.toDegrees(cartographic.longitude),
      lat: Cesium.Math.toDegrees(cartographic.latitude)
    };
  };

  const saveSelectionAsTiff = async () => {
    try {
      if (!selectionRect) {
        throw new Error('يرجى تحديد منطقة للقص أولاً.');
      }

      const topLeft = getLonLatFromScreen(selectionRect.x, selectionRect.y);
      const bottomRight = getLonLatFromScreen(selectionRect.x + selectionRect.width, selectionRect.y + selectionRect.height);
      if (!topLeft || !bottomRight) {
        throw new Error('تعذر تحويل الحقول المحددة إلى إحداثيات جغرافية. حاول اختيار منطقة أقرب إلى سطح الكرة الأرضية.');
      }

      const minLon = Math.min(topLeft.lon, bottomRight.lon);
      const maxLon = Math.max(topLeft.lon, bottomRight.lon);
      const minLat = Math.min(topLeft.lat, bottomRight.lat);
      const maxLat = Math.max(topLeft.lat, bottomRight.lat);
      const base = API_CONFIG.baseURL || 'http://localhost:8000';

      if (taskId) {
        const downloadUrl = `${base}/tasks/${taskId}/crop?min_lon=${encodeURIComponent(minLon)}&min_lat=${encodeURIComponent(minLat)}&max_lon=${encodeURIComponent(maxLon)}&max_lat=${encodeURIComponent(maxLat)}`;
        setExportLink(downloadUrl);
        window.open(downloadUrl, '_blank');
        return;
      }

      // بدون taskId: استخدم تركيب البلاطات من مصدر الصور الحالي
      const getTileTemplate = () => {
        switch (selectedProvider) {
          case 'osm':
            return 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png';
          case 'esri':
            return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
          case 'google':
            return 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
          case 'gibs_truecolor':
            return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${selectedLayer}/default/${date}/${NASA_GIBS_TILE_MATRIX}/{z}/{y}/{x}.jpg`;
          case 'gibs_viirs':
            return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/${NASA_GIBS_TILE_MATRIX}/{z}/{y}/{x}.jpg`;
          default:
            return 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png';
        }
      };

      const tile_template = getTileTemplate();

      if (selectedProvider === 'google') {
        const ok = window.confirm('مصدر الصور Google قد يكون محدود الترخيص — هل تضمن أنك مخوّل لاستخدامه لهذا الغرض؟ اضغط موافق للمتابعة.');
        if (!ok) return;
      }

      const params = new URLSearchParams();
      params.set('tile_template', tile_template);
      params.set('zoom', String(tileZoom));
      params.set('min_lon', String(minLon));
      params.set('min_lat', String(minLat));
      params.set('max_lon', String(maxLon));
      params.set('max_lat', String(maxLat));

      const downloadUrl = `${base}/crop/from_tiles?${params.toString()}`;
      setExportLink(downloadUrl);
      window.open(downloadUrl, '_blank');
    } catch (e: any) {
      console.error(e);
      alert('خطأ أثناء طلب القص الجغرافي: ' + (e?.message || e));
    }
  };

  const updateImageryLayer = () => {
    if (!viewerRef.current || !(window as any).Cesium) return;
    const Cesium = (window as any).Cesium;
    const imageryProvider = createImageryProvider(selectedProvider);
    if (!imageryProvider) return;

    const layers = viewerRef.current.imageryLayers;
    layers.removeAll();
    layers.addImageryProvider(imageryProvider);
    const providerName = IMAGERY_PROVIDERS.find((provider) => provider.id === selectedProvider)?.label || 'Imagery';
    setStatusMessage(`تم تحديث مصدر الصور إلى: ${providerName}`);
  };

  const flyToPoint = () => {
    if (!viewerRef.current || !(window as any).Cesium) return;
    const Cesium = (window as any).Cesium;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, 2500),
      orientation: { pitch: Cesium.Math.toRadians(-45) },
    });
  };

  return (
    <div ref={wrapperRef} className="w-full h-full min-h-screen relative overflow-hidden shadow-2xl bg-slate-950">
      {/* خريطة Cesium ملء الشاشة */}
      <div className="w-full h-full" ref={containerRef} style={{ minHeight: '100vh' }} />

      {/* Overlay لالتقاط أحداث الماوس أثناء وضع التحديد */}
      <div
        onMouseDown={(ev) => {
          console.debug('overlay mousedown', { selecting });
          if (!selecting) return;
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = ev.clientX - rect.left;
          const y = ev.clientY - rect.top;
          setStartPoint({ x, y });
          if (selectionRef.current) {
            selectionRef.current.style.left = `${x}px`;
            selectionRef.current.style.top = `${y}px`;
            selectionRef.current.style.width = `0px`;
            selectionRef.current.style.height = `0px`;
            selectionRef.current.style.display = 'block';
            selectionRef.current.style.pointerEvents = 'none';
          }
        }}
        onMouseMove={(ev) => {
          if (!selecting || !startPoint || !selectionRef.current) return;
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = ev.clientX - rect.left;
          const y = ev.clientY - rect.top;
          const left = Math.min(startPoint.x, x);
          const top = Math.min(startPoint.y, y);
          const width = Math.abs(x - startPoint.x);
          const height = Math.abs(y - startPoint.y);
          selectionRef.current.style.left = `${left}px`;
          selectionRef.current.style.top = `${top}px`;
          selectionRef.current.style.width = `${width}px`;
          selectionRef.current.style.height = `${height}px`;
        }}
        onMouseUp={(ev) => {
          if (!selecting || !startPoint || !selectionRef.current) return;
          const rect = selectionRef.current.getBoundingClientRect();
          const parentRect = containerRef.current?.getBoundingClientRect();
          if (!parentRect) return;
          const relativeRect = new DOMRect(rect.left - parentRect.left, rect.top - parentRect.top, rect.width, rect.height);
          setSelectionRect(relativeRect);
          setSelecting(false);
          setStartPoint(null);
        }}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 45,
          background: 'transparent',
          pointerEvents: selecting ? 'auto' : 'none'
        }}
      />

      {/* شريط الأدوات العلوي العائم */}
      <div className="absolute top-4 left-4 right-4 z-[60] flex justify-between items-center pointer-events-none">
        {/* أزرار الإجراءات (أدوات الخريطة) */}
        <div className="flex gap-2 pointer-events-auto">
          {/* زر العودة للصفحة الرئيسية */}
          <a
            href="/"
            title="العودة إلى الصفحة الرئيسية"
            className="rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white border border-white/10 px-4 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-all duration-200 flex items-center justify-center hover:scale-105"
          >
            🏠
          </a>
          
          <button 
            onClick={toggleFullscreen} 
            className="rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white border border-white/10 px-4 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors"
          >
            🖥️ ملء الشاشة
          </button>
          
          <button 
            onClick={() => { 
              setSelecting(!selecting); 
              setSelectionRect(null); 
              setExportLink(null); 
              if (!selecting && selectionRef.current) selectionRef.current.style.display='none'; 
            }} 
            className={`rounded-xl px-4 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors border ${
              selecting 
                ? 'bg-red-600 text-white border-red-500 hover:bg-red-700' 
                : 'bg-slate-900/90 text-white border-white/10 hover:bg-slate-800'
            }`}
          >
            {selecting ? '❌ إلغاء التحديد' : '✂️ قص منطقة'}
          </button>
          
          {selectionRect && (
            <button 
              onClick={saveSelectionAsTiff} 
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 px-4 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors"
            >
              💾 حفظ المقطع كـ TIFF
            </button>
          )}
          
          {exportLink && (
            <a 
              href={exportLink} 
              download 
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white border border-blue-500 px-4 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors"
            >
              📥 تحميل TIFF
            </a>
          )}
        </div>
      </div>

      {/* لوحة الأيقونات الجانبية العائمة (Google Maps Style Dock) */}
      <div className="absolute top-20 right-4 z-50 flex flex-col gap-3 pointer-events-auto">
        <button
          onClick={() => setActivePanel(activePanel === 'imagery' ? null : 'imagery')}
          title="إعدادات القمر الصناعي وطبقات الخريطة"
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-semibold shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 border ${
            activePanel === 'imagery' 
              ? 'bg-blue-600 text-white border-blue-500' 
              : 'bg-slate-900/90 text-white border-white/10 hover:bg-slate-800'
          }`}
        >
          🛰️
        </button>

        <button
          onClick={() => setActivePanel(activePanel === 'flyto' ? null : 'flyto')}
          title="انتقال سريع للموقع الجغرافي"
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-semibold shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 border ${
            activePanel === 'flyto' 
              ? 'bg-emerald-600 text-white border-emerald-500' 
              : 'bg-slate-900/90 text-white border-white/10 hover:bg-slate-800'
          }`}
        >
          📍
        </button>

        <button
          onClick={() => setActivePanel(activePanel === 'status' ? null : 'status')}
          title="سجل حالة محرك الخرائط والاتصال"
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-semibold shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 border ${
            activePanel === 'status' 
              ? 'bg-blue-600 text-white border-blue-500' 
              : 'bg-slate-900/90 text-white border-white/10 hover:bg-slate-800'
          }`}
        >
          💬
        </button>
      </div>

      {/* لوحات الإعدادات العائمة جنب الأيقونات */}
      {activePanel === 'imagery' && (
        <div className="absolute top-20 right-20 z-50 w-[320px] bg-slate-900/95 backdrop-blur-lg border border-white/10 text-white shadow-2xl rounded-2xl flex flex-col p-4 space-y-4 pointer-events-auto">
          <div className="flex justify-between items-center border-b border-white/10 pb-2">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">🛰️ إعدادات الخريطة الخلفية</h4>
            <button onClick={() => setActivePanel(null)} className="text-slate-400 hover:text-white transition-colors">✕</button>
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300">مصدر صور الأقمار الصناعية</label>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full rounded-xl bg-slate-800 border border-white/10 text-white px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            >
              {IMAGERY_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id} className="bg-slate-900">{provider.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              {IMAGERY_PROVIDERS.find((provider) => provider.id === selectedProvider)?.description}
            </p>

            <div className="pt-1">
              <label className="block text-xs font-medium text-slate-300">درجة تقريب البلاطات (Zoom)</label>
              <input 
                type="number" 
                min={0} 
                max={22} 
                value={tileZoom} 
                onChange={(e)=>setTileZoom(Number(e.target.value))} 
                className="mt-1 w-full rounded-xl bg-slate-800 border border-white/10 text-white px-3 py-2 text-xs focus:border-blue-500 focus:outline-none" 
              />
            </div>

            {selectedProvider.startsWith('gibs') && (
              <div className="pt-1">
                <label className="block text-xs font-medium text-slate-300">تاريخ صور NASA GIBS</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-slate-800 border border-white/10 text-white px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}

            <button
              onClick={updateImageryLayer}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 text-xs transition-colors shadow-md"
            >
              تحديث طبقة الخلفية
            </button>
          </div>
        </div>
      )}

      {activePanel === 'flyto' && (
        <div className="absolute top-20 right-20 z-50 w-[320px] bg-slate-900/95 backdrop-blur-lg border border-white/10 text-white shadow-2xl rounded-2xl flex flex-col p-4 space-y-4 pointer-events-auto">
          <div className="flex justify-between items-center border-b border-white/10 pb-2">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">📍 انتقال سريع للموقع</h4>
            <button onClick={() => setActivePanel(null)} className="text-slate-400 hover:text-white transition-colors">✕</button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400">خط العرض (Lat)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={lat}
                  onChange={(e) => setLat(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl bg-slate-800 border border-white/10 text-white px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400">خط الطول (Lon)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={lon}
                  onChange={(e) => setLon(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl bg-slate-800 border border-white/10 text-white px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <button
              onClick={flyToPoint}
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 text-xs transition-colors shadow-md"
            >
              🎯 تحليق للموقع المحدد
            </button>
          </div>
        </div>
      )}

      {activePanel === 'status' && (
        <div className="absolute top-20 right-20 z-50 w-[320px] bg-slate-900/95 backdrop-blur-lg border border-white/10 text-white shadow-2xl rounded-2xl flex flex-col p-4 space-y-3 pointer-events-auto">
          <div className="flex justify-between items-center border-b border-white/10 pb-2">
            <h4 className="text-xs font-bold text-slate-200">💬 حالة عارض سيزيوم</h4>
            <button onClick={() => setActivePanel(null)} className="text-slate-400 hover:text-white transition-colors">✕</button>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/50 border border-white/5 space-y-2">
            <p className="text-xs text-slate-300 leading-relaxed">{statusMessage}</p>
            {!isLoaded && (
              <div className="flex items-center gap-2 text-[11px] text-blue-400 pt-1">
                <span className="animate-spin text-xs">🌀</span>
                <span>جاري إعداد محرك الخرائط...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* عنصر التحديد البصري */}
      <div ref={selectionRef} style={{ display: 'none', position: 'absolute', border: '2px dashed #ffde59', background: 'rgba(255,222,89,0.08)', pointerEvents: 'none', zIndex: 50 }} />
    </div>
  );
}
