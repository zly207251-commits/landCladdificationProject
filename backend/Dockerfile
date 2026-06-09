# Backend container for FastAPI + GDAL/PROJ-based land classification
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV CPL_TO_WGS84=YES
ENV PROJ_NETWORK=ON
ENV PORT=8000

WORKDIR /app

# تثبيت حزم النظام الجغرافية والترجمة وأداة git الضرورية لسحب segment-anything
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
        git \
    && rm -rf /var/lib/apt/lists/*

# ضبط مسارات المترجم للتعرف على حزم النظام الجغرافية أثناء تثبيت مكتبات بايثون
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

# التعديل هنا: بما أن بيئة البناء داخل مجلد backend حالياً، فالملف متواجد في المسار الحالي مباشرة
COPY ./requirements.txt /app/requirements.txt

# تثبيت الحزم وحل مشكلة pkg_resources عبر تثبيت إصدار setuptools متوافق
RUN pip install --upgrade pip wheel \
    && pip install "setuptools<70.0.0" \
    && pip install -r /app/requirements.txt

# التعديل هنا: نسخ كل محتويات المجلد الحالي مباشرة إلى داخل الحاوية
COPY . /app

EXPOSE 8000

# تشغيل السيرفر وقراءة المنفذ ديناميكياً للتوافق التام مع سحابة Railway
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT} --proxy-headers --timeout-keep-alive 120"]