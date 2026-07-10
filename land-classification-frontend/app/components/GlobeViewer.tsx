"use client";

import { useEffect, useRef, useState } from "react";
import { API_CONFIG } from "@/app/lib/map-config";
import {
  Search, Menu, Layers, FolderOpen, Compass, Plus, Minus, Navigation,
  Map as MapIcon, Scissors, X, Download, Home, Info, Crosshair
} from "lucide-react";

const CESIUM_JS = "https://cesium.com/downloads/cesiumjs/releases/1.129/Build/Cesium/Cesium.js";
const CESIUM_CSS = "https://cesium.com/downloads/cesiumjs/releases/1.129/Build/Cesium/Widgets/widgets.css";

const NASA_GIBS_DEFAULT_LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor";
const NASA_GIBS_TILE_MATRIX = "GoogleMapsCompatible";

const IMAGERY_PROVIDERS = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    description: 'خريطة الشوارع العالمية الأساسية',
  },
  {
    id: 'esri',
    label: 'Esri World Imagery',
    description: 'صور أقمار صناعية عالية الدقة من Esri',
  },
  {
    id: 'google',
    label: 'Google Satellite',
    description: 'صور الأقمار الصناعية من Google',
  },
  {
    id: 'gibs_truecolor',
    label: 'NASA GIBS TrueColor',
    description: 'صور الأقمار الصناعية بدقة للألوان الحقيقية',
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

  // Camera & view states
  const [lat, setLat] = useState(24.7136);
  const [lon, setLon] = useState(46.6753);
  const [cameraHeight, setCameraHeight] = useState(0);

  // Settings
  const [date, setDate] = useState(formatDate(new Date()));
  const [selectedProvider, setSelectedProvider] = useState<string>('google');
  const [selectedLayer, setSelectedLayer] = useState<string>(NASA_GIBS_DEFAULT_LAYER);
  const [tileZoom, setTileZoom] = useState<number>(17);

  // UI states
  const [statusMessage, setStatusMessage] = useState<string>("جاري تحميل الكرة الأرضية...");
  const [activeTab, setActiveTab] = useState<'search' | 'layers' | 'projects' | 'tools' | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [is3D, setIs3D] = useState(true);

  const createImageryProvider = (providerId: string) => {
    const Cesium = (window as any).Cesium;
    if (!Cesium) return null;

    switch (providerId) {
      case 'osm':
        return new Cesium.OpenStreetMapImageryProvider({
          url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          credit: 'OpenStreetMap',
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
        });
    }
  };

  useEffect(() => {
    let mounted = true;
    let cameraUpdateInterval: any;

    const init = async () => {
      try {
        loadCss(CESIUM_CSS);
        await loadScript(CESIUM_JS);
        if (!mounted || !containerRef.current || !(window as any).Cesium) return;

        const Cesium = (window as any).Cesium;

        // Hide Cesium default UI components via CSS overrides handled later or viewer options
        const imageryProvider = createImageryProvider(selectedProvider);
        if (!imageryProvider) throw new Error('Unable to create imagery provider');

        viewerRef.current = new Cesium.Viewer(containerRef.current, {
          baseLayerPicker: false,
          timeline: false,
          animation: false,
          fullscreenButton: false, // We'll handle this ourself if needed, or remove it for clean UI
          infoBox: false,
          selectionIndicator: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          homeButton: false,
          vrButton: false,
          geocoder: false,
          scene3DOnly: true,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
          creditContainer: document.createElement('div'), // Hide credits visually
        });

        // Force add imagery provider as base layer
        viewerRef.current.imageryLayers.removeAll();
        viewerRef.current.imageryLayers.addImageryProvider(imageryProvider);

        const scene = viewerRef.current.scene;
        scene.globe.enableLighting = false; // Disable lighting to keep map visible at all times
        scene.globe.showWaterEffect = true;

        // Improve visual quality
        scene.skyAtmosphere.hueShift = -0.1;
        scene.skyAtmosphere.brightnessShift = 0.1;
        scene.skyAtmosphere.saturationShift = 0.1;

        // Initial camera position (Riyadh)
        viewerRef.current.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 8000000),
          duration: 2,
        });

        // Set up tracking of coordinates
        cameraUpdateInterval = setInterval(() => {
          if (!viewerRef.current || !mounted) return;
          const camera = viewerRef.current.camera;
          const position = camera.positionCartographic;
          setLat(Cesium.Math.toDegrees(position.latitude));
          setLon(Cesium.Math.toDegrees(position.longitude));
          setCameraHeight(position.height);
        }, 1000);

        // Load Task Layer if taskId exists
        if (taskId) {
          setStatusMessage("تحميل طبقة المعالم للمهمة...");
          try {
            const reportUrl = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.report.replace('{task_id}', taskId)}`;
            const response = await fetch(reportUrl);
            if (response.ok) {
              const taskReport = await response.json();
              if (taskReport.geojson) {
                const dataSource = await Cesium.GeoJsonDataSource.load(taskReport.geojson, {
                  stroke: Cesium.Color.fromCssColorString('#3b82f6'),
                  fill: Cesium.Color.fromCssColorString('#3b82f6').withAlpha(0.3),
                  strokeWidth: 3,
                });
                viewerRef.current.dataSources.add(dataSource);
                const center = taskReport.map_center;
                if (center) {
                  viewerRef.current.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(center[1], center[0], 3000),
                    orientation: { pitch: Cesium.Math.toRadians(-60) },
                    duration: 3,
                  });
                }
                setStatusMessage("اكتمل التحميل");
                setTimeout(() => setStatusMessage(""), 3000);
              }
            }
          } catch (error) {
            console.warn(error);
            setStatusMessage("خطأ أثناء تحميل المعالم");
          }
        } else {
          setStatusMessage("");
        }

        setIsLoaded(true);
      } catch (error) {
        console.error(error);
        setStatusMessage("فشل في تحميل المحرك ثلاثي الأبعاد");
      }
    };

    init();
    return () => {
      mounted = false;
      clearInterval(cameraUpdateInterval);
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [taskId]);

  // Handle selection (Cropping Tool)
  useEffect(() => {
    const container = containerRef.current;
    const Cesium = (window as any).Cesium;
    if (!viewerRef.current || !Cesium || !container) return;
    const canvas = viewerRef.current.scene.canvas;

    const getPointer = (position: any) => {
      const rect = container.getBoundingClientRect();
      return { x: position.x - rect.left, y: position.y - rect.top };
    };

    const handler = new Cesium.ScreenSpaceEventHandler(canvas);

    handler.setInputAction((movement: any) => {
      if (!selecting) return;
      const pos = getPointer(movement.position);
      setStartPoint(pos);
      if (selectionRef.current) {
        Object.assign(selectionRef.current.style, {
          left: `${pos.x}px`, top: `${pos.y}px`, width: '0px', height: '0px', display: 'block'
        });
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((movement: any) => {
      if (!selecting || !startPoint || !selectionRef.current) return;
      const pos = getPointer(movement.endPosition || movement.position);
      const left = Math.min(startPoint.x, pos.x);
      const top = Math.min(startPoint.y, pos.y);
      const width = Math.abs(startPoint.x - pos.x);
      const height = Math.abs(startPoint.y - pos.y);
      Object.assign(selectionRef.current.style, {
        left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`
      });
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      if (!selecting || !startPoint || !selectionRef.current) return;
      const rect = selectionRef.current.getBoundingClientRect();
      const parentRect = container.getBoundingClientRect();
      const relativeRect = new DOMRect(rect.left - parentRect.left, rect.top - parentRect.top, rect.width, rect.height);
      setSelectionRect(relativeRect);
      setSelecting(false);
      setStartPoint(null);
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    return () => handler.destroy();
  }, [selecting, startPoint, isLoaded]);

  // Disable camera control during selection
  useEffect(() => {
    if (!viewerRef.current) return;
    try {
      const sc = viewerRef.current.scene.screenSpaceCameraController;
      const enabled = !selecting;
      sc.enableRotate = enabled;
      sc.enableTranslate = enabled;
      sc.enableTilt = enabled;
      sc.enableZoom = enabled;
      sc.enableLook = enabled;
    } catch (e) { }
  }, [selecting]);

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
      if (!selectionRect) throw new Error('يرجى تحديد منطقة للقص أولاً.');
      const topLeft = getLonLatFromScreen(selectionRect.x, selectionRect.y);
      const bottomRight = getLonLatFromScreen(selectionRect.x + selectionRect.width, selectionRect.y + selectionRect.height);
      if (!topLeft || !bottomRight) throw new Error('تعذر تحويل الحقول المحددة إلى إحداثيات. حاول اختيار منطقة أقرب للسطح.');

      const minLon = Math.min(topLeft.lon, bottomRight.lon);
      const maxLon = Math.max(topLeft.lon, bottomRight.lon);
      const minLat = Math.min(topLeft.lat, bottomRight.lat);
      const maxLat = Math.max(topLeft.lat, bottomRight.lat);
      const base = API_CONFIG.baseURL || 'http://localhost:8000';

      if (taskId) {
        const downloadUrl = `${base}/tasks/${taskId}/crop?min_lon=${minLon}&min_lat=${minLat}&max_lon=${maxLon}&max_lat=${maxLat}`;
        setExportLink(downloadUrl);
        window.open(downloadUrl, '_blank');
        return;
      }

      // No taskId -> request tiles
      const getTileTemplate = () => {
        switch (selectedProvider) {
          case 'esri': return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
          case 'google': return 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
          case 'gibs_truecolor': return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${selectedLayer}/default/${date}/${NASA_GIBS_TILE_MATRIX}/{z}/{y}/{x}.jpg`;
          default: return 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png';
        }
      };

      if (selectedProvider === 'google') {
        if (!window.confirm('صور Google قد تكون محمية. هل تود المتابعة؟')) return;
      }

      const params = new URLSearchParams({
        tile_template: getTileTemplate(),
        zoom: String(tileZoom),
        min_lon: String(minLon), min_lat: String(minLat),
        max_lon: String(maxLon), max_lat: String(maxLat)
      });
      const downloadUrl = `${base}/crop/from_tiles?${params.toString()}`;
      setExportLink(downloadUrl);
      window.open(downloadUrl, '_blank');
    } catch (e: any) {
      alert('خطأ أثناء القص: ' + (e?.message || e));
    }
  };

  const updateImageryLayer = () => {
    if (!viewerRef.current || !(window as any).Cesium) return;
    const imageryProvider = createImageryProvider(selectedProvider);
    if (!imageryProvider) return;
    const layers = viewerRef.current.imageryLayers;
    layers.removeAll();
    layers.addImageryProvider(imageryProvider);
  };

  // Map Navigation Functions
  const zoomIn = () => viewerRef.current?.camera.zoomIn(viewerRef.current.camera.positionCartographic.height * 0.2);
  const zoomOut = () => viewerRef.current?.camera.zoomOut(viewerRef.current.camera.positionCartographic.height * 0.2);
  const resetCompass = () => {
    if (!viewerRef.current) return;
    const Cesium = (window as any).Cesium;
    viewerRef.current.camera.flyTo({
      destination: viewerRef.current.camera.position,
      orientation: { heading: 0, pitch: viewerRef.current.camera.pitch, roll: 0 },
      duration: 1
    });
  };
  const toggle3D = () => {
    if (!viewerRef.current) return;
    const Cesium = (window as any).Cesium;
    if (is3D) {
      viewerRef.current.camera.flyTo({
        destination: viewerRef.current.camera.position,
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1
      });
    } else {
      viewerRef.current.camera.flyTo({
        destination: viewerRef.current.camera.position,
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 1
      });
    }
    setIs3D(!is3D);
  };

  const flyToMyLocation = () => {
    if (navigator.geolocation && viewerRef.current) {
      setStatusMessage("جاري تحديد موقعك...");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const Cesium = (window as any).Cesium;
          setStatusMessage("تم تحديد الموقع، جاري الانتقال...");
          viewerRef.current.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(pos.coords.longitude, pos.coords.latitude, 2000),
            orientation: { 
              heading: Cesium.Math.toRadians(0), 
              pitch: Cesium.Math.toRadians(-45), 
              roll: 0 
            },
            duration: 3.5 // طيران سلس وبطيء يشبه Google Earth
          });
          setTimeout(() => setStatusMessage(""), 4000);
        },
        (error) => {
          console.warn("Geolocation error:", error);
          setStatusMessage("تعذر الحصول على الموقع. يرجى تفعيل الصلاحيات.");
          setTimeout(() => setStatusMessage(""), 4000);
        },
        { enableHighAccuracy: true }
      );
    } else {
      setStatusMessage("المتصفح لا يدعم تحديد الموقع.");
      setTimeout(() => setStatusMessage(""), 4000);
    }
  };

  const toggleTab = (tab: 'search' | 'layers' | 'projects' | 'tools') => {
    setActiveTab(activeTab === tab ? null : tab);
  };

  return (
    <div ref={wrapperRef} className="w-full h-screen relative overflow-hidden bg-black text-slate-200 select-none font-sans" dir="rtl">

      {/* 1. Cesium Container */}
      <div className="w-full h-full absolute inset-0 z-0" ref={containerRef} />

      {/* Selection Overlay */}
      <div
        className="absolute inset-0 z-10"
        style={{ pointerEvents: selecting ? 'auto' : 'none' }}
        onMouseDown={(ev) => {
          if (!selecting || !containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          setStartPoint({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
          if (selectionRef.current) {
            Object.assign(selectionRef.current.style, {
              left: `${ev.clientX - rect.left}px`, top: `${ev.clientY - rect.top}px`, width: '0px', height: '0px', display: 'block', pointerEvents: 'none'
            });
          }
        }}
        onMouseMove={(ev) => {
          if (!selecting || !startPoint || !selectionRef.current || !containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const x = ev.clientX - rect.left;
          const y = ev.clientY - rect.top;
          Object.assign(selectionRef.current.style, {
            left: `${Math.min(startPoint.x, x)}px`, top: `${Math.min(startPoint.y, y)}px`,
            width: `${Math.abs(x - startPoint.x)}px`, height: `${Math.abs(y - startPoint.y)}px`
          });
        }}
        onMouseUp={() => {
          if (!selecting || !startPoint || !selectionRef.current || !containerRef.current) return;
          const rect = selectionRef.current.getBoundingClientRect();
          const parentRect = containerRef.current.getBoundingClientRect();
          setSelectionRect(new DOMRect(rect.left - parentRect.left, rect.top - parentRect.top, rect.width, rect.height));
          setSelecting(false);
          setStartPoint(null);
          setActiveTab('tools'); // Re-open tools tab to show save button
        }}
      />
      {/* Selection Rect Visual */}
      <div ref={selectionRef} style={{ display: 'none', position: 'absolute', border: '2px dashed rgba(59, 130, 246, 0.8)', background: 'rgba(59, 130, 246, 0.2)', pointerEvents: 'none', zIndex: 15 }} />

      {/* 2. Top-Right Search Box (Google Earth Web Style) */}
      <div className="absolute top-4 right-20 z-40 flex items-center bg-black/40 backdrop-blur-xl border border-white/10 rounded-full px-4 py-2.5 shadow-2xl transition-all w-80 hover:bg-black/60 focus-within:bg-black/70 focus-within:w-96 focus-within:border-blue-500/50">
        <Search className="w-5 h-5 text-slate-400 ml-3" />
        <input
          type="text"
          placeholder="ابحث عن مكان..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent border-none outline-none text-sm w-full text-white placeholder:text-slate-500 font-medium"
        />
      </div>

      {/* 3. Left Sidebar Navigation (Thin Strip) */}
      <div className="absolute top-0 right-0 bottom-0 w-16 bg-black/30 backdrop-blur-2xl border-l border-white/10 z-50 flex flex-col items-center py-6 gap-6 shadow-2xl">
        <a href="/" className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition-all shadow-lg shadow-blue-500/20 mb-4 group relative">
          <Home className="w-5 h-5 text-white" />
          <span className="absolute right-14 bg-black/80 px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">الرئيسية</span>
        </a>

        <NavIcon icon={<Search />} label="البحث" active={activeTab === 'search'} onClick={() => toggleTab('search')} />
        <NavIcon icon={<Layers />} label="طبقات الخريطة" active={activeTab === 'layers'} onClick={() => toggleTab('layers')} />
        <NavIcon icon={<FolderOpen />} label="المشاريع" active={activeTab === 'projects'} onClick={() => toggleTab('projects')} />
        <NavIcon icon={<Scissors />} label="أدوات القص" active={activeTab === 'tools'} onClick={() => toggleTab('tools')} />
        <NavIcon icon={<Navigation />} label="موقعي" active={false} onClick={flyToMyLocation} />

        <div className="flex-1" />
        <NavIcon icon={<Info />} label="معلومات" onClick={() => { }} />
      </div>

      {/* 4. Sliding Drawer for active tab */}
      <div className={`absolute top-0 bottom-0 right-16 w-80 bg-black/60 backdrop-blur-2xl border-l border-white/5 z-40 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] shadow-2xl ${activeTab ? 'translate-x-0' : 'translate-x-full'}`}>
        {activeTab && (
          <div className="h-full flex flex-col p-6">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold text-white tracking-wide">
                {activeTab === 'layers' && 'الطبقات'}
                {activeTab === 'projects' && 'المشاريع'}
                {activeTab === 'tools' && 'أدوات الخريطة'}
                {activeTab === 'search' && 'بحث'}
              </h2>
              <button onClick={() => setActiveTab(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {activeTab === 'layers' && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">مصدر الأقمار الصناعية</label>
                    <div className="grid gap-2">
                      {IMAGERY_PROVIDERS.map((provider) => (
                        <button
                          key={provider.id}
                          onClick={() => { setSelectedProvider(provider.id); updateImageryLayer(); }}
                          className={`flex flex-col text-right p-3 rounded-xl border transition-all ${selectedProvider === provider.id
                              ? 'bg-blue-600/20 border-blue-500 text-white'
                              : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                            }`}
                        >
                          <span className="font-medium text-sm mb-1">{provider.label}</span>
                          <span className="text-[10px] text-slate-400 line-clamp-1">{provider.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedProvider.startsWith('gibs') && (
                    <div className="space-y-3 p-4 bg-white/5 rounded-xl border border-white/5">
                      <label className="text-xs font-semibold text-slate-400 uppercase">تاريخ الصورة (NASA GIBS)</label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
                      />
                      <button onClick={updateImageryLayer} className="w-full mt-2 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors">
                        تحديث التاريخ
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'tools' && (
                <div className="space-y-6">
                  <div className="p-5 bg-gradient-to-br from-blue-900/40 to-slate-900/40 border border-blue-500/20 rounded-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
                    <div className="flex items-center gap-3 mb-3 text-blue-400">
                      <Scissors className="w-5 h-5" />
                      <h3 className="font-semibold text-sm">أداة قص المنطقة</h3>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed mb-5">
                      اسحب فوق الخريطة لتحديد منطقة معينة لحفظها كملف TIFF عالي الدقة.
                    </p>

                    <button
                      onClick={() => {
                        setSelecting(!selecting);
                        setSelectionRect(null);
                        setExportLink(null);
                        if (!selecting && selectionRef.current) selectionRef.current.style.display = 'none';
                        if (!selecting) setActiveTab(null); // Close drawer to allow selection
                      }}
                      className={`w-full py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all shadow-lg ${selecting
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                          : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20 border border-transparent'
                        }`}
                    >
                      {selecting ? (
                        <><X className="w-4 h-4" /> إلغاء التحديد</>
                      ) : (
                        <><Crosshair className="w-4 h-4" /> بدء التحديد</>
                      )}
                    </button>
                  </div>

                  {selectionRect && (
                    <div className="p-4 bg-emerald-900/20 border border-emerald-500/20 rounded-2xl space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                      <div className="flex justify-between items-center text-emerald-400 text-sm font-medium">
                        <span>تم تحديد المنطقة</span>
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] text-slate-400 uppercase">دقة القص (Zoom Level)</label>
                        <input
                          type="range" min="10" max="22"
                          value={tileZoom} onChange={(e) => setTileZoom(Number(e.target.value))}
                          className="w-full accent-emerald-500 h-1.5 bg-black/50 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="text-right text-xs text-emerald-500/80 font-mono">Zoom: {tileZoom}</div>
                      </div>

                      <button
                        onClick={saveSelectionAsTiff}
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
                      >
                        <Download className="w-4 h-4" /> معالجة وحفظ TIFF
                      </button>

                      {exportLink && (
                        <a
                          href={exportLink}
                          download
                          className="block text-center text-xs text-blue-400 hover:text-blue-300 py-2 mt-2 bg-blue-500/10 rounded-lg border border-blue-500/20"
                        >
                          رابط التحميل المباشر
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'projects' && (
                <div className="text-center py-10 opacity-60">
                  <FolderOpen className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                  <p className="text-sm">لا توجد مشاريع سابقة</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 5. Bottom Right Navigation Controls */}
      <div className="absolute bottom-10 left-6 z-40 flex flex-col gap-3">
        <div className="flex flex-col bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <ControlButton icon={<Compass className="w-5 h-5" />} onClick={resetCompass} title="توجيه للشمال" />
        </div>

        <div className="flex flex-col bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <ControlButton icon={<MapIcon className="w-5 h-5" />} onClick={toggle3D} title={is3D ? "عرض 2D" : "عرض 3D"} />
          <div className="h-px bg-white/10 w-full" />
          <ControlButton icon={<Plus className="w-5 h-5" />} onClick={zoomIn} title="تكبير" />
          <div className="h-px bg-white/10 w-full" />
          <ControlButton icon={<Minus className="w-5 h-5" />} onClick={zoomOut} title="تصغير" />
        </div>
      </div>

      {/* 6. Bottom Information Bar */}
      <div className="absolute bottom-0 right-16 left-0 h-8 bg-black/20 backdrop-blur-md border-t border-white/5 flex items-center justify-between px-4 z-30 pointer-events-none">
        <div className="flex items-center gap-6 text-[11px] font-mono text-slate-300">
          <span className="flex gap-2">
            <span className="opacity-50">LAT</span>
            {lat.toFixed(5)}°
          </span>
          <span className="flex gap-2">
            <span className="opacity-50">LON</span>
            {lon.toFixed(5)}°
          </span>
          <span className="flex gap-2">
            <span className="opacity-50">ELEV</span>
            {Math.round(cameraHeight).toLocaleString()} m
          </span>
        </div>
        <div className="text-[10px] text-slate-500 font-medium">
          Land Classification Project © {new Date().getFullYear()}
        </div>
      </div>

      {/* Loader / Status Overlay */}
      {statusMessage && (
        <div className="absolute top-20 right-1/2 translate-x-1/2 z-50 bg-black/60 backdrop-blur-xl border border-white/10 text-white px-6 py-3 rounded-full text-sm font-medium shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
          {!isLoaded && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
          {statusMessage}
        </div>
      )}

      {/* Global Style overrides to hide Cesium default UI just in case */}
      <style dangerouslySetInnerHTML={{
        __html: `
        .cesium-viewer-bottom, .cesium-viewer-animationContainer, .cesium-viewer-timelineContainer { display: none !important; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
      `}} />
    </div>
  );
}

function NavIcon({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative group w-10 h-10 rounded-xl flex items-center justify-center transition-all ${active
          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
          : 'text-slate-400 hover:text-white hover:bg-white/10 border border-transparent'
        }`}
    >
      {icon}
      <span className="absolute right-14 bg-black/80 px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity text-white border border-white/10 shadow-xl">
        {label}
      </span>
    </button>
  );
}

function ControlButton({ icon, onClick, title }: { icon: React.ReactNode, onClick: () => void, title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-10 h-10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-none"
    >
      {icon}
    </button>
  );
}
