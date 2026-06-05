from __future__ import annotations

from copy import deepcopy
import re
from typing import Any, Literal

from anthropic import AsyncAnthropic
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .settings import settings


DiffOp = Literal["keep", "del", "change-from", "add", "change-to"]
RuleType = Literal[
    "business_hours",
    "service_area",
    "services_offered",
    "booking_policy",
]
MutationOperation = Literal["create", "update"]


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class CopilotModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class DiffLine(CopilotModel):
    op: DiffOp
    text: str


class RuleMutation(CopilotModel):
    operation: MutationOperation
    rule_id: str | None = None
    payload: dict[str, Any]


class RuleProposal(CopilotModel):
    rule_type: RuleType
    rule_title: str
    field_label: str
    summary: str
    before: list[DiffLine]
    after: list[DiffLine]
    patch: RuleMutation
    note: str | None = None


class ClarifyChip(CopilotModel):
    label: str
    fill: str


class OwnerCopilotResponse(CopilotModel):
    kind: Literal["proposal", "clarify", "message"]
    message: str | None = None
    proposal: RuleProposal | None = None
    question: str | None = None
    chips: list[ClarifyChip] = Field(default_factory=list)
    reasoning: list[str] = Field(default_factory=list)


OWNER_COPILOT_TOOLS: list[dict[str, Any]] = [
    {
        "name": "propose_business_hours_change",
        "description": "Propose changing default business availability windows.",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [
                            "monday",
                            "tuesday",
                            "wednesday",
                            "thursday",
                            "friday",
                            "saturday",
                            "sunday",
                        ],
                    },
                    "minItems": 1,
                },
                "close_time": {
                    "type": "string",
                    "description": "Closing time in 24-hour HH:MM format.",
                },
                "open_time": {
                    "type": ["string", "null"],
                    "description": "Opening time in 24-hour HH:MM format. Null keeps the existing opening time or defaults to 08:00 for new days.",
                },
            },
            "required": ["days", "close_time"],
        },
    },
    {
        "name": "propose_service_area_change",
        "description": "Propose adding or removing a zip code from the default service area.",
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["add", "remove"]},
                "zip_code": {"type": "string"},
            },
            "required": ["action", "zip_code"],
        },
    },
    {
        "name": "propose_booking_policy_change",
        "description": "Propose changing minimum booking lead time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "min_lead_minutes": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "Required advance notice in minutes.",
                }
            },
            "required": ["min_lead_minutes"],
        },
    },
    {
        "name": "propose_services_offered_change",
        "description": "Propose adding or removing a service from default offered services.",
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["add", "remove"]},
                "service": {"type": "string"},
            },
            "required": ["action", "service"],
        },
    },
    {
        "name": "clarify_rule_change",
        "description": "Ask a clarification question when the owner request lacks a concrete day, time, service, or area.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "question": {"type": "string"},
                "chips": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "fill": {"type": "string"},
                        },
                        "required": ["label", "fill"],
                    },
                    "minItems": 1,
                },
            },
            "required": ["message", "question", "chips"],
        },
    },
]


DAY_NAMES = {
    "monday": "Monday",
    "tuesday": "Tuesday",
    "wednesday": "Wednesday",
    "thursday": "Thursday",
    "friday": "Friday",
    "saturday": "Saturday",
    "sunday": "Sunday",
}
DAY_ORDER = list(DAY_NAMES)
DEFAULT_OPEN_TIME = "08:00"
DEFAULT_MAX_ADVANCE_DAYS = 365
CAPABILITIES_MESSAGE = (
    "I can update your availability, service area, booking policy, and offered "
    "services. Try something like \"Close at 2pm on Sundays\" or "
    "\"Add ZIP 60622 to our service area.\""
)


