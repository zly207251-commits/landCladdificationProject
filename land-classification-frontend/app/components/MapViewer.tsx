"use client";

import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, LayersControl, GeoJSON, Polygon, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_CONFIG, LAYER_STYLES } from '@/app/lib/map-config';
import html2canvas from 'html2canvas';
import axios from 'axios';

// إصلاح أيقونات Leaflet - استخدام SVG مدمج
const createCustomIcon = () => {
  const svgIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" fill="#3498db">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12z"/>
    </svg>
  `;
  
  return L.divIcon({
    className: 'custom-marker',
    html: svgIcon,
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -36]
  });
};

// إنشاء الأيقونة
let defaultIcon: L.DivIcon | null = null;
if (typeof window !== 'undefined') {
  defaultIcon = createCustomIcon();
}

interface MapViewerProps {
  geojsonData?: any;
  onPolygonClick?: (feature: any) => void;
  selectedFeature?: any;
  editMode?: boolean;
  useDefaultIcon?: boolean;
  center?: [number, number] | null;
  zoom?: number | null;
}

export default function MapViewer({ 
  geojsonData, 
  onPolygonClick, 
  selectedFeature,
  editMode = false,
  useDefaultIcon = true,
  center = null,
  zoom = null
}: MapViewerProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [selecting, setSelecting] = useState<boolean>(false);
  const [startLatLng, setStartLatLng] = useState<L.LatLng | null>(null);
  const [rectLayer, setRectLayer] = useState<L.Rectangle | null>(null);
  const [exportLink, setExportLink] = useState<string | null>(null);
  const [tileLoadError, setTileLoadError] = useState<boolean>(false);
  const [useFallbackTiles, setUseFallbackTiles] = useState<boolean>(false);
  const [activeTileSourceIndex, setActiveTileSourceIndex] = useState<number>(0);

  const errorTileUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6GXo9kAAAAASUVORK5CYII=';
  const fallbackTileUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAAP0lEQVR4Xu3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8FchDgAB/tzDEwAAAABJRU5ErkJggg==';

  const tileSources = [
    {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    },
    {
      url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.fr/">OpenStreetMap France</a> contributors'
    },
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>'
    }
  ];

  const currentTileSource = tileSources[activeTileSourceIndex] || tileSources[0];

  const tileLayerOptions = {
    errorTileUrl,
    eventHandlers: {
      tileerror: () => {
        if (activeTileSourceIndex < tileSources.length - 1) {
          setActiveTileSourceIndex(activeTileSourceIndex + 1);
        } else {
          setTileLoadError(true);
          setUseFallbackTiles(true);
        }
      },
      tileload: () => setTileLoadError(false)
    }
  };

  const resetTileLoadError = () => {
    setTileLoadError(false);
    setUseFallbackTiles(false);
    setActiveTileSourceIndex(0);
    if (map) {
      map.invalidateSize();
    }
  };

  // أحداث الفأرة لاختيار المستطيل
  useEffect(() => {
    if (!map) return;

    const onMouseDown = (ev: L.LeafletMouseEvent) => {
      if (!selecting) return;
      setStartLatLng(ev.latlng);
      if (rectLayer && map) {
        try { map.removeLayer(rectLayer); } catch (e) {}
        setRectLayer(null);
      }
    };

    const onMouseMove = (ev: L.LeafletMouseEvent) => {
      if (!selecting || !startLatLng) return;
      const bounds = L.latLngBounds(startLatLng, ev.latlng);
      if (rectLayer) {
        rectLayer.setBounds(bounds);
      } else {
        const rect = L.rectangle(bounds, { color: 'red', weight: 1, dashArray: '4', fillOpacity: 0.05 });
        rect.addTo(map);
        setRectLayer(rect);
      }
    };

    const onMouseUp = (ev: L.LeafletMouseEvent) => {
      if (!selecting) return;
      setSelecting(false);
      setStartLatLng(null);
      // يبقى المستطيل حتى يضغط المستخدم زر الحفظ أو يزيله
    };

    map.on('mousedown', onMouseDown as any);
    map.on('mousemove', onMouseMove as any);
    map.on('mouseup', onMouseUp as any);

    return () => {
      map.off('mousedown', onMouseDown as any);
      map.off('mousemove', onMouseMove as any);
      map.off('mouseup', onMouseUp as any);
    };
  }, [map, selecting, startLatLng, rectLayer]);

  useEffect(() => {
    if (map) {
      map.invalidateSize();
    }
  }, [map, activeTileSourceIndex, useFallbackTiles]);

  // تنظيف عند فك التثبيت
  useEffect(() => {
    return () => {
      if (rectLayer && map) {
        try { map.removeLayer(rectLayer); } catch (e) {}
      }
    };
  }, []);

  // تعيين الأيقونة الافتراضية
  useEffect(() => {
    if (useDefaultIcon && defaultIcon) {
      L.Marker.prototype.options.icon = defaultIcon;
    }
  }, [useDefaultIcon]);

  // نمط الطبقات الديناميكي
  const getStyle = (feature: any) => {
    const layerType = feature?.properties?.layer_type || feature?.properties?.type;
    const classification = feature?.properties?.classification;
    
    // البحث عن اللون المناسب
    let color = '#cccccc'; // لون افتراضي
    
    if (layerType && LAYER_STYLES.agents[layerType as keyof typeof LAYER_STYLES.agents]) {
      color = LAYER_STYLES.agents[layerType as keyof typeof LAYER_STYLES.agents].color;
    } else if (classification && LAYER_STYLES.classifications[classification as keyof typeof LAYER_STYLES.classifications]) {
      color = LAYER_STYLES.classifications[classification as keyof typeof LAYER_STYLES.classifications].color;
    }
    
    return {
      fillColor: color,
      weight: 2,
      opacity: 1,
      color: 'white',
      dashArray: '3',
      fillOpacity: 0.7
    };
  };

  // معالجة النقر على المضلع
  const handleFeatureClick = (feature: any) => {
    if (onPolygonClick) {
      onPolygonClick(feature);
    }
  };

  const isValidCoordinate = (coord: any) => {
    return (
      Array.isArray(coord) &&
      coord.length >= 2 &&
      typeof coord[0] === 'number' &&
      typeof coord[1] === 'number' &&
      Number.isFinite(coord[0]) &&
      Number.isFinite(coord[1])
    );
  };

  const isLinearRing = (ring: any) => {
    return (
      Array.isArray(ring) &&
      ring.length >= 4 &&
      ring.every(isValidCoordinate) &&
      isValidCoordinate(ring[0]) &&
      isValidCoordinate(ring[ring.length - 1]) &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
    );
  };

  const isValidGeometry = (geometry: any) => {
    return (
      geometry?.type === 'Polygon' &&
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.every(isLinearRing)
    );
  };

  const isValidFeature = (feature: any) => {
    return (
      feature?.type === 'Feature' &&
      isValidGeometry(feature.geometry)
    );
  };

  const isValidFeatureCollection = (data: any) => {
    return (
      data?.type === 'FeatureCollection' &&
      Array.isArray(data.features) &&
      data.features.every(isValidFeature)
    );
  };

  // وظيفة عرض GeoJSON
  const renderGeoJSON = () => {
    if (!geojsonData || !isValidFeatureCollection(geojsonData)) {
      console.warn('Invalid GeoJSON object in MapViewer:', geojsonData);
      return null;
    }

    const onEachFeature = (feature: any, layer: L.Layer) => {
      layer.on({
        click: () => handleFeatureClick(feature)
      });

      // إضافة Popup
      const popupContent = `
        <div style="direction: rtl; text-align: right;">
          <strong>${feature.properties?.name || 'معلم جغرافي'}</strong><br/>
          <hr/>
          ${feature.properties?.layer_type ? `<div>الطبقة: ${feature.properties.layer_type}</div>` : ''}
          ${feature.properties?.classification ? `<div>التصنيف: ${feature.properties.classification}</div>` : ''}
          ${feature.properties?.area ? `<div>المساحة: ${feature.properties.area} كم²</div>` : ''}
          ${feature.properties?.description ? `<div>الوصف: ${feature.properties.description}</div>` : ''}
        </div>
      `;

      layer.bindPopup(popupContent);
    };

    return (
      <GeoJSON
        key={JSON.stringify(geojsonData)}
        data={geojsonData}
        style={getStyle}
        onEachFeature={onEachFeature}
      />
    );
  };

  // إضافة طبقات OSM مع فشل آمن في تحميل البلاطات
  const baseLayers = {
    "الخريطة العادية": (
      <TileLayer
        key="osm"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        {...tileLayerOptions}
      />
    ),
    "الخريطة الجغرافية": (
      <TileLayer
        key="topo"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
        {...tileLayerOptions}
      />
    ),
    "صور الأقمار الصناعية": (
      <TileLayer
        key="satellite"
        attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        {...tileLayerOptions}
      />
    )
  };

  const mapCenter = center || MAP_CONFIG.defaultCenter;
  const mapZoom = zoom || MAP_CONFIG.defaultZoom;

  return (
    <div className="relative h-full w-full">
      {/* أزرار اختيار المنطقة والتصدير */}
      <div className="absolute top-4 left-20 z-[1002] flex space-x-2">
        <button
          onClick={() => {
            if (!map) return alert('الخريطة غير جاهزة');
            setSelecting(!selecting);
            setExportLink(null);
            // تنظيف أي مستطيل قديم
            if (rectLayer) {
              try { map.removeLayer(rectLayer); } catch (e) {}
              setRectLayer(null);
            }
          }}
          className={`inline-flex items-center rounded-md px-3 py-2 text-xs font-semibold ring-1 ${selecting ? 'bg-blue-600 text-white ring-blue-300' : 'bg-white text-gray-800 ring-gray-200'}`}
        >
          {selecting ? 'إنهاء التحديد' : 'ابدأ تحديد المنطقة'}
        </button>

        {rectLayer && (
          <button
            onClick={async () => {
              if (!map) return alert('الخريطة غير جاهزة');

              try {
                const container = map.getContainer();
                const bounds = rectLayer.getBounds();

                // تحويل الإحداثيات إلى نقاط الحاوية (px)
                const p1 = map.latLngToContainerPoint(bounds.getNorthWest());
                const p2 = map.latLngToContainerPoint(bounds.getSouthEast());

                const left = Math.min(p1.x, p2.x);
                const top = Math.min(p1.y, p2.y);
                const width = Math.abs(p2.x - p1.x);
                const height = Math.abs(p2.y - p1.y);

                // التقاط الخريطة بكاملها ثم اقتطاع الجزئية المطلوبة
                const canvas = await html2canvas(container as HTMLElement, { useCORS: true, logging: false });
                const cropped = document.createElement('canvas');
                cropped.width = Math.max(1, Math.round(width));
                cropped.height = Math.max(1, Math.round(height));
                const ctx = cropped.getContext('2d');
                if (!ctx) throw new Error('تعذر الحصول على سياق الرسم');

                ctx.drawImage(canvas, left, top, width, height, 0, 0, width, height);

                // تحويل إلى blob ثم رفعها إلى backend لتحويلها إلى TIFF
                cropped.toBlob(async (blob) => {
                  if (!blob) return alert('فشل إنشاء الصورة');
                  const form = new FormData();
                  form.append('file', blob, 'map_capture.png');
                  try {
                    const resp = await axios.post((process.env.NEXT_PUBLIC_API_BASE || '') + '/save_map_tiff', form, { headers: { 'Content-Type': 'multipart/form-data' } });
                    const download = resp.data?.download_url;
                    if (download) {
                      setExportLink((process.env.NEXT_PUBLIC_API_BASE || '') + download);
                      // تنزيل تلقائي
                      window.open((process.env.NEXT_PUBLIC_API_BASE || '') + download, '_blank');
                    } else {
                      alert('تم الحفظ بنجاح');
                    }
                  } catch (e:any) {
                    console.error(e);
                    alert('فشل رفع الصورة إلى الخادم: ' + (e?.response?.data?.detail || e.message));
                  }
                }, 'image/png');
              } catch (e:any) {
                console.error(e);
                alert('خطأ أثناء التقاط المنطقة: ' + e.message);
              }
            }}
            className="inline-flex items-center rounded-md bg-green-100 px-3 py-2 text-xs font-semibold text-green-800 ring-1 ring-green-200 hover:bg-green-200"
          >
            حفظ كـ TIFF
          </button>
        )}

        {exportLink && (
          <a href={exportLink} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md bg-white px-3 py-2 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50">فتح TIFF</a>
        )}
      </div>
      {/* زر لفتح الطبقات الحالية في عرض Cesium (يفتح في نافذة جديدة) */}
      <div className="absolute top-4 left-4 z-[1002]">
        <button
          onClick={() => {
            if (!geojsonData) return alert('لا توجد بيانات لفتحها في Cesium');
            try {
              const encoded = encodeURIComponent(JSON.stringify(geojsonData));
              const assetId = process.env.NEXT_PUBLIC_CESIUM_ASSET_ID;
              const url = assetId ? `/cesium?geojson=${encoded}&assetId=${assetId}` : `/cesium?geojson=${encoded}`;
              window.open(url, '_blank');
            } catch (e) {
              alert('فشل تجهيز البيانات للفرونت: ' + e);
            }
          }}
          className="inline-flex items-center rounded-md bg-yellow-100 px-3 py-2 text-xs font-semibold text-yellow-800 ring-1 ring-yellow-200 hover:bg-yellow-200"
        >
          🛰️ افتح في Cesium
        </button>
      </div>
      {tileLoadError && (
        <div className="absolute inset-4 z-[1001] rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 shadow-md">
          <strong>تعذر الاتصال بخدمة الخرائط.</strong>
          <div>يرجى التحقق من الإنترنت أو تجربة إعادة تحميل الصفحة.</div>
          <button
            onClick={resetTileLoadError}
            className="mt-3 inline-flex items-center rounded-md bg-white px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50"
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        className="h-full w-full rounded-lg"
        whenCreated={setMap}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution={useFallbackTiles ? '' : currentTileSource.attribution}
          url={useFallbackTiles ? fallbackTileUrl : currentTileSource.url}
          tileSize={256}
          noWrap={useFallbackTiles}
          {...tileLayerOptions}
        />

        <LayersControl position="topright">
          <LayersControl.Overlay name="المعالم الجغرافية" checked>
            {renderGeoJSON()}
          </LayersControl.Overlay>

          {/* طبقة الشبكة (للتجربة) */}
          {editMode && (
            <LayersControl.Overlay name="شبكة الإحداثيات">
              <Polygon
                positions={[
                  [24.7, 46.6],
                  [24.8, 46.6],
                  [24.8, 46.7],
                  [24.7, 46.7],
                ]}
                pathOptions={{ color: 'blue', fillOpacity: 0 }}
              />
            </LayersControl.Overlay>
          )}
        </LayersControl>
      </MapContainer>

      {/* مفتاح الألوان */}
      <div className="absolute bottom-4 right-4 bg-white p-4 rounded-lg shadow-lg z-[1000] max-w-xs">
        <h4 className="font-semibold mb-3 text-gray-800 border-b pb-2">مفتاح التصنيف</h4>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {/* وكلاء الفريق */}
          <div className="mb-2">
            <h5 className="text-sm font-medium text-blue-700 mb-1">وكلاء الفريق</h5>
            {Object.entries(LAYER_STYLES.agents).slice(0, 3).map(([key, style]) => (
              <div key={key} className="flex items-center text-sm">
                <div className="w-4 h-4 rounded mr-2" style={{ backgroundColor: style.color }}></div>
                <span className="text-gray-600">{style.name}</span>
              </div>
            ))}
          </div>

          {/* التصنيفات */}
          <div className="mb-2">
            <h5 className="text-sm font-medium text-green-700 mb-1">تصنيف الأراضي</h5>
            {Object.entries(LAYER_STYLES.classifications).slice(0, 4).map(([key, style]) => (
              <div key={key} className="flex items-center text-sm">
                <div className="w-4 h-4 rounded mr-2" style={{ backgroundColor: style.color }}></div>
                <span className="text-gray-600">{style.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* معلومات الإحداثيات */}
      <div className="absolute top-4 right-4 bg-black bg-opacity-70 text-white p-2 rounded text-sm z-[1000]">
        <div>نظام الإحداثيات: {MAP_CONFIG.coordinateSystem}</div>
        <div>الإسقاط: {MAP_CONFIG.projection}</div>
      </div>
    </div>
  );
}