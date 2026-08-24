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

Mira reads the **same `.env` at the repo root** as the main app - not its
own `mira/.env` - since both services run under `managira.com` and share
`DB_CONNECTION_STRING`/`SESSION_SECRET` already. (Every Mira file that calls
`dotenv.config()` points its `path` at the root `.env` explicitly; see
`mira/server.js` and friends.) Mira-specific variables live in that same
root file, grouped under a `# Mira` comment:

```
MIRA_SERVICE_TOKEN=<long random value, generate with: openssl rand -hex 32>
MAIN_APP_INTERNAL_BASE_URL=http://localhost:4000
MIRA_PORT=4100
MIRA_MOCK_LLM=false
OPENROUTER_API_KEY=...      # and/or OPENAI_API_KEY / ANTHROPIC_API_KEY
```

`MIRA_SERVICE_TOKEN` is the bearer token Mira sends as `X-Internal-Token` on
every internal API call; the main app rejects anything without a matching
token (constant-time comparison) - since it's the same `.env` now, there's
only one value to keep in sync, not two.

## Running locally

Fill in the Mira variables (see above) in the repo-root `.env` once - both
services read it.

```bash
# from the repo root - runs both at once (main on :4000, Mira on :4100)
npm run dev
```

Or run them separately:

```bash
# Terminal 1 - main app
cd "MANAGIRA-SMS"
npm start

# Terminal 2 - Mira
cd "MANAGIRA-SMS/mira"
npm install
npm start               # http://localhost:4100
```

**Local dev needs zero cookie configuration.** Cookies are scoped by *host*,
not by port — `localhost:4000` and `localhost:4100` are the same host to a
browser, just different ports. So logging into the main app at
`http://localhost:4000` as normal already sets a cookie that
`http://localhost:4100` (Mira) can read too. Just log in at
`localhost:4000` like you always do, then open `localhost:4100` — no fake
domains, no `/etc/hosts` changes, no extra env vars. (An earlier version of
this doc suggested a fake-domain workaround with an explicit cookie
`Domain` attribute — that actually broke normal login, since a browser
rejects a `Set-Cookie` whose `Domain` doesn't match the host that sent it.
Removed; don't reintroduce it.)

## Deploying `mira.managira.com` (manual steps — I can't do this part)

1. **Render**: create a new Web Service pointed at this repo, root
   directory `mira/`, build command `npm install`, start command
   `npm start`. Set the Mira env vars listed above directly in Render's
   dashboard for this service (a deployed service has no local `.env`
   file to read - the `dotenv.config()` calls are a no-op there and
   process.env comes entirely from what Render injects).
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

Set `OPENROUTER_API_KEY` (preferred - one key reaches many vendors' models
through an OpenAI-compatible API) and/or `OPENAI_API_KEY`/
`ANTHROPIC_API_KEY` directly. Mock mode (`MIRA_MOCK_LLM`) auto-disables the
moment any of these is present - no code change needed. The model router
(`services/modelRouter.js`) tries every configured provider in priority
order (openrouter, then openai, then anthropic) and automatically falls
back to the next one if a call errors or times out.

Test-suite note: `mira/tests` always force `MIRA_MOCK_LLM=true` (set in
`mira/package.json`'s `test` script) regardless of what's in `.env`, so
`npm test` stays free, offline, and deterministic even with a real key
configured for the running app.

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
