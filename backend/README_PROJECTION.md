# Projection demo

This small guide explains how to run the projection demo locally. The demo runs `ProjectionAgent` on a single image and writes extracted layers into the shared SQLite memory.

Dependencies
- Python packages: `opencv-python`, `numpy` (required)
- Optional: `torch`, `segment-anything`, `rasterio` if you want SAM and GeoTIFF support

Install (recommended inside a virtualenv):

```bash
pip install opencv-python numpy
# optional:
pip install torch torchvision
pip install segment-anything rasterio
```

Run demo

From repository root:

```bash
python backend/tests/run_projection_demo.py /full/path/to/your_image.jpg demo_task_001
```

What to expect
- A task will be created (or reused) in `backend/shared_memory.db`.
- A processed image will be saved next to the input image with suffix `_processed.png`.
- Extracted layers appear in the `task_layers` table; the demo prints a short summary.

Notes
- If SAM model is not available the demo falls back to edge-based segmentation.
- The demo uses a simple color heuristic to label segments (`agricultural`, `water`, `buildings`, `roads`, `unknown`).
