from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import db
from app import owner_copilot
from app.main import app
from app.settings import settings


TOM_HEADERS = {"X-Business-Id": "biz_toms_hvac"}
ELECTRIC_HEADERS = {"X-Business-Id": "biz_mister_electricity"}


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    original_db_path = settings.db_path
    settings.db_path = str(tmp_path / "test.db")
    monkeypatch.setattr(owner_copilot.settings, "anthropic_api_key", None)
    try:
        db.init_db()
        with TestClient(app) as test_client:
            yield test_client
    finally:
        settings.db_path = original_db_path


@pytest.mark.parametrize(
    ("business_id", "headers", "prompt", "expected_kind", "expected_rule_type"),
    [
        (
            "biz_mister_electricity",
            ELECTRIC_HEADERS,
            "Close at 2:00 PM on Sundays",
            "proposal",
            "business_hours",
        ),
        (
            "biz_mister_electricity",
            ELECTRIC_HEADERS,
            "Add ZIP code 60622 to our service area",
            "proposal",
            "service_area",
        ),
        (
            "biz_toms_hvac",
            TOM_HEADERS,
            "Require 24 hours notice before booking",
            "proposal",
            "booking_policy",
        ),
        (
            "biz_toms_hvac",
            TOM_HEADERS,
            "We should close earlier on weekends",
            "clarify",
            None,
        ),
        (
            "biz_toms_hvac",
            TOM_HEADERS,
            "Make the logo more fun",
            "message",
            None,
        ),
    ],
)
def test_owner_copilot_agent_golden_set_from_seeded_database(
    client: TestClient,
    business_id: str,
    headers: dict[str, str],
    prompt: str,
    expected_kind: str,
    expected_rule_type: str | None,
) -> None:
    rules_before = client.get("/rules", headers=headers).json()

    response = client.post(
        f"/owner-copilot/{business_id}/messages",
        json={"content": prompt},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == expected_kind

    if expected_kind == "proposal":
        proposal = body["proposal"]
        assert proposal["ruleType"] == expected_rule_type
        assert body["reasoning"] == [
            "Reading your request",
            f"Matched rule · {proposal['ruleTitle']}",
            "Drafting the change",
        ]
        _assert_golden_mutation_from_rules(prompt, proposal, rules_before)
    elif expected_kind == "clarify":
        assert body["message"].startswith("Happy to adjust weekend hours")
        assert body["question"] == "Which day(s) should I change, and what new closing time?"
        assert body["chips"] == [
            {"label": "Saturday only", "fill": "Close at 2:00 PM on Saturday"},
            {"label": "Sunday only", "fill": "Close at 2:00 PM on Sunday"},
            {
                "label": "Both Sat & Sun",
                "fill": "Close at 2:00 PM on Saturday and Sunday",
            },
        ]
    else:
        assert "availability, service area, booking policy" in body["message"]

    rules_after = client.get("/rules", headers=headers).json()
    assert rules_after == rules_before


def test_owner_copilot_business_hours_unit_uses_existing_rule_snapshot(
    client: TestClient,
) -> None:
    rules = client.get("/rules", headers=ELECTRIC_HEADERS).json()
    hours = _rule_by_type(rules, "business_hours")

    response = owner_copilot.fallback_owner_rule_change(
        owner_message="Close at 2:00 PM on Sundays",
        rules=rules,
        timezone="America/Chicago",
    )

    assert response.kind == "proposal"
    assert response.proposal is not None
    assert response.proposal.patch.rule_id == hours["id"]
    assert response.proposal.patch.payload["windows"] == [
        *hours["config"]["windows"],
        {"day": "sunday", "open_time": "08:00", "close_time": "14:00"},
    ]


def test_owner_copilot_rejects_out_of_range_tool_times() -> None:
    assert owner_copilot._coerce_hhmm("23:59") == "23:59"
    assert owner_copilot._coerce_hhmm("29:00") is None


def _assert_golden_mutation_from_rules(
    prompt: str,
    proposal: dict[str, Any],
    rules_before: list[dict[str, Any]],
) -> None:
    patch = proposal["patch"]

    if prompt == "Close at 2:00 PM on Sundays":
        hours = _rule_by_type(rules_before, "business_hours")
        assert proposal["summary"] == "I'll add Sunday hours, closing at 2:00 PM."
        assert proposal["fieldLabel"] == "Weekly windows"
        assert proposal["after"] == [{"op": "add", "text": "Sunday 8:00 AM-2:00 PM"}]
        assert patch == {
            "operation": "update",
            "ruleId": hours["id"],
            "payload": {
                "windows": [
                    *hours["config"]["windows"],
                    {"day": "sunday", "open_time": "08:00", "close_time": "14:00"},
                ]
            },
        }
        return

    if prompt == "Add ZIP code 60622 to our service area":
        area = _rule_by_type(rules_before, "service_area")
        assert proposal["summary"] == "I'll add ZIP code 60622 to your service area."
        assert proposal["fieldLabel"] == "ZIP codes"
        assert proposal["before"] == [
            {"op": "keep", "text": zip_code}
            for zip_code in area["config"]["zip_codes"]
        ]
        assert proposal["after"] == [{"op": "add", "text": "60622"}]
        assert patch == {
            "operation": "update",
            "ruleId": area["id"],
            "payload": {"zip_codes": [*area["config"]["zip_codes"], "60622"]},
        }
        return

    if prompt == "Require 24 hours notice before booking":
        assert proposal["summary"] == "I'll require 24 hours of advance notice for bookings."
        assert proposal["fieldLabel"] == "Minimum lead time"
        assert proposal["before"] == [
            {"op": "change-from", "text": "No minimum lead time"}
        ]
        assert proposal["after"] == [{"op": "change-to", "text": "24 hours"}]
        assert patch == {
            "operation": "create",
            "ruleId": None,
            "payload": {
                "type": "booking_policy",
                "min_lead_minutes": 1440,
                "max_advance_days": 365,
            },
        }
        return

    raise AssertionError(f"Unhandled golden prompt: {prompt}")


def _rule_by_type(rules: list[dict[str, Any]], rule_type: str) -> dict[str, Any]:
    return next(rule for rule in rules if rule["type"] == rule_type)
