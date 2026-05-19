from __future__ import annotations

from datetime import datetime, time

from app.agent import _localize_booking_time
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
