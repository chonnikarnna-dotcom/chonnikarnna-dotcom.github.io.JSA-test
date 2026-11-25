# JSA Submission & Approval System

Production-oriented web application for **Job Safety Analysis (JSA)** submission and approval in a beverage / FMCG factory.
Requester → **Area Owner** → **Safety Officer** → Approved, with versioning, private documents, Thai/English UI and PDF, reports and a tamper-evident audit trail.

> An approved JSA is **not** a work permit. The system records the JSA review; permits, isolations and other prerequisites remain separate controls.

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router 6 (data router), React Hook Form + Zod, TanStack Query, i18next, Recharts, in-repo shadcn-style components, IBM Plex Sans Thai |
| Backend | Node.js 22, TypeScript, Express (modular: `modules/*` routes → `services/*`), Zod validation, Pino structured logs, OpenAPI 3 (Swagger UI) |
| Database | PostgreSQL 16, **Drizzle ORM** + drizzle-kit SQL migrations |
| Security | Server-side sessions (hashed tokens, HttpOnly/SameSite cookies), Argon2id, CSRF tokens, Helmet CSP, strict CORS, rate limiting, RBAC + record-level checks, DB immutability triggers, hash-chained audit log |
| Files / PDF | Private disk storage behind authorised download endpoint; pdfkit with embedded Thai font; ExcelJS / CSV exports |
| Tests | Vitest + Supertest against real PostgreSQL; Playwright E2E |

**Why Drizzle instead of Prisma:** Prisma's migrate/query engines are native binaries downloaded at install time from `binaries.prisma.sh`, which was unreachable in the build environment. Drizzle is pure TypeScript with versioned SQL migrations, which also simplifies offline/air-gapped factory deployments. Schema: `backend/src/db/schema.ts`; migrations: `backend/drizzle/*.sql`.

---

## 1. Repository layout

```
backend/            Express API
  src/config.ts     env validation (refuses unsafe production config)
  src/db/           schema.ts, client, migrate.ts, seed.ts, seed-demo.ts, reset.ts (dev only)
  src/lib/          authz (RBAC + record visibility), audit (hash chain), crypto, errors, i18n (PDF/export labels)
  src/middleware/   request id, session loader, CSRF, role guards, central error handler
  src/modules/      auth, jsa, approvals, attachments, notifications, reports, lookups, admin (+ audit-logs)
  src/services/     jsa lifecycle, jsa-content (validation/diff), workflow engine, risk matrix, reference numbers,
                    attachments + storage driver, notifications, reports, pdf, export, settings
  src/jobs/         expiry / reminder scheduler
  drizzle/          0000_init.sql (schema), 0001_integrity_triggers.sql (immutability, audit protection)
  assets/fonts/     Thai font for PDFs (TLWG Loma, GPL + font exception — see LICENSE-tlwg-loma.txt)
  tests/            unit, integration and authorization tests
frontend/           React SPA (pages/, components/, i18n/th.ts + en.ts)
e2e/                Playwright end-to-end tests
docs/ERD.md         Mermaid ER diagram + relationship notes
Dockerfile, docker-compose.yml, .env.example
```

## 2. Local development

Prerequisites: Node.js 22, PostgreSQL 16 (or Docker).

```bash
# 1. Database
cp .env.example .env && docker compose up -d db   # or a local PostgreSQL with role/db "jsa"
createdb jsa_test                 # for the automated tests (owner: jsa)

# 2. Backend
cd backend
cp .env.example .env              # set DATABASE_URL / SESSION_SECRET
npm ci
npm run db:migrate                # apply SQL migrations
npm run db:seed                   # base configuration + development users
npm run db:seed:demo              # optional: sample JSAs created through the real workflow
npm run dev                       # http://localhost:4000  (Swagger UI: /api/docs)

# 3. Frontend (new terminal)
cd frontend
npm ci
npm run dev                       # http://localhost:5173 (proxies /api to :4000)
```

