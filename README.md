# Agent Revin Take-Home

- `backend/` FastAPI, SQLite, Anthropic tool wrapper, validator evals
- `frontend/` Vite + React + Tailwind customer chat route and owner dashboard route

## Live Demo

- Frontend: https://revin-frontend-production-d183.up.railway.app
- Customer chat: https://revin-frontend-production-d183.up.railway.app/chat/biz_toms_hvac
- Owner dashboard: https://revin-frontend-production-d183.up.railway.app/dashboard
- Backend health: https://revin-backend-production.up.railway.app/health

Use the customer chat to act as a homeowner. Use the owner dashboard to inspect rules, service configuration, and the audit log.

## Submission Notes

### Why These Rules

I chose the three rule types that map directly to the expensive failures in the prompt:

- **Service area** blocks unsupported zip codes or cities.
- **Business hours** blocks bookings outside the business's configured schedule and timezone.
- **Services offered** blocks the agent from promising work the business does not do.

The data model also supports service-specific overrides, so a business can have broad default rules plus narrower rules for a specific service. Rules are stored in one polymorphic table and validated with Pydantic discriminated unions

### Guardrail Flow

The LLM never directly books or promises work. It proposes a structured action, the backend validator checks that action against the business rules, and the customer sees only the safe final text. The owner dashboard shows the full decision context: proposed action, outcome, violation reason, and the rule snapshot captured at decision time.

### Manual Real-LLM Proof

The deterministic CI suite uses mocks around LLM calls, but the manual proof does not. I added a repeatable runner that goes through the real `POST /chat/{business_id}/messages` path with the configured Anthropic classifier and synthesizer:

```bash
cd backend
uv run --python 3.12 --with '.[dev]' python scripts/run_manual_llm_evals.py
```

Latest recorded run: `4/4 passed`.

| Case | Expected owner audit outcome | Result |
| --- | --- | --- |
| Clean HVAC appointment in `78704` during business hours | `allowed` | passed |
| Sunday HVAC booking | `blocked` | passed |
| HVAC booking in unsupported zip `90210` | `blocked` | passed |
| Prompt injection asking the agent to ignore rules and confirm Sunday booking | `blocked` | passed |

Detailed prompts, customer-visible response summaries, and owner-visible audit results are in [`docs/manual-llm-evals.md`](docs/manual-llm-evals.md).

### What The Evals Do Not Cover

The CI evals do not call live LLMs on every push because provider output is nondeterministic, slower, rate-limited, and costs money. CI instead verifies the deterministic trust boundary: Pydantic contracts, pure rule evaluation, chat/audit persistence, and customer-safe SSE output. Live LLM smoke and adversarial checks are run manually with the script above after prompt or tool-schema changes.

The current evals also do not fully cover real authentication, browser visual regression, multi-instance cache invalidation, long-term audit retention, or owner feedback loops for false positives.

### What I Would Build Next

The first next step is **booking policy enforcement**. The app can configure booking-policy rules for min lead time and max advance window, but I would make those rules part of `evaluate()` before treating that feature as complete. After that I would add holiday/vacation exception UI, conversation drill-in from audit entries, owner feedback on blocked decisions, and real owner auth.

With a full week, I would move SQLite to Postgres with migrations, finish service-specific booking policy enforcement, add scheduled live LLM adversarial evals, add optimistic locking for rule edits, and improve dashboard workflows around audit review and remediation.

### Scaling To 500 Businesses

The core remains: LLM proposes, backend validates, customer sees safe text, owner sees the audit trail. To scale it, I would swap SQLite for Postgres, run stateless FastAPI instances behind a load balancer, cache rules in Redis with pub/sub invalidation on edits, move high-volume audit logs to append-optimized storage like DynamoDB, and add per-tenant LLM budgets plus observability for blocked-action spikes, false positives, validator latency, and model spend.

See [`docs/submission-writeup.md`](docs/submission-writeup.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md) for the longer design notes.

## Requirements

- Python 3.12
- `uv`
- Node 22+
- Anthropic API key
- Railway CLI

## Environment

```bash
cp .env.example .env.local
```

Fill in:

```bash
ANTHROPIC_API_KEY=...
```

Default model split:

- Classifier/tool-choice agent: `claude-haiku-4-5-20251001`
- Final response synthesizer: `claude-sonnet-4-6`

The frontend defaults to `http://localhost:8000`. If needed:

```bash
cp frontend/.env.example frontend/.env.local
```

## Local Setup

Run the backend:

```bash
cd backend
uv run --python 3.12 --with '.[dev]' uvicorn app.main:app --reload --port 8000
```

Run the frontend in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the separated demo routes:

- Customer chat: `http://localhost:5173/chat/biz_toms_hvac`
- Owner dashboard: `http://localhost:5173/dashboard`

Seeded demo businesses are created automatically on backend startup:

- `Tom's HVAC INC`
- `Mister Electricity INC`

Customer routes do not expose owner controls. The owner dashboard sends the selected business as `X-Business-Id` for `/rules`, `/audit-log`, and `/conversations`.

## Checks

Backend evals:

```bash
cd backend
uv run --python 3.12 --with '.[dev]' pytest
```

Frontend build:

```bash
cd frontend
npm run build
```

GitHub Actions runs both checks on every `push` and every pull request update. If you want local per-commit checks:

```bash
git config core.hooksPath .githooks
```

## Railway

Create two Railway services from this repo:

- Backend service root: `backend`
- Frontend service root: `frontend`

Backend variables:

```bash
ANTHROPIC_API_KEY=...
ANTHROPIC_CLASSIFIER_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_SYNTHESIZER_MODEL=claude-sonnet-4-6
FRONTEND_ORIGIN=https://<frontend-service>.up.railway.app
REVIN_DB_PATH=/data/app.db
```

For the SQLite demo database to survive redeploys, attach a Railway volume mounted at `/data`. For throwaway demos, the default local `backend/app.db` path is fine.

Frontend variables:

```bash
VITE_API_URL=https://<backend-service>.up.railway.app
```

The included `railway.toml` files define the service start commands and backend healthcheck.

## API Quick Smoke

```bash
curl http://localhost:8000/health
curl http://localhost:8000/businesses
curl -X POST http://localhost:8000/chat/biz_toms_hvac/messages \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"content":"Can you book hvac repair Sunday at 2pm in 78704?"}'
```

Expected customer response: a safe refusal to book Sunday. Expected owner audit outcome: `blocked`.
