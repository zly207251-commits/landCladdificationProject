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
    if (document.querySelector(`script[src='${src}']`)) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.body.appendChild(script);
  });
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function GlobeViewer({ taskId }: { taskId?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [lat, setLat] = useState(24.7136);
  const [lon, setLon] = useState(46.6753);
  const [date, setDate] = useState(formatDate(new Date()));
  const [selectedProvider, setSelectedProvider] = useState<string>('esri');
  const [selectedLayer, setSelectedLayer] = useState<string>(NASA_GIBS_DEFAULT_LAYER);
  const [statusMessage, setStatusMessage] = useState<string>("تحميل واجهة العرض...");

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
                  strokeWidth: 2,
                });
                viewerRef.current.dataSources.add(dataSource);
                const center = taskReport.map_center;
                if (center) {
                  viewerRef.current.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(center[1], center[0], 1_500_000),
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
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1_000_000),
      orientation: { pitch: Cesium.Math.toRadians(-45) },
    });
  };

  return (
    <div className="h-full w-full flex flex-col gap-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr,0.8fr] gap-4 h-full">
        <div className="bg-slate-950 text-white rounded-3xl overflow-hidden shadow-lg h-[620px]">
          <div className="h-full" ref={containerRef} style={{ minHeight: 620 }} />
        </div>
        <div className="space-y-4">
          <div className="rounded-3xl bg-white p-5 shadow-lg">
            <h2 className="text-xl font-semibold text-slate-800 mb-3">خريطة عالمية بـ NASA GIBS</h2>
            <p className="text-sm text-slate-600 leading-relaxed">عرض طبقات الأقمار الصناعية مباشرة من NASA GIBS. يمكنك تكبير أي نقطة أو الانتقال إليها عبر الإحداثيات.</p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-lg space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">اختيار مصدر الصور</label>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              >
                {IMAGERY_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">
                {IMAGERY_PROVIDERS.find((provider) => provider.id === selectedProvider)?.description}
              </p>
            </div>
            {selectedProvider.startsWith('gibs') && (
              <div>
                <label className="block text-sm font-medium text-slate-700">تاريخ صور GIBS</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
            <button
              onClick={updateImageryLayer}
              className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-white font-semibold hover:bg-blue-700"
            >
              تحديث مصدر الصور
            </button>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-lg space-y-4">
            <h3 className="text-lg font-semibold text-slate-800">انتقال سريع</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">خط العرض</label>
                <input
                  type="number"
                  step="0.0001"
                  value={lat}
                  onChange={(e) => setLat(Number(e.target.value))}
                  className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">خط الطول</label>
                <input
                  type="number"
                  step="0.0001"
                  value={lon}
                  onChange={(e) => setLon(Number(e.target.value))}
                  className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <button
              onClick={flyToPoint}
              className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-white font-semibold hover:bg-emerald-700"
            >
              انتقل إلى النقطة
            </button>
          </div>
          <div className="rounded-3xl bg-slate-900 p-5 text-white shadow-lg">
            <p className="text-sm">{statusMessage}</p>
            {!isLoaded && <p className="mt-3 text-xs text-slate-300">جاري إعداد Cesium وطبقة الأقمار الصناعية...</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
