from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.settings import settings


TOM_HEADERS = {"X-Business-Id": "biz_toms_hvac"}


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    original_db_path = settings.db_path
    settings.db_path = str(tmp_path / "test.db")
    try:
        db.init_db()
        with TestClient(app) as test_client:
            yield test_client
    finally:
        settings.db_path = original_db_path


def _create_payload(name: str = "plumbing repair") -> dict:
    return {
        "mode": "create",
        "service": {
            "name": name,
            "service_area": {
                "inherit_default": False,
                "zip_codes": ["78704", "78705"],
                "cities": [],
            },
            "availability": {
                "inherit_default": False,
                "windows": [
                    {"day": "monday", "open_time": "09:00", "close_time": "17:00"},
                    {"day": "tuesday", "open_time": "09:00", "close_time": "17:00"},
                ],
                "exceptions": [
                    {
                        "label": "Christmas Day",
                        "start": "2026-12-25T00:00:00-06:00",
                        "end": "2026-12-26T00:00:00-06:00",
                    }
                ],
            },
            "booking_policy": {"min_lead_minutes": 120, "max_advance_days": 30},
        },
    }


def test_create_service_persists_all_rule_types(client: TestClient) -> None:
    response = client.post("/service-wizard", headers=TOM_HEADERS, json=_create_payload())
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["service"] == "plumbing repair"
    assert len(body["created_rule_ids"]) == 3  # area + hours + booking_policy
    assert body["deleted_rule_ids"] == []

    rules = client.get("/rules", headers=TOM_HEADERS).json()
    types_for_service = {
        rule["type"]
        for rule in rules
        if rule["config"].get("service") == "plumbing repair"
    }
    assert types_for_service == {"service_area", "business_hours", "booking_policy"}

    offered = next(
        rule
        for rule in rules
        if rule["type"] == "services_offered" and not rule["config"].get("service")
    )
    assert "plumbing repair" in offered["config"]["services"]


def test_create_translates_exception_datetimes_to_inclusive_dates(client: TestClient) -> None:
    response = client.post("/service-wizard", headers=TOM_HEADERS, json=_create_payload())
    assert response.status_code == 200

    rules = client.get("/rules", headers=TOM_HEADERS).json()
    hours = next(
        rule
        for rule in rules
        if rule["type"] == "business_hours"
        and rule["config"].get("service") == "plumbing repair"
    )
    exceptions = hours["config"]["exceptions"]
    assert exceptions == [
        {
            "start_date": "2026-12-25",
            "end_date": "2026-12-25",
            "reason": "Christmas Day",
        }
    ]


def test_create_rejects_duplicate_service_name(client: TestClient) -> None:
    client.post("/service-wizard", headers=TOM_HEADERS, json=_create_payload("roof rinse"))
    second = client.post(
        "/service-wizard", headers=TOM_HEADERS, json=_create_payload("roof rinse")
    )
    assert second.status_code == 422


def test_create_rejects_window_with_inverted_times(client: TestClient) -> None:
    payload = _create_payload("bad window")
    payload["service"]["availability"]["windows"][0] = {
        "day": "monday",
        "open_time": "17:00",
        "close_time": "09:00",
    }
    response = client.post("/service-wizard", headers=TOM_HEADERS, json=payload)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any(item["step"] == 2 for item in detail)


def test_edit_replaces_existing_scoped_rules(client: TestClient) -> None:
    create = client.post(
        "/service-wizard", headers=TOM_HEADERS, json=_create_payload("yard pruning")
    )
    assert create.status_code == 200
    initial_ids = set(create.json()["created_rule_ids"])

    edit_payload = _create_payload("yard pruning")
    edit_payload["mode"] = "edit"
    edit_payload["service"]["service_area"] = {
        "inherit_default": True,
        "zip_codes": [],
        "cities": [],
    }
    edit_payload["service"]["booking_policy"] = {
        "min_lead_minutes": 60,
        "max_advance_days": 14,
    }

    response = client.post("/service-wizard", headers=TOM_HEADERS, json=edit_payload)
    assert response.status_code == 200, response.text
    body = response.json()

    assert set(body["deleted_rule_ids"]) == initial_ids
    assert set(body["created_rule_ids"]).isdisjoint(initial_ids)

    rules = client.get("/rules", headers=TOM_HEADERS).json()
    scoped = [r for r in rules if r["config"].get("service") == "yard pruning"]
    types = {r["type"] for r in scoped}
    # service_area now inherits default → no service_area rule for this service.
    assert types == {"business_hours", "booking_policy"}

    booking = next(r for r in scoped if r["type"] == "booking_policy")
    assert booking["config"]["min_lead_minutes"] == 60
    assert booking["config"]["max_advance_days"] == 14


def test_delete_service_removes_rules_and_offered_entry(client: TestClient) -> None:
    client.post("/service-wizard", headers=TOM_HEADERS, json=_create_payload("gutter clean"))
    response = client.delete(
        "/service-wizard/gutter%20clean", headers=TOM_HEADERS
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["service"] == "gutter clean"
    assert len(body["deleted_rule_ids"]) == 3

    rules = client.get("/rules", headers=TOM_HEADERS).json()
    scoped = [r for r in rules if r["config"].get("service") == "gutter clean"]
    assert scoped == []

    offered = next(
        rule
        for rule in rules
        if rule["type"] == "services_offered" and not rule["config"].get("service")
    )
    assert "gutter clean" not in offered["config"]["services"]


def test_delete_unknown_service_returns_404(client: TestClient) -> None:
    response = client.delete("/service-wizard/nope", headers=TOM_HEADERS)
    assert response.status_code == 404


def test_edit_can_rename_service(client: TestClient) -> None:
    create = client.post(
        "/service-wizard", headers=TOM_HEADERS, json=_create_payload("hedge trim")
    )
    assert create.status_code == 200
    initial_ids = set(create.json()["created_rule_ids"])

    rename_payload = _create_payload("hedge sculpt")
    rename_payload["mode"] = "edit"
    rename_payload["original_name"] = "hedge trim"

    response = client.post("/service-wizard", headers=TOM_HEADERS, json=rename_payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["service"] == "hedge sculpt"
    assert set(body["deleted_rule_ids"]) == initial_ids

    rules = client.get("/rules", headers=TOM_HEADERS).json()
    old_scoped = [r for r in rules if r["config"].get("service") == "hedge trim"]
    new_scoped = [r for r in rules if r["config"].get("service") == "hedge sculpt"]
    assert old_scoped == []
    assert {r["type"] for r in new_scoped} == {
        "service_area",
        "business_hours",
        "booking_policy",
    }

    offered = next(
        rule
        for rule in rules
        if rule["type"] == "services_offered" and not rule["config"].get("service")
    )
    assert "hedge trim" not in offered["config"]["services"]
    assert "hedge sculpt" in offered["config"]["services"]


def test_edit_rename_collision_rejected(client: TestClient) -> None:
    client.post("/service-wizard", headers=TOM_HEADERS, json=_create_payload("alpha"))
    client.post("/service-wizard", headers=TOM_HEADERS, json=_create_payload("beta"))

    rename = _create_payload("beta")
    rename["mode"] = "edit"
    rename["original_name"] = "alpha"

    response = client.post("/service-wizard", headers=TOM_HEADERS, json=rename)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any("alpha" not in str(item.get("msg", "")) for item in detail) or any(
        "beta" in str(item.get("msg", "")) for item in detail
    )
