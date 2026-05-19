"""
Pure validator contract for the Revin guardrail take-home.

The FastAPI tool wrapper is allowed to do I/O: load rules, persist audit
entries, and call Anthropic. This module is deliberately boring and pure so the
eval suite can hammer it on every push without a database or LLM key.
"""

from __future__ import annotations

from datetime import date, datetime, time
from enum import Enum
from typing import Annotated, Literal, Union
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, TypeAdapter


class DayOfWeek(str, Enum):
    MON = "monday"
    TUE = "tuesday"
    WED = "wednesday"
    THU = "thursday"
    FRI = "friday"
    SAT = "saturday"
    SUN = "sunday"


class HoursWindow(BaseModel):
    day: DayOfWeek
    open_time: time
    close_time: time


class DateRange(BaseModel):
    start_date: date
    end_date: date
    reason: str | None = None


class ServiceAreaRule(BaseModel):
    type: Literal["service_area"] = "service_area"
    id: str | None = None
    zip_codes: list[str] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)
    service: str | None = None


class BusinessHoursRule(BaseModel):
    type: Literal["business_hours"] = "business_hours"
    id: str | None = None
    windows: list[HoursWindow]
    exceptions: list[DateRange] = Field(default_factory=list)
    timezone: str = "America/Chicago"
    service: str | None = None


class ServicesOfferedRule(BaseModel):
    type: Literal["services_offered"] = "services_offered"
    id: str | None = None
    services: list[str]
    service: str | None = None


Rule = Annotated[
    Union[ServiceAreaRule, BusinessHoursRule, ServicesOfferedRule],
    Field(discriminator="type"),
]

RuleAdapter = TypeAdapter(Rule)
RulesAdapter = TypeAdapter(list[Rule])


class BookAppointment(BaseModel):
    type: Literal["book_appointment"] = "book_appointment"
    service: str
    requested_at: datetime
    zip_code: str | None = None
    city: str | None = None


class QuoteService(BaseModel):
    type: Literal["quote_service"] = "quote_service"
    service: str
    zip_code: str | None = None
    city: str | None = None


class AnswerQuestion(BaseModel):
    type: Literal["answer_question"] = "answer_question"
    response_text: str
    services_claimed: list[str] = Field(default_factory=list)
    areas_claimed: list[str] = Field(default_factory=list)
    hours_claimed: list[HoursWindow] | None = None


ProposedAction = Annotated[
    Union[BookAppointment, QuoteService, AnswerQuestion],
    Field(discriminator="type"),
]

ActionAdapter = TypeAdapter(ProposedAction)


class Violation(BaseModel):
    rule_type: str
    rule_id: str | None = None
    reason: str
    rule_snapshot: dict | None = None
    blocking: bool = True


Outcome = Literal["allowed", "blocked", "flagged"]


class RuleDecision(BaseModel):
    outcome: Outcome
    violations: list[Violation] = Field(default_factory=list)

    @property
    def is_allowed(self) -> bool:
        return self.outcome == "allowed"


def evaluate(rules: list[Rule], action: ProposedAction) -> RuleDecision:
    """Evaluate a proposed agent action against already-loaded rules."""
    violations: list[Violation] = []

    service = _action_service(action)
    for rule in _applicable_rules(rules, "services_offered", service):
        violations.extend(_check_services_offered(rule, action))

    for rule in _applicable_rules(rules, "service_area", service):
        violations.extend(_check_service_area(rule, action))

    if isinstance(action, BookAppointment):
        for rule in _applicable_rules(rules, "business_hours", action.service):
            violation = _check_business_hours(rule, action)
            if violation:
                violations.append(violation)

    if not violations:
        return RuleDecision(outcome="allowed")
    if any(v.blocking for v in violations):
        return RuleDecision(outcome="blocked", violations=violations)
    return RuleDecision(outcome="flagged", violations=violations)


def _action_service(action: ProposedAction) -> str | None:
    if isinstance(action, (BookAppointment, QuoteService)):
        return action.service
    if len(action.services_claimed) == 1:
        return action.services_claimed[0]
    return None


def _applicable_rules(
    rules: list[Rule], rule_type: str, service: str | None
) -> list[Rule]:
    candidates = [rule for rule in rules if rule.type == rule_type]
    if service is not None:
        scoped = [
            rule
            for rule in candidates
            if getattr(rule, "service", None) is not None
            and _same_text(getattr(rule, "service"), service)
        ]
        if scoped:
            return scoped
    return [rule for rule in candidates if getattr(rule, "service", None) is None]


