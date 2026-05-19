from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from .settings import BACKEND_DIR, settings
from .seed import seed_if_empty
from .validator_contract import Rule, RuleAdapter


SCHEMA_PATH = BACKEND_DIR / "schema.sql"


def connect() -> sqlite3.Connection:
    db_path = Path(settings.db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        has_schema = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'businesses'"
        ).fetchone()
        if not has_schema:
            conn.executescript(SCHEMA_PATH.read_text())
        seed_if_empty(conn)


def list_businesses() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, name, timezone FROM businesses ORDER BY name"
        ).fetchall()
        return [dict(row) for row in rows]


def get_business(business_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT id, name, timezone FROM businesses WHERE id = ?",
            (business_id,),
        ).fetchone()
        return dict(row) if row else None


def list_rules(business_id: str, *, enabled_only: bool = False) -> list[dict[str, Any]]:
    query = "SELECT * FROM rules WHERE business_id = ?"
    params: list[Any] = [business_id]
    if enabled_only:
        query += " AND enabled = 1"
    query += " ORDER BY type, created_at"

    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
        return [_rule_response(row) for row in rows]


def get_rule(business_id: str, rule_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM rules WHERE business_id = ? AND id = ?",
            (business_id, rule_id),
        ).fetchone()
        return _rule_response(row) if row else None


def get_enabled_rule_models(business_id: str) -> list[Rule]:
    return [RuleAdapter.validate_python(row["config"]) for row in list_rules(business_id, enabled_only=True)]


def create_rule(business_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    rule_id = payload.get("id") or f"rule_{uuid4().hex}"
    config = {**payload, "id": rule_id}
    parsed = RuleAdapter.validate_python(config)

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO rules (id, business_id, type, config, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            """,
            (
                rule_id,
                business_id,
                parsed.type,
                parsed.model_dump_json(),
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM rules WHERE id = ?", (rule_id,)).fetchone()
        return _rule_response(row)


def update_rule(business_id: str, rule_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    existing = get_rule(business_id, rule_id)
    if not existing:
        return None

    enabled_patch = patch.pop("enabled", None)
    enabled = existing["enabled"] if enabled_patch is None else enabled_patch
    config = {**existing["config"], **patch, "id": rule_id}
    parsed = RuleAdapter.validate_python(config)
    now = _now()

    with connect() as conn:
        conn.execute(
            """
            UPDATE rules
               SET type = ?, config = ?, enabled = ?, updated_at = ?
             WHERE business_id = ? AND id = ?
            """,
            (
                parsed.type,
                parsed.model_dump_json(),
                1 if bool(enabled) else 0,
                now,
                business_id,
                rule_id,
            ),
        )
        row = conn.execute(
            "SELECT * FROM rules WHERE business_id = ? AND id = ?",
            (business_id, rule_id),
        ).fetchone()
        return _rule_response(row)


def delete_rule(business_id: str, rule_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM rules WHERE business_id = ? AND id = ?",
            (business_id, rule_id),
        )
        return cur.rowcount > 0


def create_conversation(business_id: str) -> str:
    conversation_id = f"conv_{uuid4().hex}"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO conversations (id, business_id, customer_id, created_at)
            VALUES (?, ?, NULL, ?)
            """,
            (conversation_id, business_id, _now()),
        )
    return conversation_id


def get_conversation(business_id: str, conversation_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, business_id, customer_id, created_at
              FROM conversations
             WHERE business_id = ? AND id = ?
            """,
            (business_id, conversation_id),
        ).fetchone()
        return dict(row) if row else None


def insert_message(conversation_id: str, role: str, content: str) -> str:
    message_id = f"msg_{uuid4().hex}"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO messages (id, conversation_id, role, content, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (message_id, conversation_id, role, content, _now()),
        )
    return message_id


def list_messages(business_id: str, conversation_id: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT m.id, m.role, m.content, m.created_at
              FROM messages m
              JOIN conversations c ON c.id = m.conversation_id
             WHERE c.business_id = ? AND c.id = ?
             ORDER BY m.created_at, m.rowid
            """,
            (business_id, conversation_id),
        ).fetchall()
        return [dict(row) for row in rows]


def list_conversations(business_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT c.id,
                   c.created_at,
                   COUNT(m.id) AS message_count,
                   MAX(m.created_at) AS last_message_at
              FROM conversations c
              LEFT JOIN messages m ON m.conversation_id = c.id
             WHERE c.business_id = ?
             GROUP BY c.id, c.created_at
             ORDER BY COALESCE(MAX(m.created_at), c.created_at) DESC
             LIMIT ?
            """,
            (business_id, limit),
        ).fetchall()
        return [dict(row) for row in rows]


def append_audit_log(
    *,
    business_id: str,
    conversation_id: str,
    action_proposed: dict[str, Any],
    outcome: str,
    violations: list[dict[str, Any]],
    customer_name: str | None = None,
) -> str:
    audit_id = f"audit_{uuid4().hex}"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO audit_log
                (id, business_id, conversation_id, customer_name, action_proposed,
                 outcome, violations, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                audit_id,
                business_id,
                conversation_id,
                customer_name,
                json.dumps(action_proposed),
                outcome,
                json.dumps(violations),
                _now(),
            ),
        )
    return audit_id


def list_audit_log(
    business_id: str,
    *,
    outcome: str | None = None,
    before: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    clauses = ["business_id = ?"]
    params: list[Any] = [business_id]
    if outcome:
        clauses.append("outcome = ?")
        params.append(outcome)
    if before:
        clauses.append("created_at < ?")
        params.append(before)
    params.append(min(limit, 100))

    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT *
              FROM audit_log
             WHERE {' AND '.join(clauses)}
             ORDER BY created_at DESC, id DESC
             LIMIT ?
            """,
            params,
        ).fetchall()
        return [_audit_response(row) for row in rows]


def _rule_response(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "business_id": row["business_id"],
        "type": row["type"],
        "config": json.loads(row["config"]),
        "enabled": bool(row["enabled"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _audit_response(row: sqlite3.Row) -> dict[str, Any]:
    payload = dict(row)
    payload["action_proposed"] = json.loads(payload["action_proposed"])
    payload["violations"] = json.loads(payload["violations"])
    return payload


def _now() -> int:
    return int(time.time())
