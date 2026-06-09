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

# نسخ ملف المتطلبات من داخل مجلد backend في المستودع إلى داخل الحاوية
COPY ./backend/requirements.txt /app/requirements.txt

# تعديل السطر أدناه: تحديد إصدار setuptools لمنع اختفاء pkg_resources وتمرير بناء rasterio بنجاح
RUN pip install --upgrade pip wheel \
    && pip install "setuptools<70.0.0" \
    && pip install -r /app/requirements.txt

# نسخ بقية كود الباكيند فقط من مجلد backend إلى داخل الحاوية
COPY ./backend /app

EXPOSE 8000

# تشغيل السيرفر وقراءة المنفذ ديناميكياً لتوافق التام مع سحابة Railway
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT} --proxy-headers --timeout-keep-alive 120"]