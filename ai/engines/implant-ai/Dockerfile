# Implant AI engine — Phase 19B (engine 2 of 3, port 8004).
#
# YOLOv8-segmentation checkpoint 8024.pt, loaded ONLY through the
# ultralytics restricted loader (ULTRALYTICS_SAFE_LOAD=1). The checkpoint
# is NOT baked into this image and NOT committed to git — it is mounted
# read-only from ai-validation/yolov8-8024/model/ (see ai-compose.yml) and
# verified against the audited SHA-256 at startup; on mismatch the
# container refuses to start (fail-closed, see app/model.py).

FROM python:3.11-slim

# opencv (pulled in by ultralytics) needs libGL + libglib on the slim image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

ENV MODEL_PATH=/app/models/8024.pt \
    DEVICE=cpu \
    PYTHONUNBUFFERED=1

EXPOSE 8004

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