async def propose_owner_rule_change(
    *,
    business_name: str,
    owner_message: str,
    rules: list[dict[str, Any]],
    timezone: str,
) -> OwnerCopilotResponse:
    """Return a structured dashboard edit proposal from the server side."""
    if settings.anthropic_api_key:
        try:
            return await _llm_owner_rule_change(
                business_name=business_name,
                owner_message=owner_message,
                rules=rules,
                timezone=timezone,
            )
        except Exception:
            pass
    return fallback_owner_rule_change(
        owner_message=owner_message,
        rules=rules,
        timezone=timezone,
    )


def fallback_owner_rule_change(
    *,
    owner_message: str,
    rules: list[dict[str, Any]],
    timezone: str,
) -> OwnerCopilotResponse:
    """Deterministic server fallback used when the LLM is not configured."""
    text = _normalize(owner_message)
    time_value = _extract_time(text)
    days = _extract_days(text)

    if "weekend" in text and not days and not time_value:
        return _weekend_clarification()

    if _mentions_hours(text):
        if days and time_value:
            return _proposal_response(
                _business_hours_proposal(
                    rules=rules,
                    days=days,
                    close_time=time_value,
                    open_time=None,
                    timezone=timezone,
                )
            )
        if time_value:
            weekday_days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
            return _proposal_response(
                _business_hours_proposal(
                    rules=rules,
                    days=weekday_days,
                    close_time=time_value,
                    open_time=None,
                    timezone=timezone,
                )
            )

    zip_match = re.search(r"\b\d{5}(?:-\d{4})?\b", text)
    if zip_match and _mentions_service_area(text):
        action: Literal["add", "remove"] = "remove" if _mentions_remove(text) else "add"
        return _proposal_response(
            _service_area_proposal(
                rules=rules,
                action=action,
                zip_code=zip_match.group(0),
            )
        )

    if _mentions_booking_policy(text):
        lead_minutes = _extract_lead_minutes(text)
        if lead_minutes is not None:
            return _proposal_response(
                _booking_policy_proposal(rules=rules, min_lead_minutes=lead_minutes)
            )

    if _mentions_services_offered(text):
        action = "remove" if _mentions_remove(text) else "add"
        service = _extract_service_name(text, rules=rules, action=action)
        if service:
            return _proposal_response(
                _services_offered_proposal(
                    rules=rules,
                    action=action,
                    service=service,
                )
            )

    return OwnerCopilotResponse(kind="message", message=CAPABILITIES_MESSAGE)


async def _llm_owner_rule_change(
    *,
    business_name: str,
    owner_message: str,
    rules: list[dict[str, Any]],
    timezone: str,
) -> OwnerCopilotResponse:
    client = AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        timeout=settings.request_timeout_seconds,
    )
    response = await client.messages.create(
        model=settings.classifier_model,
        max_tokens=500,
        temperature=0,
        system=_owner_copilot_prompt(business_name, rules),
        tools=OWNER_COPILOT_TOOLS,
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": owner_message}],
    )

    for block in response.content:
        if getattr(block, "type", None) != "tool_use":
            continue
        name = str(getattr(block, "name", ""))
        payload = getattr(block, "input", {}) or {}
        if name == "propose_business_hours_change":
            days = [str(day).lower() for day in payload.get("days", [])]
            close_time = _coerce_hhmm(str(payload.get("close_time", "")))
            if not days or not close_time:
                break
            open_time_raw = payload.get("open_time")
            open_time = _coerce_hhmm(str(open_time_raw)) if open_time_raw else None
            return _proposal_response(
                _business_hours_proposal(
                    rules=rules,
                    days=days,
                    close_time=close_time,
                    open_time=open_time,
                    timezone=timezone,
                )
            )
        if name == "propose_service_area_change":
            action = "remove" if payload.get("action") == "remove" else "add"
            zip_code = str(payload.get("zip_code", "")).strip()
            if zip_code:
                return _proposal_response(
                    _service_area_proposal(
                        rules=rules,
                        action=action,
                        zip_code=zip_code,
                    )
                )
        if name == "propose_booking_policy_change":
            minutes = int(payload.get("min_lead_minutes", 0))
            return _proposal_response(
                _booking_policy_proposal(rules=rules, min_lead_minutes=minutes)
            )
        if name == "propose_services_offered_change":
            action = "remove" if payload.get("action") == "remove" else "add"
            service = str(payload.get("service", "")).strip()
            if service:
                return _proposal_response(
                    _services_offered_proposal(
                        rules=rules,
                        action=action,
                        service=service,
                    )
                )
        if name == "clarify_rule_change":
            try:
                chips = [
                    ClarifyChip.model_validate(chip)
                    for chip in payload.get("chips", [])
                ]
            except ValidationError:
                break
            return OwnerCopilotResponse(
                kind="clarify",
                message=str(payload.get("message", "")),
                question=str(payload.get("question", "")),
                chips=chips,
            )

    return fallback_owner_rule_change(
        owner_message=owner_message,
        rules=rules,
        timezone=timezone,
    )


