# Backend container for FastAPI + GDAL/PROJ-based land classification
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV CPL_TO_WGS84=YES
ENV PROJ_NETWORK=ON
ENV PORT=8000

WORKDIR /app

# تثبيت حزم النظام الجغرافية والترجمة أولاً
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

# ضبط مسارات المترجم للتعرف على حزم النظام الجغرافية أثناء تثبيت مكتبات بايثون
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

# نسخ ملف المتطلبات بمسار صريح ومباشر وتثبيته
COPY ./requirements.txt /app/requirements.txt
RUN pip install --upgrade pip setuptools wheel \
    && pip install -r /app/requirements.txt

# نسخ بقية ملفات المشروع وكود السيرفر
COPY . /app

EXPOSE 8000

# تشغيل السيرفر وقراءة المنفذ ديناميكياً لتوافق التام مع سحابة Railway
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT} --proxy-headers --timeout-keep-alive 120"]