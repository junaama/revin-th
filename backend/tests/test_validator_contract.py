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


def _hours(day: DayOfWeek, open_hour: int = 9, close_hour: int = 17) -> HoursWindow:
    return HoursWindow(
        day=day,
        open_time=time(open_hour),
        close_time=time(close_hour),
    )


def _booking(
    *,
    service: str = "hvac repair",
    requested_at: str = "2026-05-20T10:00:00-05:00",
    zip_code: str | None = "78704",
    city: str | None = None,
) -> BookAppointment:
    return BookAppointment(
        service=service,
        requested_at=datetime.fromisoformat(requested_at),
        zip_code=zip_code,
        city=city,
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
        _booking(zip_code="11226"),
    )

    assert decision.outcome == "blocked"
    assert decision.violations[0].rule_type == "service_area"
    assert decision.violations[0].rule_snapshot == {
        "type": "service_area",
        "id": "area",
        "zip_codes": ["78704", "78745"],
        "cities": ["Austin, TX"],
        "service": None,
    }


def test_flags_missing_location_for_area_rule() -> None:
    decision = evaluate(
        [ServiceAreaRule(id="area", zip_codes=["78704"])],
        QuoteService(service="hvac repair"),
    )

    assert decision.outcome == "flagged"
    assert decision.violations[0].blocking is False


def test_flags_incomparable_area_shape() -> None:
    decision = evaluate(
        [ServiceAreaRule(id="area", zip_codes=["78704"])],
        QuoteService(service="hvac repair", city="Austin, TX"),
    )

    assert decision.outcome == "flagged"
    assert "configured by zip code" in decision.violations[0].reason


def test_allows_quote_inside_service_area_city_case_insensitive() -> None:
    decision = evaluate(
        [ServiceAreaRule(id="area", cities=["Austin, TX"])],
        QuoteService(service="hvac repair", city="  austin, tx  "),
    )

    assert decision.outcome == "allowed"


def test_service_specific_area_overrides_global_area() -> None:
    rules = [
        ServiceAreaRule(id="global", zip_codes=["78704"]),
        ServiceAreaRule(id="electrical-area", service="panel repair", zip_codes=["60607"]),
    ]

    decision = evaluate(
        rules,
        QuoteService(service="panel repair", zip_code="78704"),
    )

    assert decision.outcome == "blocked"
    assert decision.violations[0].rule_id == "electrical-area"


def test_allows_booking_inside_hours_area_and_catalog() -> None:
    decision = evaluate(
        [
            ServicesOfferedRule(id="services", services=["hvac repair"]),
            ServiceAreaRule(id="area", zip_codes=["78704"]),
            BusinessHoursRule(id="hours", windows=[_hours(DayOfWeek.WED)]),
        ],
        _booking(),
    )

    assert decision.outcome == "allowed"
    assert decision.violations == []


def test_blocks_booking_on_closed_day() -> None:
    decision = evaluate(
        [BusinessHoursRule(id="hours", windows=[_hours(DayOfWeek.MON)])],
        _booking(requested_at="2026-05-24T14:00:00-05:00"),
    )

    assert decision.outcome == "blocked"
    assert "closed on sunday" in decision.violations[0].reason.lower()


def test_blocks_booking_before_opening_time() -> None:
    decision = evaluate(
        [BusinessHoursRule(id="hours", windows=[_hours(DayOfWeek.WED)])],
        _booking(requested_at="2026-05-20T08:59:00-05:00"),
    )

    assert decision.outcome == "blocked"
    assert "closed at 08:59" in decision.violations[0].reason


def test_blocks_booking_at_close_boundary() -> None:
    decision = evaluate(
        [BusinessHoursRule(id="hours", windows=[_hours(DayOfWeek.WED)])],
        _booking(requested_at="2026-05-20T17:00:00-05:00"),
    )

    assert decision.outcome == "blocked"
    assert "Open 09:00-17:00" in decision.violations[0].reason


def test_blocks_booking_without_timezone() -> None:
    decision = evaluate(
        [BusinessHoursRule(id="hours", windows=[_hours(DayOfWeek.WED)])],
        _booking(requested_at="2026-05-20T10:00:00"),
    )

    assert decision.outcome == "blocked"
    assert "timezone" in decision.violations[0].reason


