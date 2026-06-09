import io
from pathlib import Path
from PIL import Image, ImageDraw
import requests

# Create a synthetic aerial-style test image
output_path = Path('temp_upload_test.png')
width, height = 1024, 768
img = Image.new('RGB', (width, height), color=(150, 180, 120))
draw = ImageDraw.Draw(img)
# Draw some simple fields and roads
for y in range(0, height, 96):
    draw.line([(0, y), (width, y)], fill=(120, 140, 90), width=12)
for x in range(0, width, 128):
    draw.line([(x, 0), (x, height)], fill=(110, 130, 80), width=10)
# Add a simple river shape
river = [(0, 300), (200, 310), (380, 280), (520, 330), (720, 300), (900, 340), (1024, 320)]
draw.line(river, fill=(50, 120, 180), width=60)
img.save(output_path)
print(f'Created test image: {output_path.absolute()}')

# Upload to backend
url = 'http://localhost:8000/tasks/analyze'
with open(output_path, 'rb') as f:
    files = {'file': ('temp_upload_test.png', f, 'image/png')}
    data = {
        'pixel_scale_meters': '0.5',
        'ref_latitude': '24.7136',
        'ref_longitude': '46.6753'
    }
    resp = requests.post(url, files=files, data=data, timeout=120)
    print('Status code:', resp.status_code)
    try:
        print('Response:', resp.json())
    except Exception:
        print('Response text:', resp.text)
