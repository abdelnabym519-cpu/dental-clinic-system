# MeshSegNet-Max engine — Phase 19B. CPU-only, offline-capable.
#
# The model is NOT in this build context (and must never be committed): it is
# mounted read-only at /app/models/ by ai-compose.yml from the SHA-256-verified
# local artifact (ai-validation/meshsegnet/model/README.md). The engine
# verifies the checksum on load and refuses to start on mismatch.
#
# libgl1: the VTK wheel (pulled in by vedo, used for non-obj mesh formats and
# for the official decimation step) needs libGL.so.1 at import time.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_PATH=/app/models/MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip \
    DEVICE=cpu \
    LOG_LEVEL=info

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY app ./app

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
