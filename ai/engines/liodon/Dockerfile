# Liodon engine — Phase 19A. CPU-only, offline-capable.
#
# The model is NOT in this build context (and must never be committed): it is
# mounted read-only at /app/models/liodon/best.onnx by ai-compose.yml from
# the SHA-256-verified local artifact (ai-validation/liodon/model/README.md).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_PATH=/app/models/liodon/best.onnx \
    DEVICE=cpu \
    LOG_LEVEL=info

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
