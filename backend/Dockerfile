# Backend container for FastAPI + GDAL/PROJ-based land classification
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV CPL_TO_WGS84=YES
ENV PROJ_NETWORK=ON
ENV GDAL_DATA=/usr/share/gdal
ENV PORT=8000

WORKDIR /app

# Install OS packages needed by GDAL/proj and Python build dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gdal-bin \
        libgdal-dev \
        libproj-dev \
        libgeos-dev \
        libspatialindex-dev \
        build-essential \
        gcc \
        python3-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifest and install Python packages
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel \
    && pip install -r requirements.txt

# Copy application code
COPY . .

EXPOSE 8000

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "${PORT}", "--proxy-headers", "--timeout-keep-alive", "120"]