def _check_services_offered(
    rule: ServicesOfferedRule, action: ProposedAction
) -> list[Violation]:
    claimed = _services_from_action(action)
    if not claimed:
        return []

    offered = {_normalize(service) for service in rule.services}
    misses = [service for service in claimed if _normalize(service) not in offered]
    if not misses:
        return []

    return [
        _violation(
            rule,
            f"This business does not offer {', '.join(misses)}. "
            f"Offered: {', '.join(rule.services)}.",
        )
    ]


def _check_service_area(rule: ServiceAreaRule, action: ProposedAction) -> list[Violation]:
    zip_codes, cities = _areas_from_action(action)
    has_rule_scope = bool(rule.zip_codes or rule.cities)
    if not has_rule_scope:
        return []

    if not zip_codes and not cities:
        return [
            _violation(
                rule,
                "Location is missing, so the business owner should review area fit.",
                blocking=False,
            )
        ]

    allowed_zips = {_normalize_zip(zip_code) for zip_code in rule.zip_codes}
    allowed_cities = {_normalize(city) for city in rule.cities}
    rejected: list[str] = []

    for zip_code in zip_codes:
        if allowed_zips and _normalize_zip(zip_code) not in allowed_zips:
            rejected.append(f"zip {zip_code}")
    for city in cities:
        if allowed_cities and _normalize(city) not in allowed_cities:
            rejected.append(city)

    if not rejected:
        return []

    served = ", ".join(rule.zip_codes + rule.cities)
    return [
        _violation(
            rule,
            f"This business does not serve {', '.join(rejected)}. Service area: {served}.",
        )
    ]


def _check_business_hours(
    rule: BusinessHoursRule, action: BookAppointment
) -> Violation | None:
    if action.requested_at.tzinfo is None:
        return _violation(
            rule,
            "Appointment time must include a timezone before it can be booked.",
        )

    local_dt = action.requested_at.astimezone(ZoneInfo(rule.timezone))
    local_date = local_dt.date()

    for exception in rule.exceptions:
        if exception.start_date <= local_date <= exception.end_date:
            suffix = f" for {exception.reason}" if exception.reason else ""
            return _violation(
                rule,
                f"This business is closed on {local_date.isoformat()}{suffix}.",
            )

    day = DayOfWeek(local_dt.strftime("%A").lower())
    local_time = local_dt.time().replace(tzinfo=None)
    day_windows = [window for window in rule.windows if window.day == day]
    for window in day_windows:
        if window.open_time <= local_time < window.close_time:
            return None

    if day_windows:
        ranges = ", ".join(
            f"{window.open_time.strftime('%H:%M')}-{window.close_time.strftime('%H:%M')}"
            for window in day_windows
        )
        return _violation(
            rule,
            f"This business is closed at {local_time.strftime('%H:%M')} on {day.value}. "
            f"Open {ranges}.",
        )

    open_days = _format_open_days(rule.windows)
    return _violation(
        rule,
        f"This business is closed on {day.value}. Open {open_days}.",
    )


def _services_from_action(action: ProposedAction) -> list[str]:
    if isinstance(action, (BookAppointment, QuoteService)):
        return [action.service]
    return action.services_claimed


def _areas_from_action(action: ProposedAction) -> tuple[list[str], list[str]]:
    if isinstance(action, (BookAppointment, QuoteService)):
        return (
            [action.zip_code] if action.zip_code else [],
            [action.city] if action.city else [],
        )

    zip_codes: list[str] = []
    cities: list[str] = []
    for area in action.areas_claimed:
        cleaned = area.strip()
        if cleaned.replace("-", "").isdigit():
            zip_codes.append(cleaned)
        else:
            cities.append(cleaned)
    return zip_codes, cities


def _format_open_days(windows: list[HoursWindow]) -> str:
    if not windows:
        return "no configured hours"
    seen: list[str] = []
    for window in windows:
        if window.day.value not in seen:
            seen.append(window.day.value)
    return ", ".join(seen)


def _violation(
    rule: Rule,
    reason: str,
    *,
    blocking: bool = True,
) -> Violation:
    return Violation(
        rule_type=rule.type,
        rule_id=rule.id,
        reason=reason,
        rule_snapshot=rule.model_dump(mode="json"),
        blocking=blocking,
    )


def _normalize(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _normalize_zip(value: str) -> str:
    return value.strip()


def _same_text(left: str | None, right: str | None) -> bool:
    return _normalize(left) == _normalize(right)