Useful backend scripts: `db:reset` (dev only — drops & re-migrates), `db:generate` (new migration from schema changes), `jobs:run` (expiry job once), `build`, `start`.

### Development accounts (seeded only when `NODE_ENV` ≠ production)

Password for all: `Passw0rd!2026`

| Username | Role(s) | Notes |
|---|---|---|
| `admin` | System Administrator | no approval rights |
| `somchai` | Requester (employee, Maintenance) | |
| `contractor1` | Requester (contractor — Siam Industrial) | |
| `contractor2` | Requester (contractor — Thai Electrical) | cannot see contractor1's records |
| `areaowner1` | Area Owner (primary, most Plant A areas) + Requester | |
| `areaowner2` | Area Owner (Plant B + Boiler; backup elsewhere) + Requester | |
| `safety1` | Safety Officer (all sites) | |
| `safety2` | Safety Officer (Plant B only) | |

In production the seed creates **configuration only** (roles, workflow, master data, templates, provisional matrix); create real users via Administration → Users (invitation links) and remove/disable nothing-but-needed accounts.

## 3. Tests

```bash
cd backend && npm test        # 59 tests: unit + integration + authorization (needs PostgreSQL db "jsa_test"; schema is recreated)
cd frontend && npm test       # 2 tests: timezone conversion, TH/EN key parity
cd e2e && npm ci && npx playwright test   # 8 E2E tests against a running stack (see below)
```

E2E prerequisites: backend running with a freshly seeded DB (`npm run db:reset && npm run db:seed`), frontend dev server on :5173, and a higher login rate limit for the many test logins (`AUTH_RATE_LIMIT=500 npm run dev`). Override the URL with `E2E_BASE_URL`, browser with `PW_CHROMIUM_PATH`.

Coverage highlights:
* **Unit** — reference format, risk score/level, matrix gap/overlap detection, submission rules (steps, hazards, controls, risk, work period, lead time, permits/evidence/confirmations, emergency contact), validity calculation, version diff, permission checks, CSV injection, Thai line-break helper.
* **Integration** — 50 concurrent reference numbers unique; create→submit→AO→SO→approved; DB rejects edits to locked versions & history; return→revision→resubmit→full re-review with change summary; rejection; cancellation; **concurrent double-approval: exactly one succeeds**; residual-risk acceptance block; permit evidence + SO verification; expiry job; attachment validation (extension, magic bytes, path traversal) and authorised download; dashboard totals equal DB counts; register pagination/export scoping; audit chain verification; config changes audited.
* **Authorization** — unauthenticated, missing CSRF, requester approving, cross-contractor access (incl. PDF and cancel), Area Owner outside area, self-approval, SO skipping AO, out-of-scope SO, admin approving, inactive account (sessions revoked), invitation activation, password reset, generic login errors, no stack traces.
* **E2E** — contractor fills all 7 sections (incl. reorder steps, Hot Work permit, upload), submits; requester denied approval; other contractor denied; AO approves from inbox; SO blocked until permit verified, then final-approves; requester views/prints, PDF downloaded, history + notifications + audit present; full revision path with v1 and comments retained.

## 4. Deployment

### Docker (single host)
```bash
cp .env.example .env     # set POSTGRES_PASSWORD, SESSION_SECRET (openssl rand -hex 32), APP_BASE_URL
docker compose up -d --build            # migrations run on start (MIGRATE_ON_START=true)
docker compose exec app node dist/db/seed.js   # base configuration, first run only
```
The `app` container serves the SPA and `/api/v1` on port 4000. Put it behind an HTTPS reverse proxy (nginx/Traefik/IIS ARR) — cookies are `Secure` and use the `__Host-` prefix in production. `TRUST_PROXY=1` makes rate limiting and audit IPs use the proxy's `X-Forwarded-For`.

