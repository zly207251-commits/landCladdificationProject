"use client";

import { useEffect, useRef } from "react";

// قراءة معطيات الاستعلام من الـ URL مباشرة عند تحميل الصفحة
function getSearchParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function CesiumPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // تحميل CSS و JS من CDN
    const cesiumCss = document.createElement('link');
    cesiumCss.rel = 'stylesheet';
    cesiumCss.href = 'https://cdn.jsdelivr.net/npm/cesium@1.119/Build/Cesium/Widgets/widgets.css';
    document.head.appendChild(cesiumCss);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/cesium@1.119/Build/Cesium/Cesium.js';
    script.async = true;
    script.onload = () => {
      // @ts-ignore
      const Cesium = (window as any).Cesium;
      if (!Cesium) return;

      // تعيين توكن Cesium Ion من متغير البيئة
      const token = process.env.NEXT_PUBLIC_CESIUM_TOKEN || '';
      if (token) {
        Cesium.Ion.defaultAccessToken = token;
      }

      // تهيئة الـ Viewer
      const viewer = new Cesium.Viewer(containerRef.current, {
        terrainProvider: Cesium.createWorldTerrain(),
        timeline: false,
        animation: false,
      });

      // إضافة تحكم بسيط لعرض الطبقات
      viewer.scene.globe.depthTestAgainstTerrain = true;

      // مثال: إضافة مصدر صور Cesium Ion (world imagery) عن طريق Asset ID إن أردت
      // قراءة معطيات الاستعلام: assetId, geojson (inline), geojsonUrl
      const params = getSearchParams();
      try {
        const assetId = params.get('assetId');
        if (assetId) {
          try {
            const ionRes = Cesium.IonResource.fromAssetId(Number(assetId));
            // استخدام مورد الـ Ion كـ مصدر صور (قد يحتاج تكوين إضافي حسب نوع الـ Asset)
            const provider = new Cesium.UrlTemplateImageryProvider({ url: ionRes.url || ionRes._url || '' });
            viewer.imageryLayers.addImageryProvider(provider);
          } catch (e) {
            console.warn('Could not add Cesium Ion asset as imagery provider', e);
          }
        }
      } catch (e) {}

      // تحميل GeoJSON إمّا من معطى JSON مشفّر أو من رابط
      try {
        const geojsonInline = params.get('geojson');
        const geojsonUrl = params.get('geojsonUrl');
        if (geojsonInline) {
          const parsed = JSON.parse(decodeURIComponent(geojsonInline));
          Cesium.GeoJsonDataSource.load(parsed).then((ds: any) => viewer.dataSources.add(ds));
        } else if (geojsonUrl) {
          Cesium.GeoJsonDataSource.load(geojsonUrl).then((ds: any) => viewer.dataSources.add(ds));
        }
      } catch (e) {
        console.warn('Failed to load GeoJSON into Cesium', e);
      }

    };
    document.body.appendChild(script);

    return () => {
      // تنظيف العناصر المضافة
      try {
        if (cesiumCss.parentNode) cesiumCss.parentNode.removeChild(cesiumCss);
      } catch {}
      try {
        if (script.parentNode) script.parentNode.removeChild(script);
      } catch {}
    };
  }, []);

  return (
    <div className="min-h-screen">
      <div className="p-4">
        <h2 className="text-xl font-semibold">عرض Cesium (مرجع الخرائط العالمي)</h2>
        <p className="text-sm text-gray-600">يمكن استخدام هذا العرض كمرجع إسقاطات وطبقات ثلاثية الأبعاد.</p>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '80vh' }} />
    </div>
  );
}
