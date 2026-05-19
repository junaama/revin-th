from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.settings import settings


TOM_HEADERS = {"X-Business-Id": "biz_toms_hvac"}
ELECTRIC_HEADERS = {"X-Business-Id": "biz_mister_electricity"}


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


def test_health_and_seeded_businesses(client: TestClient) -> None:
    health = client.get("/health")
    businesses = client.get("/businesses")

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert businesses.status_code == 200
    assert {item["id"] for item in businesses.json()} == {
        "biz_toms_hvac",
        "biz_mister_electricity",
    }
    assert {item["name"] for item in businesses.json()} == {
        "Tom's HVAC INC",
        "Mister Electricity INC",
    }


@pytest.mark.parametrize(
    ("headers", "expected_business_id", "expected_ids"),
    [
        (
            TOM_HEADERS,
            "biz_toms_hvac",
            {"rule_toms_services", "rule_toms_area", "rule_toms_hours"},
        ),
        (
            ELECTRIC_HEADERS,
            "biz_mister_electricity",
            {"rule_electric_services", "rule_electric_area", "rule_electric_hours"},
        ),
    ],
)
def test_owner_lists_seeded_rules(
    client: TestClient,
    headers: dict[str, str],
    expected_business_id: str,
    expected_ids: set[str],
) -> None:
    response = client.get("/rules", headers=headers)

    assert response.status_code == 200
    rules = response.json()
    assert {rule["id"] for rule in rules} == expected_ids
    assert {rule["business_id"] for rule in rules} == {expected_business_id}
    assert {rule["type"] for rule in rules} == {
        "service_area",
        "business_hours",
        "services_offered",
    }
    assert all(rule["enabled"] is True for rule in rules)
    assert all(rule["config"]["id"] == rule["id"] for rule in rules)


def test_owner_creates_rule(client: TestClient) -> None:
    payload = {
        "type": "services_offered",
        "services": ["duct cleaning", "heat pump repair"],
    }

    response = client.post("/rules", headers=TOM_HEADERS, json=payload)

    assert response.status_code == 201
    created = response.json()
    assert created["business_id"] == "biz_toms_hvac"
    assert created["type"] == "services_offered"
    assert created["enabled"] is True
    assert created["id"].startswith("rule_")
    assert created["config"]["id"] == created["id"]
    assert created["config"]["services"] == payload["services"]

    rules = client.get("/rules", headers=TOM_HEADERS).json()
    assert len(rules) == 4
    assert any(rule["id"] == created["id"] for rule in rules)


def test_rule_writes_validate_discriminated_union(client: TestClient) -> None:
    response = client.post(
        "/rules",
        headers=TOM_HEADERS,
        json={"type": "unsupported_rule"},
    )

    assert response.status_code == 422


def test_rule_validation_errors_are_json_serializable(client: TestClient) -> None:
    response = client.post(
        "/rules",
        headers=TOM_HEADERS,
        json={
            "type": "business_hours",
            "timezone": "Not/AZone",
            "windows": [
                {"day": "monday", "open_time": "09:00", "close_time": "17:00"}
            ],
        },
    )

    assert response.status_code == 422
    assert "unknown timezone" in response.text


def test_owner_patches_rule_enabled_false(client: TestClient) -> None:
    response = client.patch(
        "/rules/rule_toms_area",
        headers=TOM_HEADERS,
        json={"enabled": False},
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["id"] == "rule_toms_area"
    assert updated["enabled"] is False
    assert updated["config"]["type"] == "service_area"

    rules = client.get("/rules", headers=TOM_HEADERS).json()
    listed = next(rule for rule in rules if rule["id"] == "rule_toms_area")
    assert listed["enabled"] is False


def test_owner_deletes_rule(client: TestClient) -> None:
    response = client.delete("/rules/rule_toms_services", headers=TOM_HEADERS)

    assert response.status_code == 204
    rules = client.get("/rules", headers=TOM_HEADERS).json()
    assert {rule["id"] for rule in rules} == {"rule_toms_area", "rule_toms_hours"}

    missing = client.delete("/rules/rule_toms_services", headers=TOM_HEADERS)
    assert missing.status_code == 404


def test_owner_routes_require_business_header(client: TestClient) -> None:
    response = client.get("/rules")

    assert response.status_code == 400
    assert response.json()["detail"] == "Missing X-Business-Id header"


def test_customer_routes_use_path_business_without_owner_header(
    client: TestClient,
) -> None:
    response = client.get("/chat/biz_toms_hvac/conversations/missing/messages")

    assert response.status_code == 200
    assert response.json() == []
