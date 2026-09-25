"""
storage.py — object storage access for the orchestrator (MinIO/S3-compatible).

Same endpoint/credential environment as the Next.js S3 storage driver
(S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_FORCE_PATH_STYLE)
so both sides address identical objects.

Responsibilities here are narrow:
  - fetch the ORIGINAL image bytes for inference (read-only — the original
    object is never written by the AI stack)
  - persist AI outputs as SEPARATE objects:
        {hospitalId}/imaging/{patientId}/{studyId}/ai/{engine}/result.json
        {hospitalId}/imaging/{patientId}/{studyId}/ai/{engine}/annotated.png
    (the {hospitalId} leading segment keeps the objects inside the existing
    tenant guard used by /api/uploads)
"""

from __future__ import annotations

import base64
import json
import logging
import os

import boto3

log = logging.getLogger("orchestrator.storage")


class StorageError(Exception):
    pass


class ObjectStorage:
    def __init__(self) -> None:
        self.bucket = os.environ.get("S3_BUCKET", "dental-erp-uploads")
        self._client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("S3_ENDPOINT") or None,
            aws_access_key_id=os.environ.get("S3_ACCESS_KEY"),
            aws_secret_access_key=os.environ.get("S3_SECRET_KEY"),
            region_name=os.environ.get("S3_REGION") or "us-east-1",
            config=__import__("botocore").client.Config(
                s3={"addressing_style": "path"}
                if os.environ.get("S3_FORCE_PATH_STYLE", "true").strip().lower()
                in ("1", "true", "yes")
                else "virtual"
            ),
        )

    def get_object(self, key: str) -> bytes:
        try:
            resp = self._client.get_object(Bucket=self.bucket, Key=key)
            return resp["Body"].read()
        except Exception as exc:
            raise StorageError(f"cannot fetch {key!r}: {exc}") from exc

    def put_json(self, key: str, payload: dict) -> None:
        data = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
        self._put(key, data, "application/json")

    def put_png(self, key: str, png_hex: str) -> None:
        self._put(key, base64.b64decode(png_hex), "image/png")

    def _put(self, key: str, data: bytes, content_type: str) -> None:
        try:
            self._client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
        except Exception as exc:
            raise StorageError(f"cannot store {key!r}: {exc}") from exc


def ai_output_keys(hospital_id: str, patient_id: str, study_id: str, engine: str) -> tuple[str, str]:
    """(result.json key, annotated.png key) — tenant-scoped, AI-specific."""
    base = f"{hospital_id}/imaging/{patient_id}/{study_id}/ai/{engine}"
    return f"{base}/result.json", f"{base}/annotated.png"