def _owner_copilot_prompt(business_name: str, rules: list[dict[str, Any]]) -> str:
    compact_rules = [
        {
            "id": rule["id"],
            "type": rule["type"],
            "enabled": rule["enabled"],
            "config": rule["config"],
        }
        for rule in rules
    ]
    return (
        "You are Revin Copilot for a business owner editing dashboard rules. "
        "Never mutate anything directly. Choose exactly one tool that captures the "
        "owner's requested rule edit, or ask for clarification when day, time, "
        "service, or area is ambiguous. Prefer default business-wide rules unless "
        "the owner names a specific service. Business: "
        f"{business_name}. Current rules JSON: {compact_rules}"
    )


def _proposal_response(proposal: RuleProposal) -> OwnerCopilotResponse:
    return OwnerCopilotResponse(
        kind="proposal",
        message=proposal.summary,
        proposal=proposal,
        reasoning=[
            "Reading your request",
            f"Matched rule · {proposal.rule_title}",
            "Drafting the change",
        ],
    )


def _weekend_clarification() -> OwnerCopilotResponse:
    return OwnerCopilotResponse(
        kind="clarify",
        message="Happy to adjust weekend hours. A couple quick things so I get it right:",
        question="Which day(s) should I change, and what new closing time?",
        chips=[
            ClarifyChip(label="Saturday only", fill="Close at 2:00 PM on Saturday"),
            ClarifyChip(label="Sunday only", fill="Close at 2:00 PM on Sunday"),
            ClarifyChip(
                label="Both Sat & Sun",
                fill="Close at 2:00 PM on Saturday and Sunday",
            ),
        ],
    )


def _business_hours_proposal(
    *,
    rules: list[dict[str, Any]],
    days: list[str],
    close_time: str,
    open_time: str | None,
    timezone: str,
) -> RuleProposal:
    rule = _default_rule(rules, "business_hours")
    target_days = _ordered_unique_days(days)
    close_label = _format_time(close_time)
    day_label = _join_labels([DAY_NAMES[day] for day in target_days])
    existing_windows = _windows_for(rule)
    next_windows = deepcopy(existing_windows)
    before: list[DiffLine] = []
    after: list[DiffLine] = []
    touched_existing: set[int] = set()

    for target_day in target_days:
        matched_index = _find_window_index(next_windows, target_day)
        if matched_index is None:
            target_open = open_time or DEFAULT_OPEN_TIME
            next_window = {
                "day": target_day,
                "open_time": target_open,
                "close_time": close_time,
            }
            next_windows.append(next_window)
            after.append(DiffLine(op="add", text=_window_label(next_window)))
            continue

        touched_existing.add(matched_index)
        current = existing_windows[matched_index]
        updated = {
            **next_windows[matched_index],
            "open_time": open_time or str(current.get("open_time") or DEFAULT_OPEN_TIME),
            "close_time": close_time,
        }
        next_windows[matched_index] = updated
        before.append(DiffLine(op="change-from", text=_window_label(current)))
        after.append(DiffLine(op="change-to", text=_window_label(updated)))

    if not before:
        before = [
            DiffLine(op="keep", text=_window_label(window))
            for index, window in enumerate(existing_windows)
            if index not in touched_existing
        ]

    operation: MutationOperation = "update" if rule else "create"
    payload: dict[str, Any] = {"windows": next_windows}
    if not rule:
        payload = {
            "type": "business_hours",
            "timezone": timezone,
            "windows": next_windows,
            "exceptions": [],
        }

    return RuleProposal(
        rule_type="business_hours",
        rule_title="Availability",
        field_label="Weekly windows",
        summary=_hours_summary(
            before=before,
            day_label=day_label,
            close_label=close_label,
        ),
        before=before or [DiffLine(op="keep", text="No weekly windows configured")],
        after=after,
        note=(
            f"{day_label} will open at {_format_time(open_time or DEFAULT_OPEN_TIME)} "
            "by default. Want a different open time? Just say so."
        )
        if any(line.op == "add" for line in after)
        else "This updates the existing weekly window.",
        patch=RuleMutation(
            operation=operation,
            rule_id=rule["id"] if rule else None,
            payload=payload,
        ),
    )


