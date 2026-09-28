# Orthodontic AI engine — Phase 19B (engine 3 of 3, port 8005). CPU-only.
#
# The audited checkpoint (model_pretrained_on_train_and_val.pth) is NOT in
# this build context and must never be committed: it is mounted read-only
# at /app/models/ by ai-compose.yml from the SHA-256-verified local artifact
# (ai-validation/cldetection2023). The engine verifies size + checksum and
# the checkpoint's pickle globals (bounded allow-list, strict
# weights_only load — AUDIT.md §7) and refuses to start on any mismatch.
#
# The audited repository (5k5000/CLdetection2023 @ 18d17d1934970016e7610c4849311900b8d1f191)
# is fetched at build time from its pinned tarball and checksum-verified
# before anything is installed from it (the vendored mmpose-1.0 fork, the
# srpose_s2.py config and the ceph metainfo all come from it).
#
# build-essential/python3-dev: the ONLY source build in the whole stack is
# xtcocotools' C++ extension (mmpose dependency). Everything else is wheels.
#
# libgl1 + libglib2.0-0: xtcocotools depends on the FULL opencv-python
# distribution (its wheel hard-requires it), whose cv2 import loads
# libGL.so.1 / libglib-2.0.so.0 on Linux. The headless pin in
# requirements.txt covers the direct import, but pip still installs the
# full wheel as xtcocotools' dependency — the OS libraries make the image
# loadable either way (same pattern as the meshsegnet-max Dockerfile,
# where the VTK wheel needs libGL.so.1).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_PATH=/app/models/model_pretrained_on_train_and_val.pth \
    REPO_PATH=/opt/cld2023 \
    LOG_LEVEL=info

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3-dev wget libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# --- the audited repository, pinned revision, checksum-gated ---
ARG CLD_REPO_REV=18d17d1934970016e7610c4849311900b8d1f191
ARG CLD_TARBALL_SHA256=895a83a19a60de1aabf08da357b83680e3a69143bc5600c08d2225a65bfc2655
RUN wget -q -O /tmp/cld2023.tar.gz \
        "https://codeload.github.com/5k5000/CLdetection2023/tar.gz/${CLD_REPO_REV}" \
    && echo "${CLD_TARBALL_SHA256}  /tmp/cld2023.tar.gz" | sha256sum -c - \
    && mkdir -p /opt/cld2023 \
    && tar -xzf /tmp/cld2023.tar.gz -C /opt/cld2023 --strip-components=1 \
    && rm /tmp/cld2023.tar.gz

COPY requirements.txt .
# CPU torch (same index convention as the meshsegnet engines); the audited
# stack pins are in requirements.txt.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# The vendored mmpose-1.0 fork — pure Python, no compilation, no deps
# (its runtime requirements are already installed above).
RUN pip install --no-cache-dir --no-deps -e /opt/cld2023/mmpose_package/mmpose

COPY app ./app

EXPOSE 8005

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
