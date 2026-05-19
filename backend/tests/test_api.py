from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import db
from app import main as main_module
from app.main import app
from app.settings import settings
from app.validator_contract import BookAppointment, ProposedAction, QuoteService, RuleDecision


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


@pytest.mark.parametrize(
    ("action", "expected_outcome"),
    [
        (
            BookAppointment(
                service="hvac repair",
                requested_at=datetime.fromisoformat("2026-05-25T10:00:00-05:00"),
                zip_code="78704",
            ),
            "allowed",
        ),
        (
            BookAppointment(
                service="hvac repair",
                requested_at=datetime.fromisoformat("2026-05-24T14:00:00-05:00"),
                zip_code="78704",
            ),
            "blocked",
        ),
        (
            QuoteService(service="hvac repair"),
            "flagged",
        ),
    ],
)
def test_chat_stream_writes_messages_and_audit_for_validator_decisions(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    action: ProposedAction,
    expected_outcome: str,
) -> None:
    async def fake_classify_action(**_: Any) -> ProposedAction:
        return action

    async def fake_synthesize_reply_stream(
        *,
        decision: RuleDecision,
        **_: Any,
    ):
        if decision.violations:
            yield decision.violations[0].reason
        else:
            yield "I can help move that forward."

    monkeypatch.setattr(main_module, "classify_action", fake_classify_action)
    monkeypatch.setattr(
        main_module,
        "synthesize_reply_stream",
        fake_synthesize_reply_stream,
    )

    response = client.post(
        "/chat/biz_toms_hvac/messages",
        json={"content": "Can you help?"},
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "violations" not in response.text
    assert "outcome" not in response.text

    events = _parse_sse(response.text)
    done = next(event["data"] for event in events if event["event"] == "done")
    conversation_id = done["conversation_id"]
    agent_message_id = done["message_id"]
    customer_text = "".join(
        event["data"]["text"] for event in events if event["event"] == "token"
    )

    messages = client.get(
        f"/chat/biz_toms_hvac/conversations/{conversation_id}/messages",
    ).json()
    assert [message["role"] for message in messages] == ["customer", "agent"]
    assert messages[0]["content"] == "Can you help?"
    assert messages[1]["id"] == agent_message_id
    assert messages[1]["content"] == customer_text

    audit_entries = client.get("/audit-log", headers=TOM_HEADERS).json()
    assert len(audit_entries) == 1
    audit_entry = audit_entries[0]
    assert audit_entry["business_id"] == "biz_toms_hvac"
    assert audit_entry["conversation_id"] == conversation_id
    assert audit_entry["action_proposed"]["type"] == action.type
    assert audit_entry["outcome"] == expected_outcome
    if expected_outcome == "allowed":
        assert audit_entry["violations"] == []
    else:
        assert audit_entry["violations"][0]["rule_snapshot"]


def test_chat_stream_passes_conversation_history_to_agent_loop(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    classifier_histories: list[list[dict[str, Any]]] = []
    synthesizer_histories: list[list[dict[str, Any]]] = []

    async def fake_classify_action(
        *,
        customer_message: str,
        conversation_history: list[dict[str, Any]],
        **_: Any,
    ) -> ProposedAction:
        classifier_histories.append(conversation_history)
        if customer_message == "i meant 60607":
            return BookAppointment(
                service="panel repair",
                requested_at=datetime.fromisoformat("2026-05-21T15:00:00-05:00"),
                zip_code="60607",
            )
        return QuoteService(service="panel repair")

    async def fake_synthesize_reply_stream(
        *,
        conversation_history: list[dict[str, Any]],
        **_: Any,
    ):
        synthesizer_histories.append(conversation_history)
        if conversation_history[-1]["content"] == "i meant 60607":
            yield "Great, I can help with panel repair Thursday at 3pm."
        else:
            yield "Can you share your zip code?"

    monkeypatch.setattr(main_module, "classify_action", fake_classify_action)
    monkeypatch.setattr(
        main_module,
        "synthesize_reply_stream",
        fake_synthesize_reply_stream,
    )

    first_response = client.post(
        "/chat/biz_mister_electricity/messages",
        json={"content": "okay can i book a panel repair on thursday 3pm"},
        headers={"Accept": "text/event-stream"},
    )
    first_events = _parse_sse(first_response.text)
    conversation_id = next(
        event["data"]["conversation_id"]
        for event in first_events
        if event["event"] == "done"
    )

    second_response = client.post(
        "/chat/biz_mister_electricity/messages",
        json={"conversation_id": conversation_id, "content": "i meant 60607"},
        headers={"Accept": "text/event-stream"},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert [message["content"] for message in classifier_histories[1]] == [
        "okay can i book a panel repair on thursday 3pm",
        "Can you share your zip code?",
        "i meant 60607",
    ]
    assert synthesizer_histories[1] == classifier_histories[1]


def test_chat_rejects_conversation_from_wrong_business(client: TestClient) -> None:
    conversation_id = db.create_conversation("biz_toms_hvac")

    response = client.post(
        "/chat/biz_mister_electricity/messages",
        json={"conversation_id": conversation_id, "content": "Hello"},
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Conversation not found"


def _parse_sse(raw: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for frame in raw.strip().split("\n\n"):
        event = "message"
        data_lines: list[str] = []
        for line in frame.splitlines():
            if line.startswith("event:"):
                event = line.removeprefix("event:").strip()
            elif line.startswith("data:"):
                data_lines.append(line.removeprefix("data:").strip())
        if data_lines:
            events.append({"event": event, "data": json.loads("\n".join(data_lines))})
    return events
