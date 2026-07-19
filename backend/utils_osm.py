import json
import urllib.parse
from threading import Thread
from datetime import datetime
import requests
from agent_system.memory import SharedMemory

def fetch_and_save_osm_reference(city: str, min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> int:
    bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    query = f"""
    [out:json][timeout:30];
    (
      nwr["building"]({bbox_str});
      nwr["highway"]({bbox_str});
      nwr["waterway"]({bbox_str});
    );
    out geom;
    """
    
    overpass_urls = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter",
        "https://z.overpass-api.de/api/interpreter",
        "https://overpass-api.de/api/interpreter"
    ]
    
    headers = {
        "User-Agent": "YemenLandClassificationApp/1.0",
        "Accept": "application/json"
    }
    
    response = None
    for url in overpass_urls:
        try:
            encoded_query = urllib.parse.quote(query)
            full_url = f"{url}?data={encoded_query}"
            res = requests.get(full_url, headers=headers, timeout=15)
            if res.status_code == 200:
                response = res
                break
        except Exception:
            continue
            
    if response is None:
        print("[OSM Fetch] Warning: All Overpass API mirrors failed or timed out.")
        return 0
        
    data = response.json()
    elements = data.get("elements", [])
    features = []
    
    for elem in elements:
        elem_type = elem.get("type")
        elem_id = f"osm_{elem_type}_{elem.get('id')}"
        tags = elem.get("tags", {})
        
        category = "building"
        if "highway" in tags:
            category = "road"
        elif "waterway" in tags:
            category = "waterway"
            
        tags["category"] = category
        tags["source"] = "OpenStreetMap"
        
        geometry = None
        if "geometry" in elem:
            geom_coords = elem["geometry"]
            coords = [[pt["lon"], pt["lat"]] for pt in geom_coords]
            
            if category == "building" and len(coords) >= 3:
                if coords[0] != coords[-1]:
                    coords.append(coords[0])
                geometry = {
                    "type": "Polygon",
                    "coordinates": [coords]
                }
            elif category == "road" or category == "waterway":
                geometry = {
                    "type": "LineString",
                    "coordinates": coords
                }
        elif elem_type == "node" and "lat" in elem and "lon" in elem:
            geometry = {
                "type": "Point",
                "coordinates": [elem["lon"], elem["lat"]]
            }
            
        if geometry:
            features.append({
                "type": "Feature",
                "id": elem_id,
                "geometry": geometry,
                "properties": tags
            })
            
    if features:
        mem = SharedMemory()
        saved = mem.save_reference_features(city, features)
        print(f"[OSM Fetch] Successfully saved {saved} reference features for {city}")
        return saved
    return 0

def trigger_osm_fetch_in_background(task_id: str, city: str = "Sanaa"):
    def run():
        try:
            mem = SharedMemory()
            layers = mem.get_task_layers(task_id)
            lons = []
            lats = []
            for layer in layers:
                geo_polys = layer.get("geo_polygons")
                if isinstance(geo_polys, str):
                    try:
                        geo_polys = json.loads(geo_polys)
                    except Exception:
                        geo_polys = []
                
                for poly in geo_polys:
                    coords_list = poly
                    if len(coords_list) > 0 and isinstance(coords_list[0], list) and isinstance(coords_list[0][0], list):
                        coords_list = coords_list[0]
                    for pt in coords_list:
                        if len(pt) >= 2:
                            lons.append(pt[0])
                            lats.append(pt[1])
            
            if lons and lats:
                min_lon, min_lat = min(lons), min(lats)
                max_lon, max_lat = max(lons), max(lats)
                # Expand slightly to cover bounds (±0.002 degrees padding)
                fetch_and_save_osm_reference(city, min_lon - 0.002, min_lat - 0.002, max_lon + 0.002, max_lat + 0.002)
            else:
                task_info = mem.get_task(task_id)
                meta = task_info.get("metadata", {}) if task_info else {}
                if isinstance(meta, str):
                    try:
                        meta = json.loads(meta)
                    except Exception:
                        meta = {}
                ref_lat = meta.get("ref_latitude")
                ref_lon = meta.get("ref_longitude")
                if ref_lat and ref_lon:
                    ref_lat = float(ref_lat)
                    ref_lon = float(ref_lon)
                    fetch_and_save_osm_reference(city, ref_lon - 0.01, ref_lat - 0.01, ref_lon + 0.01, ref_lat + 0.01)
        except Exception as e:
            print(f"[OSM Background Fetch] Error: {e}")

    thread = Thread(target=run, daemon=True)
    thread.start()