def _hours_summary(
    *,
    before: list[DiffLine],
    day_label: str,
    close_label: str,
) -> str:
    action = "add" if not any(line.op == "change-from" for line in before) else "move"
    if action == "add":
        return f"I'll add {day_label} hours, closing at {close_label}."
    return f"I'll move {day_label} closing time to {close_label}."


def _service_area_proposal(
    *,
    rules: list[dict[str, Any]],
    action: Literal["add", "remove"],
    zip_code: str,
) -> RuleProposal:
    rule = _default_rule(rules, "service_area")
    config = dict(rule["config"]) if rule else {}
    zip_codes = [str(item) for item in config.get("zip_codes", []) if str(item).strip()]
    normalized_zip = _normalize_zip(zip_code)
    existing_normalized = [_normalize_zip(item) for item in zip_codes]

    if action == "remove":
        next_zip_codes = [
            item
            for item in zip_codes
            if _normalize_zip(item) != normalized_zip
        ]
        before = [DiffLine(op="del", text=zip_code)]
        after = [DiffLine(op="keep", text=item) for item in next_zip_codes]
        summary = f"I'll remove ZIP code {zip_code} from your service area."
        note = f"Bookings and quotes from {zip_code} will be declined after this change."
    else:
        next_zip_codes = zip_codes if normalized_zip in existing_normalized else [*zip_codes, zip_code]
        before = [DiffLine(op="keep", text=item) for item in zip_codes]
        after = [DiffLine(op="add", text=zip_code)]
        summary = f"I'll add ZIP code {zip_code} to your service area."
        note = f"You'll start accepting bookings and quotes in {zip_code}."

    operation: MutationOperation = "update" if rule else "create"
    payload: dict[str, Any] = {"zip_codes": next_zip_codes}
    if not rule:
        payload = {
            "type": "service_area",
            "zip_codes": next_zip_codes,
            "cities": [],
        }

    return RuleProposal(
        rule_type="service_area",
        rule_title="Service area",
        field_label="ZIP codes",
        summary=summary,
        before=before or [DiffLine(op="keep", text="No ZIP codes configured")],
        after=after,
        note=note,
        patch=RuleMutation(
            operation=operation,
            rule_id=rule["id"] if rule else None,
            payload=payload,
        ),
    )


