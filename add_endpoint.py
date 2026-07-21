import re
import uuid

with open('backend/api.py', 'r', encoding='utf-8') as f:
    content = f.read()

match = re.search(r'@app\.get\("/crop/from_tiles"[\s\S]+?return FileResponse[^\n]+\n', content)
if match:
    new_func = match.group(0).replace('def crop_from_tiles(', 'def analyze_from_tiles(').replace('"/crop/from_tiles"', '"/crop/analyze_from_tiles"').replace('قص من مصدر', 'تحليل من مصدر')
    new_return = '''
        # ---- Start Background Task ----
        task_id = "task_" + uuid.uuid4().hex[:8]
        file_hash = hashlib.sha256(open(out_path, "rb").read()).hexdigest()
        
        task_metadata = {
            "image_type": "geospatial",
            "geospatial_crs": "EPSG:3857",
            "use_geo_metadata": True,
            "pixel_scale_meters": 0.5,
            "ref_latitude": min_lat,
            "ref_longitude": min_lon
        }
        
        created = memory.create_task(task_id, out_path, task_metadata, image_hash=file_hash)
        if created:
            memory.update_task_status(task_id, "PENDING")
            launch_background_processing(task_id, out_path)
            return {"task_id": task_id, "status": "PENDING"}
        else:
            raise HTTPException(status_code=500, detail="Failed to create task")
'''
    new_func = re.sub(r'return FileResponse[^\n]+\n', new_return, new_func)
    content = content[:match.end()] + '\n\n' + new_func + content[match.end():]
    
    with open('backend/api.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Added analyze_from_tiles endpoint.')
else:
    print('Failed to find crop_from_tiles')
