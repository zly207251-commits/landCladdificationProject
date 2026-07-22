from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
import os
import json
import tempfile
import zipfile
import shutil

from routes.shared import memory, remove_file

export_router = APIRouter(prefix="/tasks", tags=["export"])

@export_router.get("/{task_id}/export", summary="تصدير طبقات المهمة بصيغ جغرافية مختلفة")
def export_task_layers(task_id: str, format: str, background_tasks: BackgroundTasks):
    task = memory.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="المهمة المطلوبة غير موجودة.")
        
    layers = memory.get_task_layers(task_id)
    if not layers:
        raise HTTPException(status_code=404, detail="لا توجد بيانات مساحية أو مضلعات لهذه المهمة.")
        
    format = format.lower().strip()
    
    # 1. تصدير GeoJSON
    if format == "geojson":
        features = []
        for ly in layers:
            layer_name = ly.get('layer_name', 'unknown')
            geo_polygons = ly.get('geo_polygons') or []
            for polygon in geo_polygons:
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": polygon
                    },
                    "properties": {
                        "layer_name": layer_name,
                        "area_sq_meters": ly["area_sq_meters"],
                        "area_agricultural": f"{ly['area_feddan']} فدان، {ly['area_qirat']} قيراط، {ly['area_sahm']:.2f} سهم",
                        "description": ly["metadata"].get("description", "")
                    }
                })
        geojson_data = {"type": "FeatureCollection", "features": features}
        
        fd, path = tempfile.mkstemp(suffix=".geojson")
        os.close(fd)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, ensure_ascii=False, indent=2)
            
        if background_tasks:
            background_tasks.add_task(remove_file, path)
        return FileResponse(path, media_type="application/geo+json", filename=f"export_{task_id}.geojson")
        
    # 2. تصدير KML / KMZ
    elif format in ["kml", "kmz"]:
        def hex_to_kml_color(hex_str: str, default: str = "7fcccccc") -> str:
            if not hex_str:
                return default
            hex_str = hex_str.lstrip('#')
            if len(hex_str) == 6:
                r, g, b = hex_str[0:2], hex_str[2:4], hex_str[4:6]
                return f"7f{b}{g}{r}"
            elif len(hex_str) == 8:
                r, g, b, a = hex_str[0:2], hex_str[2:4], hex_str[4:6], hex_str[6:8]
                return f"{a}{b}{g}{r}"
            return default

        try:
            import simplekml
            kml = simplekml.Kml(name=f"Layers for {task_id}")
            
            # Get custom styling from task metadata
            task_meta = task.get("metadata") or {}
            if isinstance(task_meta, str):
                try:
                    task_meta = json.loads(task_meta)
                except Exception:
                    task_meta = {}
            custom_styling = task_meta.get("styling") or {}
            
            styles = {
                "buildings": {"color": "7f0000ff", "width": 2},
                "roads": {"color": "7f00ffff", "width": 3},
                "water_bodies": {"color": "7fff0000", "width": 2},
                "vegetation": {"color": "7f00ff00", "width": 2},
                "bare_land": {"color": "7fcccccc", "width": 1},
                "agricultural": {"color": "7f00ff00", "width": 2},
                "forest": {"color": "7f008800", "width": 2},
                "mountainous": {"color": "7f8b4513", "width": 2},
                "residential": {"color": "7f0000ff", "width": 2},
                "commercial": {"color": "7f0000ff", "width": 2}
            }
            
            for ly in layers:
                layer_name = ly.get('layer_name', 'unknown')
                normalized_key = layer_name.strip().lower()
                
                fol = kml.newfolder(name=layer_name)
                geo_polygons = ly.get('geo_polygons') or []
                
                for idx, polygon in enumerate(geo_polygons):
                    ring = polygon
                    if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                        ring = polygon[0]
                    
                    coords = [(float(pt[0]), float(pt[1])) for pt in ring if isinstance(pt, (list, tuple)) and len(pt) >= 2]
                    if len(coords) >= 3:
                        pol = fol.newpolygon(name=f"{layer_name} {idx+1}", outerboundaryis=coords)
                        
                        # Apply style
                        custom_cfg = custom_styling.get(normalized_key) or custom_styling.get(layer_name)
                        if custom_cfg:
                            c_color = hex_to_kml_color(custom_cfg.get("color"), "7fcccccc")
                            c_width = float(custom_cfg.get("width", 2))
                            pol.style.linestyle.color = c_color
                            pol.style.linestyle.width = c_width
                            pol.style.polystyle.color = c_color
                        else:
                            style_cfg = styles.get(normalized_key) or styles.get(layer_name)
                            if style_cfg:
                                pol.style.linestyle.color = style_cfg["color"]
                                pol.style.linestyle.width = style_cfg["width"]
                                pol.style.polystyle.color = style_cfg["color"]
                            else:
                                pol.style.linestyle.color = "7fcccccc"
                                pol.style.polystyle.color = "33cccccc"
                        
                        pol.style.polystyle.fill = 0
                        pol.style.polystyle.outline = 1
                            
            fd, path = tempfile.mkstemp(suffix=f".{format}")
            os.close(fd)
            
            if format == "kml":
                kml.save(path)
                if background_tasks:
                    background_tasks.add_task(remove_file, path)
                return FileResponse(path, media_type="application/vnd.google-earth.kml+xml", filename=f"export_{task_id}.kml")
            else:
                kml.savekmz(path)
                if background_tasks:
                    background_tasks.add_task(remove_file, path)
                return FileResponse(path, media_type="application/vnd.google-earth.kmz", filename=f"export_{task_id}.kmz")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"فشل إنشاء ملف KML/KMZ: {str(e)}")
            
    # 3. تصدير Shapefile (Zipped SHP folder)
    elif format == "shp":
        try:
            import geopandas as gpd
            from shapely.geometry import Polygon as ShapelyPolygon
            
            features = []
            for ly in layers:
                layer_name = ly.get('layer_name', 'unknown')
                geo_polygons = ly.get('geo_polygons') or []
                for polygon in geo_polygons:
                    ring = polygon
                    if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                        ring = polygon[0]
                    coords = [(float(pt[0]), float(pt[1])) for pt in ring if isinstance(pt, (list, tuple)) and len(pt) >= 2]
                    if len(coords) >= 3:
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])
                        geom = ShapelyPolygon(coords)
                        features.append({
                            "geometry": geom,
                            "layer_name": layer_name,
                            "area_sqm": float(ly["area_sq_meters"]),
                            "feddan": int(ly["area_feddan"]),
                            "qirat": int(ly["area_qirat"]),
                            "sahm": float(ly["area_sahm"])
                        })
                        
            if not features:
                raise ValueError("لا توجد مضلعات صالحة لتصديرها كـ Shapefile")
                
            gdf = gpd.GeoDataFrame(features, crs="EPSG:4326")
            
            temp_dir = tempfile.mkdtemp()
            shp_base_name = f"export_{task_id}"
            shp_path = os.path.join(temp_dir, f"{shp_base_name}.shp")
            gdf.to_file(shp_path, driver="ESRI Shapefile", encoding="utf-8")
            
            fd, path = tempfile.mkstemp(suffix=".zip")
            os.close(fd)
            
            with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, dirs, files in os.walk(temp_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        zipf.write(file_path, arcname=file)
                        
            shutil.rmtree(temp_dir)
            if background_tasks:
                background_tasks.add_task(remove_file, path)
            return FileResponse(path, media_type="application/zip", filename=f"export_{task_id}.zip")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"فشل إنشاء ملف Shapefile: {str(e)}")

    # تصدير AutoCAD DXF
    elif format == "dxf":
        try:
            import ezdxf
            from pyproj import Transformer

            doc = ezdxf.new(dxfversion='AC1024')  # DXF version AutoCAD 2008
            msp = doc.modelspace()

            # Define standard layers with standard AutoCAD index colors (ACI)
            layers_def = {
                "مبنى": {"layer": "BUILDINGS", "color": 1},      # Red
                "building": {"layer": "BUILDINGS", "color": 1},
                "building_google": {"layer": "BUILDINGS", "color": 1},
                "شارع": {"layer": "ROADS", "color": 8},          # Gray
                "road": {"layer": "ROADS", "color": 8},
                "مزرعة": {"layer": "AGRICULTURAL", "color": 3},   # Green
                "agricultural": {"layer": "AGRICULTURAL", "color": 3},
                "وادي": {"layer": "WATER_BODIES", "color": 5},    # Blue
                "water_body": {"layer": "WATER_BODIES", "color": 5},
                "أرض": {"layer": "LAND_ZONES", "color": 2},       # Yellow
                "land": {"layer": "LAND_ZONES", "color": 2},
                "جبل": {"layer": "MOUNTAINS", "color": 40},       # Brown/Orange
                "mountain": {"layer": "MOUNTAINS", "color": 40},
            }

            # Pre-create all layers in DXF
            dxf_layer_names = set()
            for l_info in layers_def.values():
                dxf_name = l_info["layer"]
                if dxf_name not in dxf_layer_names:
                    doc.layers.new(name=dxf_name, dxfattribs={'color': l_info["color"]})
                    dxf_layer_names.add(dxf_name)

            # Default layer for others
            default_layer_name = "OTHERS"
            doc.layers.new(name=default_layer_name, dxfattribs={'color': 7}) # White/Black

            # Initialize Projection Transformer to convert degrees to Web Mercator meters (EPSG:3857)
            transformer = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)

            features_count = 0
            for ly in layers:
                layer_name = ly.get('layer_name', 'unknown')
                normalized_key = layer_name.strip().lower()
                
                layer_cfg = layers_def.get(normalized_key) or layers_def.get(layer_name)
                if layer_cfg:
                    target_layer = layer_cfg["layer"]
                else:
                    target_layer = default_layer_name

                geo_polygons = ly.get('geo_polygons') or []
                for polygon in geo_polygons:
                    ring = polygon
                    if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                        ring = polygon[0]

                    points_meters = []
                    for pt in ring:
                        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                            x, y = transformer.transform(float(pt[0]), float(pt[1]))
                            points_meters.append((x, y))

                    if len(points_meters) >= 3:
                        if points_meters[0] == points_meters[-1]:
                            points_meters = points_meters[:-1]
                        
                        msp.add_lwpolyline(points_meters, dxfattribs={'layer': target_layer, 'closed': True})
                        features_count += 1

            if features_count == 0:
                raise ValueError("لا توجد معالم مساحية صالحة لتصديرها بصيغة DXF")

            fd, path = tempfile.mkstemp(suffix=".dxf")
            os.close(fd)
            
            doc.saveas(path)
            
            if background_tasks:
                background_tasks.add_task(remove_file, path)
            return FileResponse(path, media_type="image/vnd.dxf", filename=f"export_{task_id}.dxf")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"فشل إنشاء ملف AutoCAD DXF: {str(e)}")

    # 4. تصدير CSV (إحداثيات المضلعات)
    elif format == "csv":
        import csv
        fd, path = tempfile.mkstemp(suffix=".csv")
        os.close(fd)
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["layer_name", "area_sq_meters", "area_agricultural", "polygon_index", "longitude", "latitude"])
            for ly in layers:
                layer_name = ly.get('layer_name', 'unknown')
                geo_polygons = ly.get('geo_polygons') or []
                for idx, polygon in enumerate(geo_polygons):
                    ring = polygon
                    if isinstance(polygon, list) and len(polygon) > 0 and isinstance(polygon[0], list) and len(polygon[0]) > 0 and isinstance(polygon[0][0], list):
                        ring = polygon[0]
                    for pt in ring:
                        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                            writer.writerow([
                                layer_name,
                                ly["area_sq_meters"],
                                f"{ly['area_feddan']} فدان، {ly['area_qirat']} قيراط، {ly['area_sahm']:.2f} سهم",
                                idx,
                                float(pt[0]),
                                float(pt[1])
                            ])
        if background_tasks:
            background_tasks.add_task(remove_file, path)
        return FileResponse(path, media_type="text/csv", filename=f"export_{task_id}.csv")
        
    else:
        raise HTTPException(status_code=400, detail=f"صيغة التصدير '{format}' غير مدعومة.")