def _booking_policy_proposal(
    *,
    rules: list[dict[str, Any]],
    min_lead_minutes: int,
) -> RuleProposal:
    rule = _default_rule(rules, "booking_policy")
    config = dict(rule["config"]) if rule else {}
    current_minutes = int(config.get("min_lead_minutes", 0) or 0)
    new_label = _format_minutes(min_lead_minutes)
    old_label = _format_minutes(current_minutes) if rule else "No minimum lead time"
    operation: MutationOperation = "update" if rule else "create"
    payload: dict[str, Any] = {"min_lead_minutes": min_lead_minutes}
    if not rule:
        payload = {
            "type": "booking_policy",
            "min_lead_minutes": min_lead_minutes,
            "max_advance_days": DEFAULT_MAX_ADVANCE_DAYS,
        }

    return RuleProposal(
        rule_type="booking_policy",
        rule_title="Booking policy",
        field_label="Minimum lead time",
        summary=f"I'll require {new_label} of advance notice for bookings.",
        before=[DiffLine(op="change-from", text=old_label)],
        after=[DiffLine(op="change-to", text=new_label)],
        note=f"Customers won't be able to book a slot less than {new_label} away.",
        patch=RuleMutation(
            operation=operation,
            rule_id=rule["id"] if rule else None,
            payload=payload,
        ),
    )


def _services_offered_proposal(
    *,
    rules: list[dict[str, Any]],
    action: Literal["add", "remove"],
    service: str,
) -> RuleProposal:
    rule = _default_rule(rules, "services_offered")
    services = [
        str(item)
        for item in (rule or {}).get("config", {}).get("services", [])
        if str(item).strip()
    ]
    if action == "remove":
        next_services = [
            item for item in services if _normalize(item) != _normalize(service)
        ]
        before = [DiffLine(op="del", text=service)]
        after = [DiffLine(op="keep", text=item) for item in next_services]
        summary = f"I'll stop offering {service}."
        note = f"{service} will no longer be bookable. Existing appointments are unaffected."
    else:
        next_services = (
            services
            if any(_normalize(item) == _normalize(service) for item in services)
            else [*services, service]
        )
        before = [DiffLine(op="keep", text=item) for item in services]
        after = [DiffLine(op="add", text=service)]
        summary = f"I'll add {service} to your offered services."
        note = f"Customers will be able to ask for {service}."

    operation: MutationOperation = "update" if rule else "create"
    payload: dict[str, Any] = {"services": next_services}
    if not rule:
        payload = {"type": "services_offered", "services": next_services}

    return RuleProposal(
        rule_type="services_offered",
        rule_title="Services offered",
        field_label="Offered services",
        summary=summary,
        before=before or [DiffLine(op="keep", text="No services configured")],
        after=after,
        note=note,
        patch=RuleMutation(
            operation=operation,
            rule_id=rule["id"] if rule else None,
            payload=payload,
        ),
    )


def _default_rule(
    rules: list[dict[str, Any]],
    rule_type: RuleType,
) -> dict[str, Any] | None:
    typed = [rule for rule in rules if rule["type"] == rule_type]
    for rule in typed:
        if not rule["config"].get("service"):
            return rule
    return typed[0] if typed else None


