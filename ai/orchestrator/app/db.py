"""
db.py — thin MySQL access for the AI job state machine and audit events.

Deliberately thin (parameterized SQL only, no ORM): the orchestrator owns the
PENDING -> PROCESSING -> COMPLETED/FAILED transitions and the AI_JOB_* audit
events; Next.js owns job creation and doctor review. All writes are
parameterized; no f-string SQL.

The AIAnalysisJob columns written here mirror the Prisma model exactly
(prisma/schema.prisma — Phase 19A).
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone

import pymysql

log = logging.getLogger("orchestrator.db")

TERMINAL = ("COMPLETED", "FAILED", "CANCELLED")


def _parse_database_url(url: str) -> dict:
    m = re.match(
        r"^mysql://(?P<user>[^:@]+):(?P<password>[^@]*)@"
        r"(?P<host>[^:/]+)(?::(?P<port>\d+))?/(?P<db>\w+)",
        url,
    )
    if not m:
        raise ValueError(f"Unsupported DATABASE_URL (expected mysql://...): {url[:24]}***")
    return {
        "user": m.group("user"),
        "password": m.group("password"),
        "host": m.group("host"),
        "port": int(m.group("port") or 3306),
        "database": m.group("db"),
    }


class JobError(Exception):
    """Job state problem (not found, wrong state, wrong tenant)."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")


class JobStore:
    def __init__(self, database_url: str):
        cfg = _parse_database_url(database_url)
        self._cfg = cfg
        self._conn = None

    def connect(self) -> None:
        self._conn = pymysql.connect(
            host=self._cfg["host"],
            port=self._cfg["port"],
            user=self._cfg["user"],
            password=self._cfg["password"],
            database=self._cfg["database"],
            charset="utf8mb4",
            autocommit=False,
        )

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def _execute(self, sql: str, params: tuple | list = ()):
        if self._conn is None:
            self.connect()
        with self._conn.cursor() as cur:
            cur.execute(sql, params)
            return cur

    def ping(self) -> bool:
        try:
            self.connect()
            self._execute("SELECT 1")
            return True
        except Exception as exc:
            log.warning("db ping failed: %s", exc)
            return False

    # ------------------------------------------------------------------ jobs

    def get_job(self, job_id: str) -> dict | None:
        cur = self._execute(
            "SELECT id, hospitalId, studyId, engine, status, errorMessage, "
            "findings, reviewedById, reviewedAt, reviewDecision, reviewNotes, "
            "createdAt, updatedAt FROM AIAnalysisJob WHERE id = %s",
            (job_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        keys = [
            "id", "hospitalId", "studyId", "engine", "status", "errorMessage",
            "findings", "reviewedById", "reviewedAt", "reviewDecision", "reviewNotes",
            "createdAt", "updatedAt",
        ]
        job = dict(zip(keys, row))
        if isinstance(job.get("findings"), str):
            try:
                job["findings"] = json.loads(job["findings"])
            except (TypeError, ValueError):
                pass
        return job

    def get_study(self, study_id: str) -> dict | None:
        cur = self._execute(
            "SELECT id, hospitalId, patientId, status FROM ImagingStudy WHERE id = %s",
            (study_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {"id": row[0], "hospitalId": row[1], "patientId": row[2], "status": row[3]}

    def claim_job_processing(self, job_id: str, hospital_id: str) -> dict:
        """PENDING -> PROCESSING, tenant-guarded. Returns the previous job row.

        Atomic: the UPDATE matches on both id AND status=PENDING AND
        hospitalId, so concurrent claimants cannot double-process.
        """
        now = _utcnow()
        cur = self._execute(
            "UPDATE AIAnalysisJob SET status='PROCESSING', startedAt=%s, updatedAt=%s "
            "WHERE id=%s AND status='PENDING' AND hospitalId=%s",
            (now, now, job_id, hospital_id),
        )
        self._conn.commit()
        if cur.rowcount != 1:
            existing = self.get_job(job_id)
            if existing is None:
                raise JobError(404, f"job {job_id} not found")
            if existing["hospitalId"] != hospital_id:
                # Never reveal another tenant's job state: 404, not 403.
                raise JobError(404, f"job {job_id} not found")
            raise JobError(409, f"job {job_id} is {existing['status']}, not PENDING")
        return existing or {}

    def complete_job(
        self,
        job_id: str,
        *,
        findings: list,
        confidence: float | None,
        model_version: str | None,
        model_checksum: str | None,
        model_source: str | None,
        model_license: str | None,
        orchestrator_version: str | None,
        processing_time_ms: int | float,
        raw_output_key: str | None,
        provenance: dict,
    ) -> None:
        now = _utcnow()
        self._execute(
            "UPDATE AIAnalysisJob SET "
            "status='COMPLETED', completedAt=%s, processingTimeMs=%s, "
            "findings=%s, confidence=%s, provenance=%s, "
            "modelVersion=%s, modelChecksum=%s, modelSource=%s, modelLicense=%s, "
            "orchestratorVersion=%s, rawOutputKey=%s, errorMessage=NULL, updatedAt=%s "
            "WHERE id=%s",
            (
                now, processing_time_ms, json.dumps(findings), confidence,
                json.dumps(provenance),
                model_version, model_checksum, model_source, model_license,
                orchestrator_version, raw_output_key, now, job_id,
            ),
        )
        self._conn.commit()

    def fail_job(self, job_id: str, error_message: str) -> None:
        now = _utcnow()
        self._execute(
            "UPDATE AIAnalysisJob SET status='FAILED', completedAt=%s, "
            "errorMessage=%s, updatedAt=%s WHERE id=%s AND status IN ('PENDING','PROCESSING')",
            (now, error_message[:2000], now, job_id),
        )
        self._conn.commit()

    def mark_study_analyzed(self, study_id: str, hospital_id: str) -> None:
        self._execute(
            "UPDATE ImagingStudy SET status='ANALYZED', updatedAt=%s "
            "WHERE id=%s AND hospitalId=%s AND status='UPLOADED'",
            (_utcnow(), study_id, hospital_id),
        )
        self._conn.commit()

    # ----------------------------------------------------------------- audit

    def audit(
        self,
        *,
        hospital_id: str,
        action: str,
        entity_type: str,
        entity_id: str,
        new_values: dict | None = None,
        user_id: str | None = None,
    ) -> None:
        """One AuditLog row (existing model & conventions). System events
        pass user_id=None; no secrets may appear in new_values."""
        self._execute(
            "INSERT INTO AuditLog "
            "(id, hospitalId, userId, action, entityType, entityId, newValues, createdAt) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                uuid.uuid4().hex,  # AuditLog.id is an opaque unique string
                hospital_id, user_id, action, entity_type, entity_id,
                json.dumps(new_values) if new_values is not None else None,
                _utcnow(),
            ),
        )
        self._conn.commit()
