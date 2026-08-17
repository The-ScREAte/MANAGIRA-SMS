# Mira — Managira's AI Assistant

"Mira" is a working name — expect it to change. This document covers how the
service is built, how to run it locally, and the manual steps needed to
deploy it as `mira.managira.com`.

## Why a separate service

AI work (LLM calls, embeddings, RAG retrieval, streaming, tool chains) is
heavy and bursty. Running it inside the main Managira process would compete
with normal school-portal traffic for CPU, memory, and DB connections, and a
crash or overload in the AI path could take down the core app. Mira is its
own deployable Node service (`mira/`), with its own process, its own
Postgres connection (defaults to the main DB, can be pointed at a dedicated
instance later), and its own Redis-backed rate limiting/caching — isolated
so AI traffic never degrades the school-management app, and vice versa.

## Architecture

```
Browser (already logged into Managira)
   │  same session cookie (domain=.managira.com in production)
   ▼
Mira (mira/, its own Node process, subdomain mira.managira.com)
   │  every request: validate the session, resolve tenant, then...
   ├─ SSE stream (Server-Sent Events) back to the browser
   ├─ model calls -> OpenAI / Anthropic (or mock mode)
   ├─ tool calls -> internal API on the MAIN app (never direct DB access
   │  to the main app's tables - see routes/internalApiRoute.js)
   └─ its own tables (mira_*) in Postgres for chat history, tool-call
      audit log, usage ledger, and pgvector embeddings
```

Mira never queries the main app's operational tables (students, fees,
attendance, etc.) directly. Every read/write of that data goes through a
thin, service-token-gated internal API added to the main app
(`routes/internalApiRoute.js` + `controllers/internalApiController.js`),
which reuses the same query patterns the main controllers already use —
it's a translation layer, not a second copy of the business logic.

## Environment variables

See `mira/.env.example` for the full list with comments. The main app needs
one addition of its own:

```
# main app's .env
MIRA_SERVICE_TOKEN=<same long random value as Mira's .env>
```

Generate the shared token once with `openssl rand -hex 32` and put the same
value in both services' env — this is the bearer token Mira sends as
`X-Internal-Token` on every internal API call, and the main app rejects
anything without a matching token (constant-time comparison).

## Running locally

```bash
# Terminal 1 - main app (needs MIRA_SERVICE_TOKEN set)
cd "MANAGIRA-SMS"
MIRA_SERVICE_TOKEN=dev-token-change-me npm start

# Terminal 2 - Mira
cd "MANAGIRA-SMS/mira"
cp .env.example .env   # fill in DB_CONNECTION_STRING, SESSION_SECRET,
                        # MIRA_SERVICE_TOKEN (same value as above)
npm install
npm start               # http://localhost:4100
```

**Local-dev cookie caveat**: in production the session cookie's domain is
already `.managira.com`, so the browser sends it to any subdomain — nothing
to configure. Locally there's no shared domain by default (main app on
`localhost:4000`, Mira on `localhost:4100` are different origins as far as
cookies are concerned), so a browser session started on the main app won't
automatically reach Mira unless you opt in to the local-domain setup below.

**Local-domain setup (implemented, opt-in)**:
1. One-time: add to `/etc/hosts` (needs sudo):
   ```
   127.0.0.1  app.managira.local
   127.0.0.1  mira.managira.local
   ```