> The Docker files were written for this release but could **not be built in the development sandbox** (no Docker daemon). The same steps were verified without Docker: `npm run build` for both apps, then `NODE_ENV=production node dist/server.js` with `SERVE_FRONTEND_DIR` served the SPA, API, Swagger UI and set the `__Host-` session cookie.

### Without Docker
```bash
cd frontend && npm ci && npm run build
cd ../backend && npm ci && npm run build
NODE_ENV=production DATABASE_URL=... SESSION_SECRET=... SERVE_FRONTEND_DIR=../frontend/dist \
  node dist/db/migrate.js && node dist/server.js        # run under systemd / PM2 / Windows service
```

### Backup & restore
* **Database** (all JSA data, versions, history, audit): `pg_dump -Fc -d jsa -f jsa_$(date +%F).dump`; restore with `pg_restore -d jsa_new --no-owner jsa_YYYY-MM-DD.dump`. Schedule daily dumps + WAL archiving / PITR for production; keep copies off-host and encrypted.
* **Attachments**: back up `STORAGE_DIR` (docker volume `storage`) together with the DB dump — `jsa_attachments.storage_key` and `sha256` reference the files; verify integrity after restore by comparing hashes.
* Test a restore quarterly; after restore run `GET /api/v1/audit-logs/verify` to confirm the audit chain.

## 5. Security & audit design

* **Authentication**: server-side sessions in `sessions` (only SHA-256 of the token stored), 60-min idle / 12-h absolute expiry, logout deletes the session, deactivation or password reset revokes all sessions. Argon2id (19 MiB, t=2). Lockout after 5 failures (15 min). Login rate limit per IP+identifier and per IP. Invitations and resets use hashed single-use tokens (72 h / 1 h). Forgot-password never reveals whether an account exists.
* **CSRF**: every state-changing request must send `X-CSRF-Token` matching the session's token; cookies are `SameSite=Lax`, `HttpOnly`, `Secure` in production.
* **Authorization**: route guards by role + service-layer record checks (`lib/authz.ts → jsaVisibility`, `canReviewStage`). Requesters see their own records; Area Owners see submitted JSAs in assigned areas; Safety Officers within site scope; Admin read-only system-wide (no approval rights). Records a user cannot see return **404** (no existence leak). Reviewers only ever see *submitted* versions.
* **Workflow integrity**: transitions run in transactions with `SELECT … FOR UPDATE` on the task and JSA, conditional task completion, partial unique indexes (one active instance, one pending task), version-id checks (stale actions rejected), self-approval blocked, SO stage requires an AO approval in the same instance.
* **Immutability (DB triggers)**: locked versions and their steps/hazards/controls/risks/permits cannot be updated or deleted; `approval_history`, `jsa_status_history`, `jsa_declarations`, `jsa_permit_verifications`, `audit_logs` are append-only (UPDATE/DELETE/TRUNCATE blocked); `jsas` rows can't be hard-deleted (soft delete only for never-submitted drafts).
* **Audit log tamper protection**: each entry stores `prev_hash` and `hash = SHA-256(prev_hash + canonical entry)`, written under an advisory lock in the same transaction as the change. `GET /api/v1/audit-logs/verify` (Admin UI → Audit log → *Verify audit chain*) recomputes the chain. Recommended for production: run the app with a DB role that has only INSERT/SELECT on `audit_logs`, keep the table owner separate, and ship logs/dumps to WORM or SIEM storage so even a DBA edit (which would have to disable triggers) is detectable. Audit metadata is scrubbed of password/token/hash/cookie fields. Access: Admin (all), Safety Officer (JSA events only).
* **Files**: extension allow-list + MIME by magic bytes (`file-type`), size limit, random storage keys, no public URL — downloads go through `/attachments/:id/download` after record- and version-level checks, `nosniff`, sandbox CSP, `Content-Disposition`.
* **Web**: Helmet CSP (`script-src 'self'`), frame-ancestors none, strict CORS allow-list, JSON body limit, parameterised SQL via Drizzle, React escaping, spreadsheet formula-injection neutralisation, consistent error envelope without stack traces.

