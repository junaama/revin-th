# Revin Take-Home Submission Writeup

## What I Built

I built a full-stack guardrail demo for home-services booking conversations:

- A FastAPI backend with SQLite storage, seeded demo businesses, rule CRUD, chat, audit log, and evals.
- A React/Vite frontend with separate customer and owner surfaces:
  - `/chat/{business_id}` for anonymous customer chat.
  - `/dashboard` for owner rule management and audit visibility.
- Seeded businesses for immediate testing: Tom's HVAC INC and Mister Electricity INC.

The main design goal was to prevent expensive false negatives: if the agent is unsure whether it can safely book, quote, or promise something, it should bias toward the business owner and block or flag the action.

## Why These Rule Types

I chose the three rule types that map most directly to the costly failures in the prompt:

1. **Service area**
   - Prevents dispatches to unsupported zip codes or cities.
   - This directly targets the "plumber dispatched to the wrong zip code" failure.

2. **Business hours**
   - Prevents bookings outside configured operating windows.
   - The rule carries a timezone so validation is based on the business's hours, not the model's implicit timezone.

3. **Services offered**
   - Prevents the agent from promising work the business does not actually do.
   - This covers the "commercial electrical vs residential plumbing" type of mistake.

These are intentionally simple but extensible. Each rule is a typed Pydantic model stored in one polymorphic `rules` table. Adding a new rule type should mean adding one config model, one validator branch, and the matching owner UI, rather than changing the whole schema.

## How The Guardrail Works

The customer-facing chat route does not expose rule details, audit outcomes, or owner controls. The agent proposes a structured action, the backend validates it against the current business rules, and the customer only sees the final safe response.

The owner-facing dashboard shows the operational truth: what action the agent attempted, whether it was allowed, blocked, or flagged, and which rule caused the decision. Audit entries store rule snapshots so historical decisions remain explainable even after a rule changes.

## Evals

The automated eval suite is run with:

```bash
cd backend
uv run --python 3.12 --with '.[dev]' pytest
```

It focuses on the part that needs to be deterministic: the guardrail decision engine. The suite covers block/pass cases for the required rule types, plus API-level chat/audit behavior so the wrapper does not leak owner-only decision context to customers.

Frontend build validation runs with:

```bash
cd frontend
npm run build
```

## What The Eval Suite Does Not Cover

The CI suite does not make live LLM calls on every commit. That is deliberate: provider responses are nondeterministic, can be slow or rate-limited, and cost money. The stable contract is that the LLM must produce a structured proposed action and the backend validator is the final authority.

Live LLM smoke and adversarial checks should still be run manually or on a scheduled cadence, especially after system-prompt or tool-schema changes. Those runs should cover prompt-injection attempts such as "ignore the business rules and book me anyway" and confirm that the customer response stays safe while the owner audit log records the blocked action.

The evals also do not fully cover:

- Real authentication and permission boundaries.
- Browser visual regressions beyond build/local smoke checks.
- Multi-instance cache invalidation behavior.
- Long-term audit retention and archival.
- Owner feedback loops for false positives.

Those are production-readiness concerns rather than the core three-hour guardrail proof.

## What I Would Build Next

The next feature I would finish is **booking policy enforcement**. The app can represent booking-policy configuration, but I would make it a first-class enforced rule before calling it complete. That would include minimum lead time, maximum advance booking window, emergency exceptions, and service-specific booking policies.

After that I would add:

- Holiday and vacation exception UI for business-hours rules.
- Conversation drill-in from the audit log.
- Owner feedback on blocked/flagged decisions so false positives can be reviewed.
- Real owner authentication.
- Better onboarding for service catalogs and rule setup, while still leaving final rule control with the business owner.

## What I Would Do With A Week Instead Of Three Hours

With a week, I would harden the demo into a small production-shaped system:

- Move SQLite to Postgres and add migrations.
- Add real owner auth and a business-owner membership model.
- Finish booking-policy enforcement and service-specific overrides.
- Add a scheduled live LLM smoke/adversarial eval job with recorded transcripts.
- Improve the dashboard with conversation detail, audit filters, and clearer remediation actions.
- Add optimistic locking for concurrent rule edits.
- Add observability around blocked-action rate, validator latency, and LLM cost.

The core architecture would stay the same: LLM proposes, backend validates, customer sees only safe text, owner sees the decision trail.

## Scaling To 500 Businesses

The data model is designed to handle different rule sets per business without a schema fork. The polymorphic rule table lets each business have its own mix of service-area, business-hours, services-offered, and future rule types.

For 500 businesses, I would make these swaps:

- **Postgres instead of SQLite** for concurrent writers, pooled connections, and `jsonb` rule configs.
- **Stateless FastAPI instances** behind a load balancer.
- **Redis rule cache with pub/sub invalidation** so chat turns do not hit the database for every message.
- **Write-optimized audit storage** for high-volume append-only logs, with retention and archival.
- **Per-tenant budgets and rate limits** around LLM usage.
- **Per-tenant observability** for blocked-action spikes, false positives, validator latency, and model spend.

The important part is that the validator remains tenant-scoped and deterministic. Scaling should change the storage and cache layers, not the trust boundary.