2. In the **main app's** `.env`, set `LOCAL_DEV_COOKIE_DOMAIN=.managira.local`
   (already set if you're reading this after the initial setup — leaving it
   unset preserves the old plain-`localhost` behavior exactly, so this never
   breaks anyone who hasn't opted in).
3. Log in at `http://app.managira.local:4000` (not `localhost:4000` — the
   cookie is scoped to `.managira.local`, so it won't be sent to plain
   `localhost`).
4. Open Mira at `http://mira.managira.local:4100` — same session, no second
   login, exactly like production.

## Deploying `mira.managira.com` (manual steps — I can't do this part)

1. **Render**: create a new Web Service pointed at this repo, root
   directory `mira/`, build command `npm install`, start command
   `npm start`. Set all the env vars from `mira/.env.example`.
2. **DNS**: add a CNAME (or A record, per Render's instructions) for
   `mira` pointing at the new service's Render hostname.
3. **Reverse proxy / TLS**: if Render is fronting this directly, its
   managed TLS covers `mira.managira.com` once the custom domain is
   verified — no extra reverse proxy needed. If there's an existing proxy
   in front of the main app, route `mira.managira.com` to the new service
   the same way the main domain is routed today.
4. **Cookie domain**: already `.managira.com` in production
   (`server.js`'s session config) — no change needed for Mira to receive
   it.
5. **Redis**: point `REDIS_URL` at the same Redis instance the main app
   uses (`utils/cacheManager.js`), or provision a new one — Mira namespaces
   its keys under `mira:` either way, so they never collide with the main
   app's `managira:cache:*` keys.
6. **Background worker**: `mira/jobs/reindexWorker.js` needs to run as its
   own long-lived process (a second Render service, "Background Worker"
   type, same repo/root directory, start command
   `node jobs/reindexWorker.js`) — it consumes the BullMQ re-indexing
   queue and must not run inside the request-serving web service.

## Adding real LLM keys

Set `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` in Mira's env. Mock mode
(`MIRA_MOCK_LLM`) auto-disables the moment either key is present — no code
change needed. The model router calls OpenAI and Anthropic behind one
interface (`services/modelRouter.js`) and automatically retries on the
other provider if the primary one errors or times out.

## Security notes

- **Internal API auth**: a shared bearer token, compared in constant time
  (`middleware/internalServiceAuth.js`). Documented hardening option for
  later: mTLS between the two services — not implemented now since no
  cert infrastructure exists to hang it off yet.
- **Tenant isolation**: enforced in SQL on every query (internal API
  endpoints always filter by `organization_id`), not just in application
  code. Tools receive `tenant` from the *validated* session
  (`middleware/tenantScope.js`) — the model itself never supplies an
  organization ID, so it can't be prompted into asking for another
  school's data.
- **PII minimization**: tool responses return only the fields each tool
  actually needs (e.g. `find_student` doesn't return `date_of_birth`,
  `address`, etc.) rather than full table rows.
- **Known committed secret** (flagged during the initial repo audit, not
  fixed per your instruction to defer): `.vscode/settings.json` on `main`
  has a live Postgres connection string committed. Still worth rotating
  and removing from tracking when you're ready — see the audit notes from
  that conversation.

## What's genuinely working vs. what's scaffolded

Built and verified against real org-63 data during development (see commit
messages for the specific checks run): SSO session validation, all 10
tools (`find_student`, `find_contact`, `get_fees`, `get_attendance`,
`get_class`, `get_term`, `draft_message`, `create_announcement`,
`generate_report_card_summary`, `list_projects`), SSE streaming, the
tool-calling loop, chat persistence + audit logging, RAG embed/store/search
on pgvector with tenant isolation, rate limiting, and budget-cap
enforcement — all with mock LLM responses (deterministic keyword-triggered
tool selection), since no live API keys were available. Swapping in real
keys requires no code changes.

Deliberately simplified/deferred (called out in commit messages, not
silently skipped):
- `generate_report_card_summary` covers attendance + fee standing only,
  not the full grading/assessment system.
- `get_fees` is a payments-recorded summary, not a full Paygira billing-
  status mirror.
- Automatic re-indexing on data change uses a manual/queued trigger, not
  a live webhook from the main app (a larger change than this pass should
  absorb — noted as intentional scope in the approved plan).
- No manual light/dark theme toggle UI yet — the CSS supports it
  (`data-theme` attribute hook), it's just not wired to a button.