## 6. Implemented features

* Login (email or username), logout, forgot/reset password, invitation activation, change password, TH/EN switcher remembered per user (DB) and per browser.
* Role-specific dashboard (10 DB-derived cards, my pending actions, high-risk, upcoming, expiring, recent, turnaround, monthly trend, department / job type / risk / reviewer charts).
* 7-section JSA form with progress, Save draft, Save & continue, Preview, Submit; server-generated reference on first save; unsaved-change guard; hazard & control libraries; add / copy / delete / reorder steps; multiple hazards per step; live risk preview with server-side scoring; permit / high-risk activity selection with configurable follow-up questions, permit references, evidence linking; uploads; declaration; pre-submission checklist mapped to server error codes; optimistic concurrency.
* My Submissions & Register: search, 10 filters, sort, pagination, CSV/XLSX export (scoped + logged), overdue reviewer highlighting.
* Approval Inbox (desktop table / mobile cards, waiting time, overdue flag), review panel with comments, confirmations, permit verification, sticky mobile actions.
* JSA detail: workflow stepper, validity banner, returned/rejected comments, change summary vs previous version, tabs (overview, steps, permits, documents, approval timeline + status history, versions), revision / discard revision / cancel / complete / copy-as-new / delete draft, print view, Thai/English **PDF** of the approved version (watermarked when not currently valid).
* Reports with date range presets and per-report CSV/XLSX export (trends, turnaround avg/median/max by stage, pending by role incl. overdue, department, contractor, area, job type, initial & residual risk, rejected/returned with comments, expired/expiring, completed).
* In-app notifications (11 types, TH/EN templates, unread badge, links to authorised records), expiry reminders & automatic expiry job.
* Administration: users & roles (invite links, initial password, activate/deactivate, self-lockout protection), contractor companies, departments, sites, areas, Area Owner & Safety Officer assignments (primary/backup, site scope), job types (default permits), hazard & control libraries, high-risk activity/permit types with follow-up questions, risk matrix versions (clone → edit draft → validate → activate), acceptance rules, validity & completion settings, notification templates, system & language settings, workflow view, audit log viewer with chain verification.
* OpenAPI 3 spec at `/api/openapi.json`, Swagger UI at `/api/docs`. Health endpoint `/api/health`.

## 7. Not implemented / limitations (stated plainly)

* **Email and Microsoft Teams notifications are not implemented.** Only in-app notifications are delivered. `services/notifications.ts` exposes a `NotificationChannel` interface (`registerChannel`) for adding them. Invitation and reset links are therefore shown to the administrator (Users → link icon) to deliver securely; in development the reset link is written to the server log.
* **No integration with a permit-to-work system.** Permit references are recorded as *manually referenced / awaiting verification* and become *verified* only when a Safety Officer ticks them at final approval.
* **Risk exception workflow** is not implemented: when residual risk exceeds the acceptance rule, final approval is blocked (configurable: block at submission and/or final approval).
* **Object storage (S3)** driver is not implemented; the `StorageDriver` interface has a private local-disk implementation only.
* Data retention/archival jobs are not implemented (records are never hard-deleted; define a retention policy before enabling any purge).
* Single-factor authentication only (no SSO/MFA). LDAP/Azure AD integration would be a future enhancement.
* Docker images were not built in the sandbox (see §4).

## 8. Outstanding company configuration (required before go-live)

