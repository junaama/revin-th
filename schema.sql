-- ============================================================================
-- Revin guardrail take-home — SQLite schema
-- Run:  sqlite3 app.db < schema.sql
-- ============================================================================
--
-- Conventions in this file:
--   - IDs are TEXT (UUID strings). SQLite has no native UUID type.
--   - Timestamps are INTEGER (Unix epoch seconds). Business-logic time zones
--     live on the rule that needs them (business_hours), not on the DB column.
--   - JSON columns are TEXT. Query with json_extract() if needed (JSON1 ext).
--   - Booleans are INTEGER 0/1.
--   - SQLite does not enforce foreign keys by default. Turn them on per
--     connection (PRAGMA below + a SQLAlchemy listener if you use ORM).
-- ============================================================================

PRAGMA foreign_keys = ON;


-- ----------------------------------------------------------------------------
-- businesses: the tenant. Seeded by the app developer.
-- ----------------------------------------------------------------------------
CREATE TABLE businesses (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    timezone    TEXT NOT NULL DEFAULT 'America/Chicago',   -- IANA
    created_at  INTEGER NOT NULL
);


-- ----------------------------------------------------------------------------
-- business_owners: humans who configure rules and view the dashboard.
-- Auth is stubbed: "log in as Tom's HVAC" picks a seeded owner — no password.
-- ----------------------------------------------------------------------------
CREATE TABLE business_owners (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL UNIQUE,
    business_id  TEXT NOT NULL REFERENCES businesses(id),
    created_at   INTEGER NOT NULL
);

CREATE INDEX idx_owners_business ON business_owners(business_id);


-- ----------------------------------------------------------------------------
-- customers: people who message the agent. No login, no password.
-- May be anonymous (all fields nullable except id + created_at).
-- ----------------------------------------------------------------------------
CREATE TABLE customers (
    id            TEXT PRIMARY KEY,
    name          TEXT,
    contact_info  TEXT,                -- phone or email
    created_at    INTEGER NOT NULL
);


-- ----------------------------------------------------------------------------
-- rules: polymorphic. One row per rule, regardless of type.
-- `config` is a JSON blob whose shape is validated by your Pydantic
-- discriminated union at write time (in the FastAPI request handler).
-- Adding a new rule type = new Pydantic model + new validator branch,
-- zero schema change.
-- ----------------------------------------------------------------------------
CREATE TABLE rules (
    id           TEXT PRIMARY KEY,
    business_id  TEXT NOT NULL REFERENCES businesses(id),
    type         TEXT NOT NULL
                 CHECK (type IN ('service_area','business_hours','services_offered')),
    config       TEXT NOT NULL,                 -- JSON
    enabled      INTEGER NOT NULL DEFAULT 1,    -- 0/1
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

-- The validator's hot read: "all enabled rules for business X"
CREATE INDEX idx_rules_business_enabled ON rules(business_id, enabled);


-- ----------------------------------------------------------------------------
-- conversations: one per chat session.
-- business_id is set on creation when the customer lands on /chat/<business>.
-- ----------------------------------------------------------------------------
CREATE TABLE conversations (
    id           TEXT PRIMARY KEY,
    business_id  TEXT NOT NULL REFERENCES businesses(id),
    customer_id  TEXT REFERENCES customers(id),   -- nullable: anonymous OK
    created_at   INTEGER NOT NULL
);

CREATE INDEX idx_conv_business_time ON conversations(business_id, created_at DESC);


-- ----------------------------------------------------------------------------
-- messages: chat history.
-- ----------------------------------------------------------------------------
CREATE TABLE messages (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id),
    role             TEXT NOT NULL CHECK (role IN ('customer','agent','system')),
    content          TEXT NOT NULL,
    created_at       INTEGER NOT NULL
);

CREATE INDEX idx_msg_conv_time ON messages(conversation_id, created_at);


-- ----------------------------------------------------------------------------
-- audit_log: every action the agent proposed and what the validator decided.
-- This is the dashboard's read source.
--
-- `violations` is a JSON array matching list[Violation] from your Pydantic
-- contract. Each violation carries the rule snapshot at decision time, so
-- the log replays correctly even if the rule is edited later.
-- `action_proposed` is the full ProposedAction JSON from the LLM.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
    id                  TEXT PRIMARY KEY,
    business_id         TEXT NOT NULL REFERENCES businesses(id),
    conversation_id     TEXT REFERENCES conversations(id),
    customer_name       TEXT,                               -- denormalized
    action_proposed     TEXT NOT NULL,                      -- JSON
    outcome             TEXT NOT NULL
                        CHECK (outcome IN ('allowed','blocked','flagged')),
    violations          TEXT NOT NULL DEFAULT '[]',         -- JSON array
    created_at          INTEGER NOT NULL
);

-- Dashboard's hot read: "my business's most recent log entries"
CREATE INDEX idx_audit_business_time
    ON audit_log(business_id, created_at DESC);

-- Optional but cheap: filter dashboard by outcome ("show me just blocks")
CREATE INDEX idx_audit_business_outcome
    ON audit_log(business_id, outcome, created_at DESC);