def _windows_for(rule: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not rule:
        return []
    windows = rule["config"].get("windows", [])
    if not isinstance(windows, list):
        return []
    return [dict(window) for window in windows if isinstance(window, dict)]


def _find_window_index(windows: list[dict[str, Any]], day: str) -> int | None:
    for index, window in enumerate(windows):
        if str(window.get("day", "")).lower() == day:
            return index
    return None


def _window_label(window: dict[str, Any]) -> str:
    day = DAY_NAMES.get(str(window.get("day", "")).lower(), str(window.get("day", "")))
    open_time = _format_time(str(window.get("open_time", DEFAULT_OPEN_TIME)))
    close_time = _format_time(str(window.get("close_time", "")))
    return f"{day} {open_time}-{close_time}"


def _ordered_unique_days(days: list[str]) -> list[str]:
    valid = {day for day in days if day in DAY_NAMES}
    return [day for day in DAY_ORDER if day in valid]


def _extract_days(text: str) -> list[str]:
    days: list[str] = []
    for day in DAY_ORDER:
        if day in text or f"{day}s" in text:
            days.append(day)
    if "weekday" in text:
        days.extend(["monday", "tuesday", "wednesday", "thursday", "friday"])
    if "weekend" in text and ("saturday" in text or "sunday" in text):
        days.extend(["saturday", "sunday"])
    if ("sat" in text and "sun" in text) or "both sat" in text:
        days.extend(["saturday", "sunday"])
    elif re.search(r"\bsat\b", text):
        days.append("saturday")
    elif re.search(r"\bsun\b", text):
        days.append("sunday")
    return _ordered_unique_days(days)


def _extract_time(text: str) -> str | None:
    match = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b", text)
    if not match:
        match = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", text)
        if match:
            return f"{int(match.group(1)):02d}:{match.group(2)}"
        return None

    hour = int(match.group(1))
    minute = int(match.group(2) or "00")
    suffix = match.group(3)[0]
    if suffix == "p" and hour != 12:
        hour += 12
    if suffix == "a" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def _coerce_hhmm(value: str) -> str | None:
    value = value.strip()
    if re.match(r"^[0-2]?\d:[0-5]\d$", value):
        hour, minute = value.split(":", 1)
        if int(hour) > 23:
            return None
        return f"{int(hour):02d}:{minute}"
    return _extract_time(value)


def _extract_lead_minutes(text: str) -> int | None:
    match = re.search(r"\b(\d{1,3})\s*(hours?|hrs?|days?)\b", text)
    if not match:
        return None
    amount = int(match.group(1))
    unit = match.group(2)
    if unit.startswith("day"):
        return amount * 24 * 60
    return amount * 60


def _extract_service_name(
    text: str,
    *,
    rules: list[dict[str, Any]],
    action: str,
) -> str | None:
    offered = _default_rule(rules, "services_offered")
    services = [
        str(item)
        for item in (offered or {}).get("config", {}).get("services", [])
        if str(item).strip()
    ]
    if action == "remove":
        for service in services:
            if _normalize(service) in text:
                return service
        return None

    match = re.search(r"\b(?:add|offer|start offering)\s+(.+?)(?:\s+to|\s+as|\s*$)", text)
    if not match:
        return None
    return " ".join(match.group(1).split())


def _mentions_hours(text: str) -> bool:
    return any(
        token in text
        for token in [
            "hour",
            "close",
            "closing",
            "open",
            "availability",
            "sunday",
            "saturday",
            "weekday",
            "weekend",
        ]
    )


def _mentions_service_area(text: str) -> bool:
    return any(
        token in text
        for token in ["zip", "service area", "area", "serve", "cover", "coverage"]
    )


def _mentions_booking_policy(text: str) -> bool:
    return any(
        token in text
        for token in ["notice", "lead time", "ahead", "advance", "minimum"]
    )


def _mentions_services_offered(text: str) -> bool:
    return any(
        token in text
        for token in ["service", "offering", "offer", "bookable", "remove", "disable"]
    )


def _mentions_remove(text: str) -> bool:
    return any(token in text for token in ["remove", "stop", "drop", "no longer", "disable"])


def _format_time(value: str) -> str:
    coerced = _coerce_hhmm(value)
    if not coerced:
        return value
    hour, minute = (int(part) for part in coerced.split(":", 1))
    suffix = "PM" if hour >= 12 else "AM"
    display_hour = hour % 12 or 12
    return f"{display_hour}:{minute:02d} {suffix}"


def _format_minutes(minutes: int) -> str:
    if minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} hour{'s' if hours != 1 else ''}"
    return f"{minutes} minutes"


def _join_labels(labels: list[str]) -> str:
    if not labels:
        return ""
    if len(labels) == 1:
        return labels[0]
    return f"{', '.join(labels[:-1])} and {labels[-1]}"


def _normalize(value: str) -> str:
    return " ".join(value.strip().lower().split())


def _normalize_zip(value: str) -> str:
    stripped = value.strip()
    if "-" in stripped and stripped.replace("-", "").isdigit():
        return stripped.split("-", 1)[0]
    return stripped
