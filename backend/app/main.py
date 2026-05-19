from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db
from .agent import AgentUnavailable, classify_action, synthesize_reply
from .settings import settings
from .validator_contract import RuleAdapter, evaluate


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Revin Guardrail API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    content: str = Field(min_length=1)


class ChatResponse(BaseModel):
    conversation_id: str
    message_id: str
    content: str
    outcome: Literal["allowed", "blocked", "flagged"]


class RulePatch(BaseModel):
    enabled: bool | None = None

    model_config = {"extra": "allow"}


def _owner_business_id(x_business_id: str | None = Header(default=None)) -> str:
    if not x_business_id:
        raise HTTPException(status_code=400, detail="Missing X-Business-Id header")
    if not db.get_business(x_business_id):
        raise HTTPException(status_code=404, detail="Business not found")
    return x_business_id


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/businesses")
def businesses() -> list[dict[str, Any]]:
    return db.list_businesses()


@app.post("/chat/{business_id}/messages", response_model=ChatResponse)
async def chat_message(business_id: str, request: ChatRequest) -> ChatResponse:
    business = db.get_business(business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    conversation_id = request.conversation_id or db.create_conversation(business_id)
    db.insert_message(conversation_id, "customer", request.content)
    rules = db.get_enabled_rule_models(business_id)

    try:
        action = await classify_action(
            business_name=business["name"],
            customer_message=request.content,
            rules=rules,
        )
    except AgentUnavailable as exc:
        raise HTTPException(status_code=503, detail="Agent unavailable") from exc

    decision = evaluate(rules, action)
    db.append_audit_log(
        business_id=business_id,
        conversation_id=conversation_id,
        action_proposed=action.model_dump(mode="json"),
        outcome=decision.outcome,
        violations=[v.model_dump(mode="json") for v in decision.violations],
    )

    content = await synthesize_reply(
        business_name=business["name"],
        customer_message=request.content,
        action=action,
        decision=decision,
    )
    message_id = db.insert_message(conversation_id, "agent", content)
    return ChatResponse(
        conversation_id=conversation_id,
        message_id=message_id,
        content=content,
        outcome=decision.outcome,
    )


@app.get("/chat/{business_id}/conversations/{conversation_id}/messages")
def chat_history(business_id: str, conversation_id: str) -> list[dict[str, Any]]:
    if not db.get_business(business_id):
        raise HTTPException(status_code=404, detail="Business not found")
    return db.list_messages(business_id, conversation_id)


@app.get("/rules")
def list_rules(business_id: str = Depends(_owner_business_id)) -> list[dict[str, Any]]:
    return db.list_rules(business_id)


@app.post("/rules", status_code=201)
def create_rule(
    payload: dict[str, Any],
    business_id: str = Depends(_owner_business_id),
) -> dict[str, Any]:
    rule = RuleAdapter.validate_python(payload)
    return db.create_rule(business_id, rule.model_dump(mode="json"))


@app.patch("/rules/{rule_id}")
def patch_rule(
    rule_id: str,
    patch: RulePatch,
    business_id: str = Depends(_owner_business_id),
) -> dict[str, Any]:
    updated = db.update_rule(
        business_id,
        rule_id,
        patch.model_dump(exclude_unset=True, mode="json"),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Rule not found")
    return updated


@app.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: str, business_id: str = Depends(_owner_business_id)) -> None:
    if not db.delete_rule(business_id, rule_id):
        raise HTTPException(status_code=404, detail="Rule not found")


@app.get("/audit-log")
def audit_log(
    business_id: str = Depends(_owner_business_id),
    outcome: Literal["allowed", "blocked", "flagged"] | None = None,
    before: int | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> list[dict[str, Any]]:
    return db.list_audit_log(business_id, outcome=outcome, before=before, limit=limit)


@app.get("/conversations")
def conversations(
    business_id: str = Depends(_owner_business_id),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[dict[str, Any]]:
    return db.list_conversations(business_id, limit=limit)
