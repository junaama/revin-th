from __future__ import annotations

from datetime import datetime, time

from app.validator_contract import (
    AnswerQuestion,
    BookAppointment,
    BusinessHoursRule,
    DateRange,
    DayOfWeek,
    HoursWindow,
    QuoteService,
    ServiceAreaRule,
    ServicesOfferedRule,
    evaluate,
)


def test_blocks_booking_outside_service_area_zip() -> None:
    decision = evaluate(
        [
            ServiceAreaRule(
                id="area",
                zip_codes=["78704", "78745"],
                cities=["Austin, TX"],
            )
        ],
        BookAppointment(
            service="hvac repair",
            requested_at=datetime.fromisoformat("2026-05-20T10:00:00-05:00"),
            zip_code="11226",
        ),
    )

    assert decision.outcome == "blocked"
    assert decision.violations[0].rule_type == "service_area"


def test_flags_missing_location_for_area_rule() -> None:
    decision = evaluate(
        [ServiceAreaRule(id="area", zip_codes=["78704"])],
        QuoteService(service="hvac repair"),
    )

    assert decision.outcome == "flagged"
    assert decision.violations[0].blocking is False


def test_allows_booking_inside_hours_area_and_catalog() -> None:
    decision = evaluate(
        [
            ServicesOfferedRule(id="services", services=["hvac repair"]),
            ServiceAreaRule(id="area", zip_codes=["78704"]),
            BusinessHoursRule(
                id="hours",
                windows=[HoursWindow(day=DayOfWeek.WED, open_time=time(9), close_time=time(17))],
            ),
        ],
        BookAppointment(
            service="hvac repair",
            requested_at=datetime.fromisoformat("2026-05-20T10:00:00-05:00"),
            zip_code="78704",
        ),
    )

    assert decision.outcome == "allowed"
    assert decision.violations == []


def test_blocks_booking_on_closed_day() -> None:
    decision = evaluate(
        [
            BusinessHoursRule(
                id="hours",
                windows=[HoursWindow(day=DayOfWeek.MON, open_time=time(9), close_time=time(17))],
            )
        ],
        BookAppointment(
            service="hvac repair",
            requested_at=datetime.fromisoformat("2026-05-24T14:00:00-05:00"),
            zip_code="78704",
        ),
    )

    assert decision.outcome == "blocked"
    assert "closed on sunday" in decision.violations[0].reason.lower()


def test_blocks_booking_during_calendar_exception() -> None:
    decision = evaluate(
        [
            BusinessHoursRule(
                id="hours",
                windows=[HoursWindow(day=DayOfWeek.SAT, open_time=time(9), close_time=time(17))],
                exceptions=[
                    DateRange(
                        start_date=datetime.fromisoformat("2026-07-04").date(),
                        end_date=datetime.fromisoformat("2026-07-04").date(),
                        reason="Independence Day",
                    )
                ],
            )
        ],
        BookAppointment(
            service="hvac repair",
            requested_at=datetime.fromisoformat("2026-07-04T10:00:00-05:00"),
            zip_code="78704",
        ),
    )

    assert decision.outcome == "blocked"
    assert "Independence Day" in decision.violations[0].reason


def test_service_specific_hours_override_global_hours() -> None:
    rules = [
        BusinessHoursRule(
            id="global",
            windows=[HoursWindow(day=DayOfWeek.SUN, open_time=time(9), close_time=time(17))],
        ),
        BusinessHoursRule(
            id="hvac-only",
            service="hvac repair",
            windows=[HoursWindow(day=DayOfWeek.MON, open_time=time(9), close_time=time(17))],
        ),
    ]

    decision = evaluate(
        rules,
        BookAppointment(
            service="hvac repair",
            requested_at=datetime.fromisoformat("2026-05-24T11:00:00-05:00"),
            zip_code="78704",
        ),
    )

    assert decision.outcome == "blocked"
    assert decision.violations[0].rule_id == "hvac-only"


def test_blocks_unoffered_service_for_quote() -> None:
    decision = evaluate(
        [ServicesOfferedRule(id="services", services=["outlet installation"])],
        QuoteService(service="commercial rewiring", zip_code="60607"),
    )

    assert decision.outcome == "blocked"
    assert "commercial rewiring" in decision.violations[0].reason


def test_blocks_unoffered_service_claim_in_answer() -> None:
    decision = evaluate(
        [ServicesOfferedRule(id="services", services=["panel repair"])],
        AnswerQuestion(
            response_text="Yes, we do commercial rewiring.",
            services_claimed=["commercial rewiring"],
        ),
    )

    assert decision.outcome == "blocked"
    assert decision.violations[0].rule_type == "services_offered"
