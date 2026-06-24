// إعدادات الخريطة الجغرافية
export const MAP_CONFIG = {
  // مركز الخريقة الافتراضي (الرياض)
  defaultCenter: [24.7136, 46.6753] as [number, number],
  defaultZoom: 10,
  
  // نظام الإحداثيات
  coordinateSystem: 'EPSG:4326', // WGS 84
  projection: 'WGS84',
  
  // حدود السعودية
  saudiBounds: {
    north: 32.158333,
    south: 16.366667,
    west: 34.566667,
    east: 55.666667
  }
};

// أنماط الطبقات حسب ملف الورد
export const LAYER_STYLES = {
  // وكلاء الفريق
  agents: {
    orchestrator: { color: '#3498db', name: 'وكيل المنسق' },
    extractor: { color: '#2ecc71', name: 'وكيل الإسقاط' },
    land_agent: { color: '#e74c3c', name: 'وكيل الأراضي' },
    road_agent: { color: '#f39c12', name: 'وكيل الطرق' },
    building_agent: { color: '#9b59b6', name: 'وكيل المباني' },
    water_agent: { color: '#1abc9c', name: 'وكيل المسطحات المائية' },
    reviewer: { color: '#e67e22', name: 'وكيل الناقد' }
  },
  
  // أنواع التصنيف (من ملف PDF + الورد)
  classifications: {
    // القاموس المحلي (من PDF)
    jirba: { color: '#27ae60', name: 'جِرْبَة', description: 'أرض زراعية' },
    rafd: { color: '#f1c40f', name: 'رَفْد', description: 'أرض يابسة/مرتفع' },
    kurwa: { color: '#d35400', name: 'كُرْوَ ة', description: 'منخفض/وادي' },
    
    // تصنيفات إضافية (من الورد)
    agricultural: { color: '#2ecc71', name: 'أرض زراعية' },
    forest: { color: '#27ae60', name: 'غابة/أشجار' },
    mountainous: { color: '#7f8c8d', name: 'أرض جبلية/صخرية' },
    barren: { color: '#d35400', name: 'أرض بور/فارغة' },
    
    // المباني (من الورد)
    residential: { color: '#e74c3c', name: 'سكني' },
    commercial: { color: '#c0392b', name: 'تجاري' },
    governmental: { color: '#8e44ad', name: 'حكومي' },
    informal: { color: '#f39c12', name: 'عشوائي' },
    
    // الطرق (من الورد)
    paved: { color: '#34495e', name: 'معبد' },
    dirt: { color: '#d35400', name: 'ترابي' },
    livestock: { color: '#f39c12', name: 'مواشي' },
    
    // المسطحات المائية (من الورد)
    river: { color: '#3498db', name: 'نهر' },
    irrigation: { color: '#2980b9', name: 'قناة ري' },
    lake: { color: '#1abc9c', name: 'بحيرة' }
  }
};

// صيغ التصدير (من كلا الملفين)
export const EXPORT_FORMATS = {
  // من PDF
  geojson: { name: 'GeoJSON', extension: '.geojson', description: 'للوحة الويب والأندرويد' },
  shapefile: { name: 'Shapefile', extension: '.shp', description: 'لبرامج GIS (ArcGIS Pro, QGIS)' },
  kml: { name: 'KML', extension: '.kml', description: 'لـ Google Earth' },
  dxf: { name: 'DXF', extension: '.dxf', description: 'للأغراض الهندسية' },
  
  // من الورد
  kmz: { name: 'KMZ', extension: '.kmz', description: 'Google Earth مضغوط' },
  geopackage: { name: 'GeoPackage', extension: '.gpkg', description: 'قاعدة بيانات جغرافية' },
  csv: { name: 'CSV', extension: '.csv', description: 'إحداثيات جدولية' },
  gpx: { name: 'GPX', extension: '.gpx', description: 'للتطبيقات الميدانية' },
  mbtiles: { name: 'MBTiles', extension: '.mbtiles', description: 'خرائط للهاتف' }
};

// مراحل المعالجة (من كلا الملفين)
export const PROCESSING_STAGES = {
  // من PDF
  upload: { id: 'upload', name: 'جاري الرفع', description: 'استقبال الصورة الجوية' },
  boundary_extraction: { id: 'boundary_extraction', name: 'جاري استخراج الحدود', description: 'عزل وتحديد الحدود' },
  agent_classification: { id: 'agent_classification', name: 'جاري تصنيف وكيل الأراضي', description: 'تصنيف الأراضي بالذكاء الاصطناعي' },
  gis_generation: { id: 'gis_generation', name: 'جاري توليد ملفات الـGIS', description: 'إنشاء الملفات الجغرافية' },
  
  // من الورد
  orchestrator_planning: { id: 'orchestrator_planning', name: 'جاري تخطيط المنسق', description: 'توزيع المهام على الوكلاء' },
  extractor_processing: { id: 'extractor_processing', name: 'جاري معالجة المقتطف', description: 'وكيل الإسقاط يعمل' },
  specialist_processing: { id: 'specialist_processing', name: 'جاري تصنيف المتخصصين', description: 'الوكلاء المتخصصون يعملون' },
  reviewer_checking: { id: 'reviewer_checking', name: 'جاري تدقيق الناقد', description: 'فحص التناقضات' }
};

// إعدادات API (جاهزة للربط)
const rawBaseURL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || '/api';
export const API_CONFIG = {
  baseURL: rawBaseURL.replace(/\/+$/, ''),
  endpoints: {
    // Backend agent swarm endpoints
    upload: '/tasks/analyze',
    status: '/tasks/{task_id}/status',
    report: '/tasks/{task_id}/report',
    logs: '/tasks/{task_id}/logs',
    tasks: '/tasks'
  },
  timeout: 120000 // 120 ثانية (من PDF)
};

export const getApiUrl = (endpoint: string) => {
  if (endpoint.startsWith('/')) {
    return `${API_CONFIG.baseURL}${endpoint}`;
  }
  return `${API_CONFIG.baseURL}/${endpoint}`;
};