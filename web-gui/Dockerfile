FROM python:3.11-slim

# Install system dependencies required by audiblez
RUN apt-get update && apt-get install -y \
    ffmpeg \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy web GUI files
COPY requirements.txt .
COPY app.py .
COPY templates/ templates/
COPY static/ static/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install audiblez
RUN pip install --no-cache-dir audiblez

# Create necessary directories
RUN mkdir -p /ebooks /audiobooks/new /tmp/uploads

# Expose port
EXPOSE 5000

# Set environment variables
ENV FLASK_APP=app.py
ENV PYTHONUNBUFFERED=1

# Run the application
CMD ["python", "app.py"]
