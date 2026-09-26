"""
Regression tests for the REAL JobStore.claim_job_processing.

The conftest FakeJobStore re-implements the claim semantics in memory, so the
real SQL-level method was never exercised by the suite. It shipped with an
UnboundLocalError on the SUCCESS path (rowcount == 1): `existing` was only
assigned inside the `rowcount != 1` branch, so `return existing or {}`
crashed every successful claim — surfacing as HTTP 503
"job state store unavailable" from /analyze.
"""

from __future__ import annotations

import pytest

from app.db import JobError, JobStore

_KEYS = [
    "id", "hospitalId", "studyId", "engine", "status", "errorMessage",
    "findings", "reviewedById", "reviewedAt", "reviewDecision", "reviewNotes",
    "createdAt", "updatedAt",
]


def row(id: str = "job-1", hospitalId: str = "hosp-1", status: str = "PENDING") -> tuple:
    """A get_job() row tuple, in the SELECT column order of db.get_job."""
    data = {
        "id": id, "hospitalId": hospitalId, "studyId": "study-1",
        "engine": "liodon", "status": status, "errorMessage": None,
        "findings": None, "reviewedById": None, "reviewedAt": None,
        "reviewDecision": None, "reviewNotes": None,
        "createdAt": "now", "updatedAt": "now",
    }
    return tuple(data[k] for k in _KEYS)


class _FakeCursor:
    def __init__(self, entry: dict):
        self._entry = entry
        self.executed: list[tuple[str, tuple]] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql: str, params: tuple = ()):
        self.executed.append((sql, params))

    @property
    def rowcount(self) -> int:
        return self._entry.get("rowcount", 0)

    def fetchone(self):
        rows = self._entry.setdefault("rows", [])
        return rows.pop(0) if rows else None


class _FakeConn:
    """One scripted entry per cursor() call: get_job=SELECT, UPDATE, ..."""

    def __init__(self, script: list[dict]):
        self.script = script
        self.calls: list[_FakeCursor] = []
        self.commits = 0

    def cursor(self) -> _FakeCursor:
        cur = _FakeCursor(self.script[len(self.calls)])
        self.calls.append(cur)
        return cur

    def commit(self):
        self.commits += 1


def make_store(script: list[dict]) -> tuple[JobStore, _FakeConn]:
    store = JobStore("mysql://root:x@127.0.0.1:3306/dental_erp")
    conn = _FakeConn(script)
    store._conn = conn  # skip the real pymysql.connect
    return store, conn


def test_claim_success_returns_preclaim_row_and_does_not_crash():
    # The regression itself: rowcount == 1 must return the pre-claim row,
    # not raise UnboundLocalError.
    store, conn = make_store([
        {"rows": [row(status="PENDING")]},  # pre-fetch
        {"rowcount": 1},                    # UPDATE won the claim
    ])
    result = store.claim_job_processing("job-1", "hosp-1")
    assert result["id"] == "job-1"
    assert result["status"] == "PENDING"  # pre-claim row, per the docstring
    updates = [
        c for c in conn.calls
        if c.executed and c.executed[0][0].startswith("UPDATE")
    ]
    assert len(updates) == 1
    assert "status='PENDING'" in updates[0].executed[0][0]  # atomic guard intact
    assert conn.commits >= 1


def test_claim_missing_job_raises_404():
    store, _ = make_store([
        {"rows": []},  # pre-fetch: no row
        {"rowcount": 0},  # UPDATE matched nothing
        {"rows": []},  # error re-fetch: still no row
    ])
    with pytest.raises(JobError) as ei:
        store.claim_job_processing("job-1", "hosp-1")
    assert ei.value.status_code == 404
    assert "not found" in ei.value.message


def test_claim_wrong_tenant_raises_404_no_oracle():
    foreign = row(hospitalId="hosp-2")
    store, _ = make_store([
        {"rows": [foreign]},
        {"rowcount": 0},
        {"rows": [foreign]},
    ])
    with pytest.raises(JobError) as ei:
        store.claim_job_processing("job-1", "hosp-1")
    assert ei.value.status_code == 404
    assert "not found" in ei.value.message  # 404, never 403 — no tenant oracle


def test_claim_lost_race_raises_409_with_current_status():
    # Pre-fetch saw PENDING, but another claimant won the UPDATE.
    store, _ = make_store([
        {"rows": [row(status="PENDING")]},
        {"rowcount": 0},
        {"rows": [row(status="PROCESSING")]},  # re-fetch: status changed under us
    ])
    with pytest.raises(JobError) as ei:
        store.claim_job_processing("job-1", "hosp-1")
    assert ei.value.status_code == 409
    assert "PROCESSING" in ei.value.message
