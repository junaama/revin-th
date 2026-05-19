# Revin Guardrail Take-Home

Monorepo for a business-owner-safe booking guardrail:

- `backend/` FastAPI, SQLite, Anthropic tool wrapper, pure validator evals
- `frontend/` Vite + React + Tailwind customer chat route and owner dashboard route

The build follows the sequence in `ARCHITECTURE.md`: health/deploy skeleton, pure validator contract and evals, schema/seed/rule CRUD, chat/audit integration, then React chat + audit dashboard.

## Requirements

- Python 3.12
- `uv`
- Node 22+
- Anthropic API key
- Railway CLI and GitHub `gh` CLI if you are deploying or creating a remote repo

## Environment

Do not paste secrets into chat or commit them.

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

GitHub Actions runs both checks on every `push` and every pull request update. GitHub Actions cannot run on a purely local commit until it is pushed. If you want true local per-commit checks:

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
  -d '{"content":"Can you book hvac repair Sunday at 2pm in 78704?"}'
```

Expected outcome for that chat smoke is `blocked`.
