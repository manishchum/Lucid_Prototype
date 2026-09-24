# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies required by OpenCV (YOLO) and Whisper
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libxcb1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install them
COPY Backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set environment variables
ENV PYTHONPATH=/app/Backend
ENV PORT=8080

# Expose port
EXPOSE 8080

# Command to run the application
CMD ["uvicorn", "Backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
