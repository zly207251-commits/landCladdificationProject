"use client";

import { useEffect, useRef, useState } from "react";
import { API_CONFIG } from "@/app/lib/map-config";
import {
  Search, Menu, Layers, FolderOpen, Compass, Plus, Minus, Navigation,
  Map as MapIcon, Scissors, X, Download, Home, Info, Crosshair, Eye, EyeOff, Trash2, UploadCloud
} from "lucide-react";

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
    description: 'خريطة الشوارع العالمية الأساسية',
  },
  {
    id: 'gibs_truecolor',
    label: 'NASA GIBS TrueColor',
    description: 'صور الأقمار الصناعية NASA GIBS للألوان الحقيقية',
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

  // Selection references for 3D polygon drawing
  const currentSelectionEntityRef = useRef<any>(null);
  const polygonPointsRef = useRef<any[]>([]);
  const polygonEntitiesRef = useRef<any[]>([]);

  // State definitions
  const [isLoaded, setIsLoaded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<any[]>([]);
  const [geographicBBox, setGeographicBBox] = useState<{ minLon: number; maxLon: number; minLat: number; maxLat: number } | null>(null);
  const [exportLink, setExportLink] = useState<string | null>(null);

  // Camera & view states
  const [lat, setLat] = useState(15.3694);
  const [lon, setLon] = useState(44.1910);
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

  // GIS Layer Importer states
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
        // Display hybrid google maps (lyrs=y) with streets/places for navigation
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
    let cameraUpdateInterval: any;

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
          fullscreenButton: false,
          infoBox: true,
          selectionIndicator: true,
          sceneModePicker: false,
          navigationHelpButton: false,
          homeButton: false,
          vrButton: false,
          geocoder: false,
          scene3DOnly: false,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        });

        // Set up the default satellite layers
        const layers = viewerRef.current.imageryLayers;
        layers.removeAll();
        layers.addImageryProvider(imageryProvider);

        // Improve visual quality
        const scene = viewerRef.current.scene;
        scene.skyAtmosphere.hueShift = -0.1;
        scene.skyAtmosphere.brightnessShift = 0.1;
        scene.skyAtmosphere.saturationShift = 0.1;

        // Initial camera position (Riyadh / Yemen default)
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
                viewerRef.current.zoomTo(dataSource);
                setStatusMessage("تم تحميل طبقة المعالم بنجاح.");
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

  // Handle point-by-point drawing selection (Cropping Tool)
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

        // Draw pin entity on globe
        const pointEntity = viewerRef.current.entities.add({
          name: `نقطة مضلع ${polygonPointsRef.current.length}`,
          position: cartesian,
          point: {
            color: Cesium.Color.RED,
            pixelSize: 8,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        });
        polygonEntitiesRef.current.push(pointEntity);

        // Draw transparent yellow polygon area when points >= 3
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

  // Disable camera controls when in drawing mode
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

  const cancelSelection = () => {
    if (viewerRef.current) {
      // Remove points
      for (const ent of polygonEntitiesRef.current) {
        viewerRef.current.entities.remove(ent);
      }
      polygonEntitiesRef.current = [];
      
      // Remove polygon
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
      if (!geographicBBox) throw new Error('يرجى تحديد منطقة للقص أولاً.');
      const { minLon, maxLon, minLat, maxLat } = geographicBBox;
      const base = API_CONFIG.baseURL || 'http://localhost:8000';

      if (taskId) {
        const downloadUrl = `${base}/tasks/${taskId}/crop?min_lon=${minLon}&min_lat=${minLat}&max_lon=${maxLon}&max_lat=${maxLat}`;
        setExportLink(downloadUrl);
        window.open(downloadUrl, '_blank');
        return;
      }

      // No taskId -> request tiles crop using clean satellite imagery (lyrs=s) to avoid city/road labels
      const getTileTemplate = () => {
        switch (selectedProvider) {
          case 'esri': return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
          case 'google': return 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'; // Clean Google tiles
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

  // Map Navigation Controls
  const zoomIn = () => viewerRef.current?.camera.zoomIn(viewerRef.current.camera.positionCartographic.height * 0.2);
  const zoomOut = () => viewerRef.current?.camera.zoomOut(viewerRef.current.camera.positionCartographic.height * 0.2);
  const resetCompass = () => {
    if (!viewerRef.current) return;
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
            duration: 2
          });
          setTimeout(() => setStatusMessage(""), 3000);
        },
        () => {
          setStatusMessage("فشل في تحديد موقعك الجغرافي");
          setTimeout(() => setStatusMessage(""), 3000);
        }
      );
    }
  };

  // local GIS Layers Dropzone & loading
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

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) => {
    let files: File[] = [];
    if ('dataTransfer' in e && e.dataTransfer?.files) {
      files = Array.from(e.dataTransfer.files);
    } else if ('target' in e && (e.target as HTMLInputElement).files) {
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
          
          // Style adjustments for KML
          const entities = dataSource.entities.values;
          for (const entity of entities) {
            if (entity.polygon) {
              if (entity.polygon.material && entity.polygon.material.color) {
                const originalColor = entity.polygon.material.color.getValue(Cesium.JulianDate.now());
                if (originalColor) {
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
            id: Math.random().toString(36).substring(2, 9),
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
    <div ref={wrapperRef} className="relative w-full h-full bg-slate-950 overflow-hidden select-none">
      
      {/* 1. Cesium Container */}
      <div ref={containerRef} className="w-full h-full absolute inset-0 z-10 pointer-events-auto" />

      {/* 2. Left Menu Bar */}
      <div className="absolute top-6 left-6 z-40 flex items-center gap-3">
        <button className="w-12 h-12 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white hover:bg-white/10 hover:border-white/20 transition-all duration-300 shadow-2xl">
          <Menu className="w-6 h-6" />
        </button>
        <div className="h-8 w-px bg-white/10" />
        <h1 className="text-white font-bold text-lg tracking-wide hidden sm:block drop-shadow-lg">وكيل تصنيف الأراضي</h1>
      </div>

      {/* 3. Right Sidebar Icons */}
      <div className="absolute top-6 right-6 z-40 flex flex-col gap-3">
        <div className="flex flex-col bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 gap-1.5 shadow-2xl">
          <NavIcon icon={<Search className="w-5 h-5" />} label="بحث جيوغرافي" active={activeTab === 'search'} onClick={() => setActiveTab(activeTab === 'search' ? null : 'search')} />
          <NavIcon icon={<Layers className="w-5 h-5" />} label="الطبقات والاستيراد" active={activeTab === 'layers'} onClick={() => setActiveTab(activeTab === 'layers' ? null : 'layers')} />
          <NavIcon icon={<FolderOpen className="w-5 h-5" />} label="المشاريع السابقة" active={activeTab === 'projects'} onClick={() => setActiveTab(activeTab === 'projects' ? null : 'projects')} />
          <div className="h-px bg-white/10 w-full" />
          <NavIcon icon={<Scissors className="w-5 h-5" />} label="أدوات القص" active={activeTab === 'tools'} onClick={() => setActiveTab(activeTab === 'tools' ? null : 'tools')} />
        </div>
        
        <button onClick={flyToMyLocation} className="w-12 h-12 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white hover:bg-white/10 hover:border-white/20 transition-all duration-300 shadow-2xl">
          <Navigation className="w-5 h-5 rotate-45" />
        </button>
      </div>

      {/* 4. Sliding Sidebar Drawer */}
      <div className={`absolute top-0 bottom-0 right-16 w-80 bg-black/60 backdrop-blur-2xl border-l border-white/5 z-40 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] shadow-2xl ${activeTab ? 'translate-x-0' : 'translate-x-full'}`}>
        {activeTab && (
          <div className="h-full flex flex-col p-6">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold text-white tracking-wide">
                {activeTab === 'layers' && 'الطبقات والاستيراد'}
                {activeTab === 'projects' && 'المشاريع'}
                {activeTab === 'tools' && 'أدوات الخريطة'}
                {activeTab === 'search' && 'بحث'}
              </h2>
              <button onClick={() => setActiveTab(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
              {activeTab === 'layers' && (
                <div className="space-y-6">
                  {/* Satellites List */}
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
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                      />
                      <button onClick={updateImageryLayer} className="w-full mt-2 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors">
                        تحديث التاريخ
                      </button>
                    </div>
                  )}

                  <div className="h-px bg-white/10 w-full" />

                  {/* Local GIS File Importer */}
                  <div className="space-y-4">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">استيراد ملفات GIS محلية</label>
                    
                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); handleImportFile(e); }}
                      className="border-2 border-dashed border-white/10 hover:border-blue-500/40 rounded-xl p-5 text-center cursor-pointer transition-all duration-200 hover:bg-white/5 relative group"
                    >
                      <input 
                        type="file" 
                        multiple 
                        accept=".kml,.kmz,.geojson,.json,.zip"
                        onChange={handleImportFile}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <UploadCloud className="w-8 h-8 text-slate-400 mx-auto mb-2 group-hover:scale-110 transition-transform" />
                      <p className="text-xs font-medium text-slate-300">اسحب الملفات هنا أو انقر للاختيار</p>
                      <p className="text-[9px] text-slate-500 mt-1">يدعم KML, KMZ, GeoJSON, Shapefile ZIP</p>
                    </div>

                    {importLoading && (
                      <div className="flex items-center justify-center gap-2 text-xs text-blue-400 animate-pulse">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <span>جاري تحليل وإسقاط الملف...</span>
                      </div>
                    )}

                    {importError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 rounded-xl leading-relaxed">
                        ⚠️ {importError}
                      </div>
                    )}

                    {/* Layers list */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">الطبقات المستوردة ({gisLayers.length})</label>
                      {gisLayers.length === 0 ? (
                        <p className="text-[10px] text-slate-500 text-center py-2 bg-white/5 rounded-xl border border-white/5">لا توجد مستندات مستوردة</p>
                      ) : (
                        <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar">
                          {gisLayers.map(ly => (
                            <div key={ly.id} className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-all">
                              <div className="flex flex-col min-w-0 pr-2 text-right">
                                <span className="text-xs text-slate-200 truncate font-medium" title={ly.name}>{ly.name}</span>
                                <span className="text-[8px] text-slate-500 font-mono uppercase">{ly.type}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button 
                                  onClick={() => toggleLayerVisibility(ly.id)} 
                                  className={`p-1.5 rounded-lg hover:bg-white/5 ${ly.visible ? 'text-blue-400' : 'text-slate-500'}`}
                                >
                                  {ly.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                </button>
                                <button 
                                  onClick={() => removeLayer(ly.id)} 
                                  className="p-1.5 rounded-lg hover:bg-white/5 text-red-400 hover:text-red-300"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
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
                      انقر متتالياً لتحديد نقاط مضلع قص المنطقة المقفلة لتصديرها كملف TIFF عالي الدقة.
                    </p>

                    <div className="flex flex-col gap-2.5">
                      <button
                        onClick={() => {
                          if (selecting) {
                            cancelSelection();
                          } else {
                            cancelSelection();
                            setSelecting(true);
                            setActiveTab(null); // Close sidebar for easier drawing
                          }
                        }}
                        className={`w-full py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all shadow-lg ${selecting
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20 border border-transparent'
                          }`}
                      >
                        {selecting ? (
                          <><X className="w-4 h-4" /> إلغاء التحديد</>
                        ) : (
                          <><Crosshair className="w-4 h-4" /> بدء تحديد النقاط</>
                        )}
                      </button>

                      {selecting && polygonPoints.length >= 3 && (
                        <button
                          onClick={finishPolygonSelection}
                          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all border border-transparent animate-in fade-in zoom-in-95 duration-200"
                        >
                          ✅ إنهاء التحديد ({polygonPoints.length} نقاط)
                        </button>
                      )}
                    </div>
                  </div>

                  {geographicBBox && (
                    <div className="p-4 bg-emerald-900/20 border border-emerald-500/20 rounded-2xl space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                      <div className="flex justify-between items-center text-emerald-400 text-sm font-medium">
                        <span>تم تحديد المنطقة بنجاح</span>
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

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={saveSelectionAsTiff}
                          className="col-span-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
                        >
                          <Download className="w-4 h-4" /> معالجة وحفظ TIFF
                        </button>
                        <button
                          onClick={cancelSelection}
                          className="col-span-2 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-medium transition-colors"
                        >
                          إعادة رسم
                        </button>
                      </div>

                      {exportLink && (
                        <a
                          href={exportLink}
                          download
                          className="block text-center text-xs text-blue-400 hover:text-blue-300 py-2 mt-2 bg-blue-500/10 rounded-lg border border-blue-500/20"
                        >
                          رابط التحميل المباشر للـ TIFF
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
