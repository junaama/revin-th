from __future__ import annotations

import sqlite3
import time
from typing import Any

from .validator_contract import RuleAdapter


BUSINESSES = [
    ("biz_toms_hvac", "Tom's HVAC INC", "America/Chicago"),
    ("biz_mister_electricity", "Mister Electricity INC", "America/Chicago"),
]

BUSINESS_OWNERS = [
    ("owner_tom", "Tom Alvarez", "tom@example.test", "biz_toms_hvac"),
    (
        "owner_mister_electricity",
        "Mia Benton",
        "mia@example.test",
        "biz_mister_electricity",
    ),
]

def _weekday_windows(open_time: str, close_time: str) -> list[dict[str, str]]:
    return [
        {"day": day, "open_time": open_time, "close_time": close_time}
        for day in ("monday", "tuesday", "wednesday", "thursday", "friday")
    ]


RULES: list[tuple[str, str, dict[str, Any]]] = [
    (
        "biz_toms_hvac",
        "services_offered",
        {
            "type": "services_offered",
            "id": "rule_toms_services",
            "services": ["hvac repair", "ac tune up", "furnace inspection"],
        },
    ),
    (
        "biz_toms_hvac",
        "service_area",
        {
            "type": "service_area",
            "id": "rule_toms_area",
            "zip_codes": ["78704", "78745", "78748"],
            "cities": ["Austin, TX", "Sunset Valley, TX"],
        },
    ),
    (
        "biz_toms_hvac",
        "business_hours",
        {
            "type": "business_hours",
            "id": "rule_toms_hours",
            "timezone": "America/Chicago",
            "windows": _weekday_windows("09:00", "17:00"),
            "exceptions": [
                {
                    "start_date": "2026-07-04",
                    "end_date": "2026-07-04",
                    "reason": "Independence Day",
                }
            ],
        },
    ),
    (
        "biz_mister_electricity",
        "services_offered",
        {
            "type": "services_offered",
            "id": "rule_electric_services",
            "services": [
                "panel repair",
                "outlet installation",
                "lighting installation",
            ],
        },
    ),
    (
        "biz_mister_electricity",
        "service_area",
        {
            "type": "service_area",
            "id": "rule_electric_area",
            "zip_codes": ["60607", "60608", "60616"],
            "cities": ["Chicago, IL", "Cicero, IL"],
        },
    ),
    (
        "biz_mister_electricity",
        "business_hours",
        {
            "type": "business_hours",
            "id": "rule_electric_hours",
            "timezone": "America/Chicago",
            "windows": _weekday_windows("08:00", "18:00"),
        },
    ),
]


def seed_if_empty(conn: sqlite3.Connection) -> bool:
    count = conn.execute("SELECT COUNT(*) AS count FROM businesses").fetchone()["count"]
    if count:
        return False
    seed_demo_data(conn)
    return True


def seed_demo_data(conn: sqlite3.Connection) -> None:
    now = int(time.time())
    conn.executemany(
        """
        INSERT OR IGNORE INTO businesses (id, name, timezone, created_at)
        VALUES (?, ?, ?, ?)
        """,
        [(business_id, name, tz, now) for business_id, name, tz in BUSINESSES],
    )
    conn.executemany(
        """
        INSERT OR IGNORE INTO business_owners (id, name, email, business_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            (owner_id, name, email, business_id, now)
            for owner_id, name, email, business_id in BUSINESS_OWNERS
        ],
    )

    conn.executemany(
        """
        INSERT OR IGNORE INTO rules
            (id, business_id, type, config, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        """,
        [
            (
                validated.id,
                business_id,
                validated.type,
                validated.model_dump_json(),
                now,
                now,
            )
            for business_id, _rule_type, config in RULES
            for validated in [RuleAdapter.validate_python(config)]
        ],
    )


def main() -> None:
    from . import db

    db.init_db()
    with db.connect() as conn:
        seed_demo_data(conn)
    print("Seeded demo businesses and rules.")


if __name__ == "__main__":
    main()