def test_blocks_booking_during_calendar_exception() -> None:
    decision = evaluate(
        [
            BusinessHoursRule(
                id="hours",
                windows=[_hours(DayOfWeek.SAT)],
                exceptions=[
                    DateRange(
                        start_date=datetime.fromisoformat("2026-07-04").date(),
                        end_date=datetime.fromisoformat("2026-07-04").date(),
                        reason="Independence Day",
                    )
                ],
            )
        ],
        _booking(requested_at="2026-07-04T10:00:00-05:00"),
    )

    assert decision.outcome == "blocked"
    assert "Independence Day" in decision.violations[0].reason


def test_service_specific_hours_override_global_hours() -> None:
    rules = [
        BusinessHoursRule(id="global", windows=[_hours(DayOfWeek.SUN)]),
        BusinessHoursRule(
            id="hvac-only",
            service="hvac repair",
            windows=[_hours(DayOfWeek.MON)],
        ),
    ]

    decision = evaluate(
        rules,
        _booking(requested_at="2026-05-24T11:00:00-05:00"),
    )

    assert decision.outcome == "blocked"
    assert decision.violations[0].rule_id == "hvac-only"


def test_global_hours_apply_when_no_service_specific_rule_exists() -> None:
    decision = evaluate(
        [BusinessHoursRule(id="global", windows=[_hours(DayOfWeek.WED)])],
        _booking(service="plumbing"),
    )

    assert decision.outcome == "allowed"


def test_blocks_unoffered_service_for_quote() -> None:
    decision = evaluate(
        [ServicesOfferedRule(id="services", services=["outlet installation"])],
        QuoteService(service="commercial rewiring", zip_code="60607"),
    )

    assert decision.outcome == "blocked"
    assert "commercial rewiring" in decision.violations[0].reason


def test_allows_offered_service_case_and_space_insensitive() -> None:
    decision = evaluate(
        [ServicesOfferedRule(id="services", services=["HVAC Repair"])],
        QuoteService(service="  hvac   repair  ", zip_code="78704"),
    )

    assert decision.outcome == "allowed"


def test_service_specific_services_override_global_catalog() -> None:
    rules = [
        ServicesOfferedRule(id="global", services=["generator repair"]),
        ServicesOfferedRule(
            id="generator-special",
            service="generator repair",
            services=["generator diagnostic"],
        ),
    ]

    decision = evaluate(rules, QuoteService(service="generator repair", zip_code="78704"))

    assert decision.outcome == "blocked"
    assert decision.violations[0].rule_id == "generator-special"


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


def test_blocks_area_claim_in_answer() -> None:
    decision = evaluate(
        [ServiceAreaRule(id="area", zip_codes=["78704"])],
        AnswerQuestion(
            response_text="Yes, we serve 11226.",
            areas_claimed=["11226"],
        ),
    )

    assert decision.outcome == "blocked"
    assert decision.violations[0].rule_type == "service_area"


def test_blocks_unsupported_hours_claim_in_answer() -> None:
    decision = evaluate(
        [BusinessHoursRule(id="hours", windows=[_hours(DayOfWeek.MON)])],
        AnswerQuestion(
            response_text="We are open Monday 8 to 5.",
            hours_claimed=[
                HoursWindow(
                    day=DayOfWeek.MON,
                    open_time=time(8),
                    close_time=time(17),
                )
            ],
        ),
    )

    assert decision.outcome == "blocked"
    assert decision.violations[0].rule_type == "business_hours"


def test_allows_supported_hours_claim_in_answer() -> None:
    decision = evaluate(
        [BusinessHoursRule(id="hours", windows=[_hours(DayOfWeek.MON)])],
        AnswerQuestion(
            response_text="We are open Monday 10 to 4.",
            hours_claimed=[
                HoursWindow(
                    day=DayOfWeek.MON,
                    open_time=time(10),
                    close_time=time(16),
                )
            ],
        ),
    )

    assert decision.outcome == "allowed"
