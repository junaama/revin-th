from __future__ import annotations

from datetime import datetime, time

from app.agent import _anthropic_history_messages, _localize_booking_time
from app.validator_contract import BookAppointment, BusinessHoursRule, DayOfWeek, HoursWindow


def test_localize_booking_time_uses_business_hours_timezone() -> None:
    action = BookAppointment(
        service="hvac repair",
        requested_at=datetime.fromisoformat("2026-05-24T14:00:00"),
        zip_code="78704",
    )
    localized = _localize_booking_time(
        action,
        [
            BusinessHoursRule(
                windows=[HoursWindow(day=DayOfWeek.MON, open_time=time(9), close_time=time(17))],
                timezone="America/Chicago",
            )
        ],
    )

    assert localized.requested_at.tzinfo is not None
    assert localized.requested_at.isoformat() == "2026-05-24T14:00:00-05:00"


def test_anthropic_history_messages_keep_prior_intent_for_corrections() -> None:
    messages = _anthropic_history_messages(
        [
            {
                "role": "customer",
                "content": "okay can i book a panel repair on thursday 3pm",
            },
            {"role": "agent", "content": "Can you share your zip code?"},
            {"role": "customer", "content": "606607"},
            {"role": "agent", "content": "Did you mean 60607?"},
            {"role": "customer", "content": "i meant 60607"},
        ],
        current_customer_message="i meant 60607",
    )

    assert [message["role"] for message in messages] == [
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
    ]
    assert "panel repair on thursday 3pm" in messages[0]["content"]
    assert messages[-1]["content"] == "i meant 60607"