1. **Risk matrix & acceptance rule** — the seeded 5×5 matrix, its thresholds (Low 1–4, Medium 5–9, High 10–16, Critical 17–25) and the "residual > 9 blocks final approval" rule are **provisional examples**, not company policy. The authorised Safety Administrator must edit (clone → draft), validate and activate the real matrix, then enable *Block final approval if risk matrix not validated* in System settings.
2. **High-risk activity requirements** — follow-up questions, which activities need a permit reference / evidence / SO verification, and guidance texts are placeholders; align with the factory's permit-to-work procedure and Thai legal requirements (e.g. confined space, height, electrical regulations) as interpreted by the company.
3. **Validity rules** — validity mode (end of job vs. fixed duration), max work period, reminder lead time, minimum lead time before start, completion tracking.
4. **Organisation data** — sites, areas, departments, contractor companies, job types, hazard/control libraries, Area Owner (primary + backup) and Safety Officer assignments.
5. **Declaration text** (TH/EN) and its version; notification template wording.
6. **Thai PDF font** — bundled TLWG Loma (GPL with font exception). To use a corporate font such as Sarabun, set `PDF_FONT_REGULAR` / `PDF_FONT_BOLD`.
7. Default language, timezone (default Asia/Bangkok), attachment size/types, overdue-review threshold.

## 9. Production readiness checklist

- [ ] HTTPS reverse proxy in front of the app; `COOKIE_SECURE=true`, `TRUST_PROXY` set correctly; HSTS at the proxy.
- [ ] Strong unique `SESSION_SECRET`, DB password; secrets in a vault / environment, never in the repo or frontend.
- [ ] `NODE_ENV=production` (refuses dev secrets and dev tokens); demo users never seeded; `EXPOSE_DEV_TOKENS=false`.
- [ ] Separate DB roles: app role with least privilege (no TRUNCATE/ALTER; INSERT/SELECT only on audit tables); owner role for migrations.
- [ ] Risk matrix, acceptance rules, permit types and validity rules configured **and validated** by the Safety Administrator (§8); enforcement setting enabled.
- [ ] Real users invited; Area Owner backups and Safety Officer scopes configured for every area/site (submission fails with *No Area Owner* otherwise).
- [ ] Email/Teams channel implemented or an agreed manual process for invitation/reset links.
- [ ] Automated daily DB + storage backups, off-site; restore test performed; audit chain verified after restore.
- [ ] Log shipping (Pino JSON → SIEM), uptime monitoring on `/api/health`, disk-space alerts for storage.
- [ ] Antivirus scanning of uploads if required by IT policy (hook into `services/attachments.ts`).
- [ ] Run `npm test` (backend & frontend) and Playwright E2E against staging; UAT with Requesters, Area Owners and Safety Officers in Thai on shop-floor tablets.
- [ ] Data retention & archival policy approved; PDPA notice for personal data (names, phone numbers) of employees and contractors.
- [ ] Penetration test / security review before exposure beyond the factory network.

## 10. API

Versioned REST under `/api/v1` — full spec in `backend/src/openapi.ts` (served at `/api/openapi.json`, UI at `/api/docs`). Error envelope: `{ "error": { "code", "message", "details", "requestId" } }`; codes are stable and translated by the UI. Main groups: `auth/*`, `lookups`, `jsas` (+ `/submit`, `/revisions`, `/cancel`, `/complete`, `/copy`, `/attachments`, `/pdf`, `/export`), `attachments/:id`, `approvals/inbox`, `approvals/tasks/:id/{approve|return|reject}`, `approvals/history/:jsaId`, `notifications`, `reports/{dashboard|summary|export}`, `audit-logs`, `admin/*`.

ER diagram: [docs/ERD.md](docs/ERD.md).

## 11. GitHub

This folder is a ready Git repository (branch `main`). `node_modules`, build output, uploaded files, `.env` and database dumps are excluded by `.gitignore`; only `.env.example` files with placeholder values are committed.

```bash
git remote add origin https://github.com/<org>/jsa-app.git
git push -u origin main
```

`.github/workflows/ci.yml` runs on every push and pull request: backend typecheck + 59 tests against a throwaway PostgreSQL service + build, and frontend typecheck + tests + build. GitHub stores the code and runs CI; it does not host the running app (it needs Node.js and PostgreSQL) — deploy with Docker or Node on a server (§4). Use a **private** repository.
