# Use Python 3.11 slim image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

# Install system dependencies required by OpenCV (YOLO), PyMuPDF, FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    tesseract-ocr \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies first for efficient docker layer caching
COPY Backend/requirements.txt /app/Backend/requirements.txt
RUN pip install --no-cache-dir -r /app/Backend/requirements.txt

# Copy application code
COPY Backend /app/Backend

# Set working directory to Backend so root-level imports resolve cleanly
WORKDIR /app/Backend

ENV PYTHONPATH=/app/Backend:/app

EXPOSE 8080

# Run uvicorn respecting Cloud Run's $PORT variable
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
