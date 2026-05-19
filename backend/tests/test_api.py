from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.settings import settings


def test_health_and_seeded_businesses(tmp_path: Path) -> None:
    original_db_path = settings.db_path
    settings.db_path = str(tmp_path / "test.db")
    try:
        db.init_db()
        client = TestClient(app)

        health = client.get("/health")
        businesses = client.get("/businesses")

        assert health.status_code == 200
        assert health.json() == {"status": "ok"}
        assert businesses.status_code == 200
        assert {item["id"] for item in businesses.json()} == {
            "biz_toms_hvac",
            "biz_mister_electricity",
        }
    finally:
        settings.db_path = original_db_path
