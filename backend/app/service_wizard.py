"""Translate wizard payloads into polymorphic rule rows."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from . import db
from .validator_contract import DayOfWeek


class WindowPayload(BaseModel):
    day: DayOfWeek
    open_time: str
    close_time: str

    @field_validator("open_time", "close_time")
    @classmethod
    def must_be_hhmm(cls, value: str) -> str:
        if len(value) < 5 or value[2] != ":":
            raise ValueError("expected HH:MM")
        hours, minutes = value[:2], value[3:5]
        if not (hours.isdigit() and minutes.isdigit()):
            raise ValueError("expected HH:MM")
        h, m = int(hours), int(minutes)
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise ValueError("time out of range")
        return f"{h:02d}:{m:02d}"

    @model_validator(mode="after")
    def open_before_close(self) -> "WindowPayload":
        if self.open_time >= self.close_time:
            raise ValueError("open_time must be before close_time")
        return self


class ExceptionPayload(BaseModel):
    label: str = ""
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def start_before_end(self) -> "ExceptionPayload":
        if self.start >= self.end:
            raise ValueError("start must be before end")
        return self


class ServiceAreaPayload(BaseModel):
    inherit_default: bool
    zip_codes: list[str] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)


class AvailabilityPayload(BaseModel):
    inherit_default: bool
    windows: list[WindowPayload] = Field(default_factory=list)
    exceptions: list[ExceptionPayload] = Field(default_factory=list)


class BookingPolicyPayload(BaseModel):
    min_lead_minutes: int = Field(ge=0)
    max_advance_days: int = Field(ge=1)


class ServicePayload(BaseModel):
    name: str = Field(min_length=1)
    service_area: ServiceAreaPayload
    availability: AvailabilityPayload
    booking_policy: BookingPolicyPayload

    @field_validator("name")
    @classmethod
    def name_must_be_trimmed(cls, value: str) -> str:
        cleaned = " ".join(value.strip().split())
        if not cleaned:
            raise ValueError("name is required")
        return cleaned


class ServiceWizardRequest(BaseModel):
    mode: str
    service: ServicePayload

    @field_validator("mode")
    @classmethod
    def mode_must_be_known(cls, value: str) -> str:
        if value not in ("create", "edit"):
            raise ValueError("mode must be 'create' or 'edit'")
        return value


def _normalize(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _exception_dates(item: ExceptionPayload) -> tuple[str, str]:
    """Convert a wizard datetime range to inclusive date strings."""
    start_date = item.start.date()
    inclusive_end = item.end - timedelta(seconds=1)
    if inclusive_end < item.start:
        inclusive_end = item.start
    end_date = inclusive_end.date()
    return start_date.isoformat(), end_date.isoformat()


def _find_offered_rule(rules: list[dict[str, Any]]) -> dict[str, Any] | None:
    for rule in rules:
        if rule["type"] == "services_offered" and not rule["config"].get("service"):
            return rule
    return None


def _scoped_rule_ids(rules: list[dict[str, Any]], name: str) -> list[str]:
    normalized = _normalize(name)
    return [
        rule["id"]
        for rule in rules
        if _normalize(rule["config"].get("service")) == normalized
    ]


def apply_wizard(
    business_id: str,
    request: ServiceWizardRequest,
    timezone: str,
) -> dict[str, Any]:
    """Translate a validated wizard request into a single-transaction write."""
    name = request.service.name
    rules = db.list_rules(business_id)

    offered_rule = _find_offered_rule(rules)
    offered_list: list[str] = list(offered_rule["config"]["services"]) if offered_rule else []
    offered_normalized = {_normalize(item) for item in offered_list}

    if request.mode == "create" and _normalize(name) in offered_normalized:
        raise ValueError(f'service "{name}" already exists; switch to edit mode')

    updated_offered = list(offered_list)
    if _normalize(name) not in offered_normalized:
        updated_offered.append(name)

    new_offered_payload: dict[str, Any] | None = None
    offered_rule_id: str | None = None
    if offered_rule:
        offered_rule_id = offered_rule["id"]
        if updated_offered != offered_list:
            new_offered_payload = {
                **offered_rule["config"],
                "services": updated_offered,
            }
    else:
        new_offered_payload = {
            "type": "services_offered",
            "services": updated_offered,
        }

    rule_payloads: list[dict[str, Any]] = []
    if not request.service.service_area.inherit_default:
        rule_payloads.append(
            {
                "type": "service_area",
                "service": name,
                "zip_codes": request.service.service_area.zip_codes,
                "cities": request.service.service_area.cities,
            }
        )

    needs_hours = (
        not request.service.availability.inherit_default
        or bool(request.service.availability.exceptions)
    )
    if needs_hours:
        windows_payload = [
            {
                "day": window.day,
                "open_time": window.open_time,
                "close_time": window.close_time,
            }
            for window in request.service.availability.windows
        ]
        exceptions_payload: list[dict[str, Any]] = []
        for exc in request.service.availability.exceptions:
            start_date, end_date = _exception_dates(exc)
            entry: dict[str, Any] = {
                "start_date": start_date,
                "end_date": end_date,
            }
            if exc.label:
                entry["reason"] = exc.label
            exceptions_payload.append(entry)
        rule_payloads.append(
            {
                "type": "business_hours",
                "service": name,
                "timezone": timezone,
                "windows": windows_payload,
                "exceptions": exceptions_payload,
            }
        )

    rule_payloads.append(
        {
            "type": "booking_policy",
            "service": name,
            "min_lead_minutes": request.service.booking_policy.min_lead_minutes,
            "max_advance_days": request.service.booking_policy.max_advance_days,
        }
    )

    scoped_ids_to_delete = _scoped_rule_ids(rules, name)

    created, deleted = db.apply_service_wizard(
        business_id=business_id,
        rule_payloads=rule_payloads,
        services_offered_payload=new_offered_payload,
        services_offered_id=offered_rule_id,
        service_name=name,
        scoped_rule_ids_to_delete=scoped_ids_to_delete,
    )

    return {
        "service": name,
        "created_rule_ids": created,
        "deleted_rule_ids": deleted,
    }


def remove_service(business_id: str, service_name: str) -> dict[str, Any]:
    """Remove all scoped rules and drop the name from services_offered."""
    rules = db.list_rules(business_id)
    offered_rule = _find_offered_rule(rules)
    scoped_ids = _scoped_rule_ids(rules, service_name)

    offered_list = list(offered_rule["config"]["services"]) if offered_rule else []
    normalized = _normalize(service_name)
    next_offered = [item for item in offered_list if _normalize(item) != normalized]

    new_offered_payload: dict[str, Any] | None = None
    offered_rule_id: str | None = None
    if offered_rule and next_offered != offered_list:
        offered_rule_id = offered_rule["id"]
        new_offered_payload = {**offered_rule["config"], "services": next_offered}

    if not scoped_ids and new_offered_payload is None:
        return {"service": service_name, "deleted_rule_ids": []}

    deleted = db.remove_service(
        business_id=business_id,
        service_name=service_name,
        services_offered_payload=new_offered_payload,
        services_offered_id=offered_rule_id,
        scoped_rule_ids_to_delete=scoped_ids,
    )
    return {"service": service_name, "deleted_rule_ids": deleted}
