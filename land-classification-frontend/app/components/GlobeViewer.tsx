"use client";

import { useEffect, useRef, useState } from "react";
import { API_CONFIG } from "@/app/lib/map-config";

const CESIUM_JS = "https://cesium.com/downloads/cesiumjs/releases/1.129/Build/Cesium/Cesium.js";
const CESIUM_CSS = "https://cesium.com/downloads/cesiumjs/releases/1.129/Build/Cesium/Widgets/widgets.css";

const NASA_GIBS_DEFAULT_LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor";
const NASA_GIBS_TILE_MATRIX = "GoogleMapsCompatible";

const IMAGERY_PROVIDERS = [
  {
    id: 'google',
    label: 'Google Satellite',
    description: 'صور الأقمار الصناعية مدمجة مع الأسماء لتسهيل التصفح والبحث الجغرافي',
  },
  {
    id: 'esri',
    label: 'Esri World Imagery',
    description: 'صور أقمار صناعية عالية الدقة ونظيفة',
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    description: 'خريطة الشوارع العالمية',
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
  const [isLoaded, setIsLoaded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [exportLink, setExportLink] = useState<string | null>(null);
  const [lat, setLat] = useState(24.7136);
  const [lon, setLon] = useState(46.6753);
  const [date, setDate] = useState(formatDate(new Date()));
  const [selectedProvider, setSelectedProvider] = useState<string>('google');
  const [selectedLayer, setSelectedLayer] = useState<string>(NASA_GIBS_DEFAULT_LAYER);
  const [tileZoom, setTileZoom] = useState<number>(17);
  const [statusMessage, setStatusMessage] = useState<string>("تحميل واجهة العرض...");
  const [activePanel, setActivePanel] = useState<string | null>(null);
  
  interface GISLayer {
    id: string;
    name: string;
    type: string;
    visible: boolean;
    dataSource: any;
  }
  const [gisLayers, setGisLayers] = useState<GISLayer[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const startCoordsRef = useRef<{ lon: number; lat: number } | null>(null);
  const currentCoordsRef = useRef<{ lon: number; lat: number } | null>(null);
  const currentSelectionEntityRef = useRef<any>(null);
  const polygonPointsRef = useRef<any[]>([]);
  const polygonEntitiesRef = useRef<any[]>([]);
  const [polygonPoints, setPolygonPoints] = useState<any[]>([]);
  const [geographicBBox, setGeographicBBox] = useState<{ minLon: number; maxLon: number; minLat: number; maxLat: number } | null>(null);

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
                viewerRef.current.zoomTo(dataSource);
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

  // أحداث التحديد باستخدام Cesium ScreenSpaceEventHandler وتحديد النقاط للمضلع الجغرافي
  useEffect(() => {
    const Cesium = (window as any).Cesium;
    if (!viewerRef.current || !Cesium) return;
    const canvas = viewerRef.current.scene.canvas;
    if (!canvas) return;

    const handler = new Cesium.ScreenSpaceEventHandler(canvas);

    handler.setInputAction((movement: any) => {
      if (!selecting) return;
      
      const ray = viewerRef.current.camera.getPickRay(movement.position);
      const cartesian = viewerRef.current.scene.globe.pick(ray, viewerRef.current.scene) || 
                        viewerRef.current.scene.camera.pickEllipsoid(movement.position, viewerRef.current.scene.globe.ellipsoid);
      
      if (cartesian) {
        polygonPointsRef.current.push(cartesian);
        setPolygonPoints([...polygonPointsRef.current]);

        // رسم النقطة الجديدة على الخريطة
        const pointEntity = viewerRef.current.entities.add({
          name: `نقطة مضلع ${polygonPointsRef.current.length}`,
          position: cartesian,
          point: {
            color: Cesium.Color.RED,
            pixelSize: 8,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY // إبقاء النقطة ظاهرة دائماً فوق التضاريس
          }
        });
        polygonEntitiesRef.current.push(pointEntity);

        // إنشاء أو تحديث المضلع عندما تصبح النقاط 3 أو أكثر
        if (polygonPointsRef.current.length >= 3) {
          if (!currentSelectionEntityRef.current) {
            currentSelectionEntityRef.current = viewerRef.current.entities.add({
              name: "منطقة قص مضلعة",
              polygon: {
                hierarchy: new Cesium.CallbackProperty(() => {
                  return new Cesium.PolygonHierarchy(polygonPointsRef.current);
                }, false),
                material: Cesium.Color.YELLOW.withAlpha(0.25),
                outline: true,
                outlineColor: Cesium.Color.YELLOW,
                outlineWidth: 3
              }
            });
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
    };
  }, [selecting, isLoaded]);

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

  const cancelSelection = () => {
    if (viewerRef.current) {
      // Remove points entities
      for (const ent of polygonEntitiesRef.current) {
        viewerRef.current.entities.remove(ent);
      }
      polygonEntitiesRef.current = [];
      
      // Remove polygon entity
      if (currentSelectionEntityRef.current) {
        viewerRef.current.entities.remove(currentSelectionEntityRef.current);
        currentSelectionEntityRef.current = null;
      }
    }
    polygonPointsRef.current = [];
    setPolygonPoints([]);
    setGeographicBBox(null);
    setExportLink(null);
    setSelecting(false);
  };

  const finishPolygonSelection = () => {
    const Cesium = (window as any).Cesium;
    if (!Cesium || polygonPointsRef.current.length < 3) return;
    
    const lons = polygonPointsRef.current.map(p => {
      const carto = Cesium.Cartographic.fromCartesian(p);
      return Cesium.Math.toDegrees(carto.longitude);
    });
    const lats = polygonPointsRef.current.map(p => {
      const carto = Cesium.Cartographic.fromCartesian(p);
      return Cesium.Math.toDegrees(carto.latitude);
    });
    
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    
    setGeographicBBox({ minLon, maxLon, minLat, maxLat });
    setSelecting(false);
  };

  const saveSelectionAsTiff = async () => {
    try {
      if (!geographicBBox) {
        throw new Error('يرجى تحديد منطقة للقص أولاً.');
      }

      const { minLon, maxLon, minLat, maxLat } = geographicBBox;
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
            return 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
          case 'gibs_truecolor':
            return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${selectedLayer}/default/${date}/${NASA_GIBS_TILE_MATRIX}/{z}/{y}/{x}.jpg`;
          case 'gibs_viirs':
            return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/${NASA_GIBS_TILE_MATRIX}/{z}/{y}/{x}.jpg`;
          default:
            return 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
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

  const uuidv4_local = () => Math.random().toString(36).substring(2, 9);

  const loadShpjs = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if ((window as any).shp) {
        resolve((window as any).shp);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/shpjs/4.0.4/shp.min.js";
      script.async = true;
      script.onload = () => resolve((window as any).shp);
      script.onerror = () => reject(new Error("Failed to load shpjs library"));
      document.body.appendChild(script);
    });
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>, fileList?: FileList) => {
    let files: File[] = [];
    
    // Support drop event
    if ('dataTransfer' in e && e.dataTransfer?.files) {
      files = Array.from(e.dataTransfer.files);
    } 
    // Support file picker change event
    else if ('target' in e && (e.target as HTMLInputElement).files) {
      files = Array.from((e.target as HTMLInputElement).files || []);
    }

    if (files.length === 0) return;

    const Cesium = (window as any).Cesium;
    if (!viewerRef.current || !Cesium) {
      setImportError("محرك الخرائط غير جاهز بعد.");
      return;
    }

    setImportLoading(true);
    setImportError(null);

    for (const file of files) {
      try {
        const name = file.name;
        const extension = name.split('.').pop()?.toLowerCase();
        let dataSource: any = null;

        if (extension === 'geojson' || extension === 'json') {
          const text = await file.text();
          const jsonData = JSON.parse(text);
          dataSource = await Cesium.GeoJsonDataSource.load(jsonData, {
            stroke: Cesium.Color.YELLOW,
            fill: Cesium.Color.YELLOW.withAlpha(0.25),
            strokeWidth: 3
          });
        } else if (extension === 'kml' || extension === 'kmz') {
          const url = URL.createObjectURL(file);
          dataSource = await Cesium.KmlDataSource.load(url, {
            camera: viewerRef.current.camera,
            canvas: viewerRef.current.canvas
          });
          
          // Override KML solid styling to make polygons translucent
          const entities = dataSource.entities.values;
          for (const entity of entities) {
            if (entity.polygon) {
              if (entity.polygon.material && entity.polygon.material.color) {
                const originalColor = entity.polygon.material.color.getValue(Cesium.JulianDate.now());
                if (originalColor) {
                  // Keep the KML's original color but set alpha to 0.35 for transparency
                  entity.polygon.material.color = new Cesium.ConstantProperty(
                    Cesium.Color.fromAlpha(originalColor, 0.35)
                  );
                }
              } else {
                entity.polygon.material = new Cesium.ColorMaterialProperty(
                  Cesium.Color.YELLOW.withAlpha(0.35)
                );
              }
              entity.polygon.outline = new Cesium.ConstantProperty(true);
              if (!entity.polygon.outlineColor) {
                entity.polygon.outlineColor = new Cesium.ConstantProperty(Cesium.Color.YELLOW);
              }
            }
          }
        } else if (extension === 'zip') {
          const shp = await loadShpjs();
          const arrayBuffer = await file.arrayBuffer();
          const geojson = await shp(arrayBuffer);
          dataSource = await Cesium.GeoJsonDataSource.load(geojson, {
            stroke: Cesium.Color.AQUA,
            fill: Cesium.Color.AQUA.withAlpha(0.25),
            strokeWidth: 3
          });
        } else {
          throw new Error("صيغة الملف غير مدعومة. يرجى اختيار GeoJSON أو KML/KMZ أو Shapefile ZIP.");
        }

        if (dataSource) {
          viewerRef.current.dataSources.add(dataSource);
          viewerRef.current.zoomTo(dataSource);
          
          const newLayer: GISLayer = {
            id: uuidv4_local(),
            name: file.name,
            type: extension || 'unknown',
            visible: true,
            dataSource: dataSource
          };
          setGisLayers(prev => [...prev, newLayer]);
        }
      } catch (err: any) {
        console.error(err);
        setImportError(`فشل استيراد الملف ${file.name}: ${err.message || err}`);
      }
    }
    setImportLoading(false);
  };

  const toggleLayerVisibility = (layerId: string) => {
    setGisLayers(prev => prev.map(ly => {
      if (ly.id === layerId) {
        const nextVisible = !ly.visible;
        ly.dataSource.show = nextVisible;
        return { ...ly, visible: nextVisible };
      }
      return ly;
    }));
  };

  const removeLayer = (layerId: string) => {
    const layer = gisLayers.find(ly => ly.id === layerId);
    if (layer && viewerRef.current) {
      viewerRef.current.dataSources.remove(layer.dataSource);
    }
    setGisLayers(prev => prev.filter(ly => ly.id !== layerId));
  };

  return (
    <div ref={wrapperRef} className="w-full h-full min-h-screen relative overflow-hidden shadow-2xl bg-slate-950">
      {/* خريطة Cesium ملء الشاشة */}
      <div className="w-full h-full" ref={containerRef} style={{ minHeight: '100vh' }} />



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
              if (selecting) {
                cancelSelection();
              } else {
                cancelSelection();
                setSelecting(true);
              }
            }} 
            className={`rounded-xl px-4 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors border ${
              selecting 
                ? 'bg-red-600 text-white border-red-500 hover:bg-red-700' 
                : 'bg-slate-900/90 text-white border-white/10 hover:bg-slate-800'
            }`}
          >
            {selecting ? `❌ إلغاء (${polygonPoints.length} نقاط)` : '✂️ قص منطقة'}
          </button>
          
          {selecting && polygonPoints.length >= 3 && (
            <button 
              onClick={finishPolygonSelection} 
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white border border-blue-500 px-4 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors"
            >
              ✅ إنهاء التحديد ({polygonPoints.length} نقاط)
            </button>
          )}
          
          {geographicBBox && (
            <>
              <button 
                onClick={saveSelectionAsTiff} 
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 px-4 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors"
              >
                💾 حفظ المقطع كـ TIFF
              </button>
              <button 
                onClick={cancelSelection} 
                className="rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-4 py-2.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors"
              >
                🧹 مسح التحديد
              </button>
            </>
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

        <button
          onClick={() => setActivePanel(activePanel === 'import' ? null : 'import')}
          title="استيراد ملفات GIS جغرافية (KML, GeoJSON, Shapefile)"
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-semibold shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 border ${
            activePanel === 'import' 
              ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-750' 
              : 'bg-slate-900/90 text-white border-white/10 hover:bg-slate-800'
          }`}
        >
          📂
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

      {activePanel === 'import' && (
        <div className="absolute top-20 right-20 z-50 w-[340px] bg-slate-900/95 backdrop-blur-lg border border-white/10 text-white shadow-2xl rounded-2xl flex flex-col p-4 space-y-4 pointer-events-auto max-h-[80vh] overflow-y-auto">
          <div className="flex justify-between items-center border-b border-white/10 pb-2">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">📂 استيراد ملفات GIS جغرافية</h4>
            <button onClick={() => setActivePanel(null)} className="text-slate-400 hover:text-white transition-colors">✕</button>
          </div>
          
          {/* Dropzone zone / File picker */}
          <div 
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleImportFile(e); }}
            className="border-2 border-dashed border-white/20 hover:border-amber-500/50 rounded-xl p-6 text-center cursor-pointer transition-all duration-200 hover:bg-white/5 relative group"
          >
            <input 
              type="file" 
              multiple 
              accept=".kml,.kmz,.geojson,.json,.zip"
              onChange={handleImportFile}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="text-2xl mb-1 text-slate-400 group-hover:scale-110 transition-transform">📥</div>
            <p className="text-xs font-semibold text-slate-300">اسحب الملفات هنا أو اضغط للاختيار</p>
            <p className="text-[10px] text-slate-400 mt-1">يدعم KML, KMZ, GeoJSON, Shapefile (ZIP)</p>
          </div>

          {importLoading && (
            <div className="flex items-center justify-center gap-2 text-xs text-amber-400">
              <span className="animate-spin">🌀</span>
              <span>جاري تحليل وإسقاط الملف...</span>
            </div>
          )}

          {importError && (
            <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-500/30 text-[11px] text-red-300 leading-relaxed">
              ⚠️ {importError}
            </div>
          )}

          {/* List of imported layers */}
          <div className="space-y-2.5">
            <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">📦 الطبقات المستوردة ({gisLayers.length})</h5>
            {gisLayers.length === 0 ? (
              <p className="text-[11px] text-slate-500 text-center py-2">لا توجد طبقات جغرافية مستوردة حالياً.</p>
            ) : (
              <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                {gisLayers.map((ly) => (
                  <div key={ly.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-950/40 border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex flex-col min-w-0 pr-1">
                      <span className="text-[11px] font-semibold text-slate-200 truncate" title={ly.name}>{ly.name}</span>
                      <span className="text-[9px] text-slate-400 uppercase font-mono">{ly.type}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={() => toggleLayerVisibility(ly.id)}
                        className={`p-1.5 rounded-md transition-colors ${ly.visible ? 'text-amber-400 hover:bg-white/5' : 'text-slate-500 hover:bg-white/5'}`}
                        title={ly.visible ? "إخفاء الطبقة" : "إظهار الطبقة"}
                      >
                        {ly.visible ? '👁️' : '👁️‍🗨️'}
                      </button>
                      <button 
                        onClick={() => removeLayer(ly.id)}
                        className="p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-white/5 transition-colors"
                        title="حذف الطبقة"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}


    </div>
  );
}
