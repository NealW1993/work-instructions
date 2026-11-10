# Work Instructions Platform

Internal work-instructions software built with React (Next.js), TypeScript, Supabase Postgres + RLS, Tailwind CSS, PostHog, SMTP email, and Docker.

## What this app includes

- Role levels:
  - `system_admin`: full access. Only system admins create and change user accounts and roles, and manage the AI provider key.
  - `admin`: create, edit and approve instructions and controlled documents, view KPIs, manage departments and review settings, and export records. Admins cannot list, create or change user accounts.
  - `user` (shown as "Contributor"): view and search permitted released instructions, submit new instructions and documents for review, and edit their own unreleased instructions
- Authentication:
  - Email + password login (Supabase Auth passwords are hashed by Supabase)
  - Employee ID + 6-digit PIN login (`employee_id` must be numeric, 1-6 digits)
  - Sign-in help requests from the login page; administrators reset PINs in User Admin
- Work instruction data model:
  - Search by `Part Number` or `Mold Number`
  - Each part/mold work item can have multiple instructions
  - Each work item/instruction is assigned to a department
  - Dashboard department filter + department instruction counts
  - Markdown editor with toolbar and live preview: steps, checklists, safety callouts (CAUTION/WARNING/NOTE…), tables and charts (see [docs/EDITOR.md](./docs/EDITOR.md))
  - Inline image/video inserts upload to Supabase Storage bucket `instruction-media` (tablet camera compatible)
- Plant-floor homepage + KPI layer (see [docs/HOMEPAGE.md](./docs/HOMEPAGE.md)):
  - Large search with scan-to-open (a single match opens on Enter), department chips, role-based quick actions
  - Pinned, recently changed, new and needs-review lists with large touch targets
  - Dashboard Studio controls (layout presets, widget library, KPI widget library, save/discard/default actions)
  - KPI widgets support responsive compact/standard/wide/full layouts
  - KPI drill-down modals include total events summaries and card titles
  - Layout customization supports drag/reorder and auto-scroll behavior
- Security:
  - Full Postgres schema + RLS + role policies
  - Storage policies for media bucket
  - PIN sign-in lockout, rate limits and guessable-PIN rejection (see [PIN login design](#pin-login-design))
  - AI provider keys (Claude, OpenAI, Grok or Gemini) stored encrypted and managed only by system admins who re-enter their PIN (see [AI provider key](#ai-provider-key))
  - Profiles, PIN hashes and formulas cannot be written directly from the browser; changes go through role-checked server routes and database functions
- UX:
  - Responsive mobile/tablet-friendly UI
  - Dark/light mode toggle
  - Modern visual style
- Analytics:
  - PostHog client integration (optional, env-driven)
- Data portability:
  - Admin/System Admin `Export Data` page with format + dataset selection
  - Export formats: `CSV`, `TSV`, `JSON`
  - `Export All` supported from one action
- Printing:
  - Instruction page Parameters menu includes a `Print` action for all users
  - Print view is clean and focused: title, revision, tool list, and work instructions
- Deployment:
  - Local dev and Docker compose
  - Mailpit SMTP for local email testing
  - Ready for Synology Docker deployment

## Tech stack

- Next.js (React) + TypeScript
- Tailwind CSS
- Supabase Auth + Supabase Postgres + Supabase Storage
- PostHog (`posthog-js`)
- Nodemailer SMTP
- Mailpit (local SMTP + inbox UI)
- Docker / Docker Compose

## Project structure

- `src/app/(auth)/...`: login and password reset pages
- `src/app/(app)/...`: authenticated app pages (dashboard, instructions, admin)
- `src/app/(app)/admin/export/page.tsx`: admin export UI
- `src/app/(app)/instructions/[id]/print/page.tsx`: print-friendly instruction view
- `src/app/api/...`: server API routes for PIN auth and user admin
- `src/app/api/admin/export-data/route.ts`: role-protected export generation route
- `src/components/...`: UI components
- `src/lib/...`: Supabase clients, auth helpers, env, mailer
- `supabase/migrations/202602210001_init.sql`: initial base schema; later migrations are also required
- `supabase/migrations/`: ordered schema upgrades, including controlled saves, retained revisions and media upload policies
- `supabase/seeds/001_promote_system_admin.sql`: manual system-admin promotion helper
- `supabase/migrations/202602210007_employee_id_login_requirements.sql`: employee ID constraints + PIN lookup updates
- `supabase/seeds/002_backfill_employee_ids.sql`: helper seed to assign employee IDs to existing users
- `supabase/migrations/202602230009_departments_and_work_item_assignment.sql`: departments table + work item department assignment
- `supabase/seeds/003_departments.sql`: helper seed to add baseline departments
- `docker-compose.yml`: app + Mailpit local stack

## Prerequisites

- Node.js 24 LTS (the Docker build uses Node 24)
- npm 10+
- Supabase CLI (`npx supabase`)
- Docker Desktop (for containerized run)

## 1) Configure environment

Copy `.env.example` to `.env` and fill values:

```bash
cp .env.example .env
```

Required values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Recommended:

- `SUPABASE_URL_INTERNAL` when the server must use a private/container address for the same Supabase backend
- `SYSTEM_ADMIN_EMAIL=you@company.com` to identify a trusted, provisioned first administrator
- `SMTP_HOST=mailpit` and `SMTP_PORT=1025` for local email testing in Docker
- `NEXT_PUBLIC_POSTHOG_KEY` if analytics is desired
- `AI_KEY_ENCRYPTION_KEY` so a system admin can save an AI provider key in the app. Generate it once with `openssl rand -base64 32`, keep it secret and back it up (see [AI provider key](#ai-provider-key))
- `OPENAI_API_KEY` (optional) is used for AI features only until a key is saved in the app
- `OPENAI_ENHANCE_MODEL`, `OPENAI_SEARCH_MODEL` and `OPENAI_DIAGRAM_MODEL` (optional) choose models for `OPENAI_API_KEY`; a key saved in the app uses the model chosen with it

For `npm run dev` outside Docker, use an SMTP host reachable from the host OS, such as `127.0.0.1` for a published Mailpit port. `mailpit` is the service name within the Docker Compose network. For production HTTPS and backend addressing, follow [Synology deployment](./docs/SYNOLOGY_DEPLOYMENT.md).

See [Structured instruction editor](./docs/EDITOR.md) for block formatting, Markdown files, charts and AI suggestions.

## Process documentation controls

The `/process-documents` area is the controlled-document workspace for ISO-style QMS documentation.

- Create process maps, procedures, work instructions, quality records, and controlled forms from built-in templates.
- Import `.docx`, `.html`, `.htm`, `.txt`, and `.md` files into sanitized rich text while keeping source-file metadata on the revision.
- Route documents through Draft, In Review, Approved, and Obsolete states. Approval stamps the approver, effective date, and next review date.
- Each controlled revision requires a change summary, stores approval evidence, and writes append-only audit events.
- Work instructions and process documents are retained through archive/obsolete states; permanent deletion is blocked for audit evidence.
- Dashboard search uses the configured AI provider when the system-admin Dashboard AI Search setting is enabled; otherwise it still searches all work instructions and process documents with deterministic controlled-text ranking.
- `/process-maps` provides process maps, flowcharts, SIPOC, CTQ trees, fishbone, Pareto, histograms, run/control/scatter charts, FMEA, control plans, and solution matrices with AI or rules-based chart recommendations by DMAIC phase. The builder includes editable layers, print/export actions, CSV/SVG/report downloads, and Six Sigma formulas such as Cp, Cpu, Cpl, Cpk, DPMO, takt time, and control limits.
- Admin KPI panels include per-user AI/tool usage, token counts, dashboard search counts, chart exports, Cp/Cpk use, imports, templates, and controlled-document activity.
- System-admin exports include process documents, revisions, audit events, document search events, and AI/tool usage events for audit packages.

## 2) Start local Supabase backend in Docker (recommended for local)

```bash
npm run supabase:start
```

Local endpoints:

- API: `http://127.0.0.1:56321`
- DB: `postgresql://postgres:postgres@127.0.0.1:56322/postgres`
- Studio: `http://127.0.0.1:56323`

For a new, disposable local database only, reset applies all migrations and configured seeds. This command deletes existing local database records:

```bash
npm run supabase:reset
```

Local reset seeds are configured in `supabase/config.toml` and include:

- `supabase/seeds/001_promote_system_admin.sql`
- `supabase/seeds/003_departments.sql`

## 3) Set up or upgrade the target Supabase database

For a fresh database, apply every migration in filename order using your Supabase migration workflow. For an existing database, back it up with its storage objects, confirm its migration history and apply only pending migrations. Follow the [coordinated upgrade sequence](./docs/SYNOLOGY_DEPLOYMENT.md#upgrade-sequence) when replacing an existing application.

After migrations, customize the intended first-admin email before running `supabase/seeds/001_promote_system_admin.sql`, following the account provisioning instructions below. Existing installations may also need `002_backfill_employee_ids.sql` after reviewing its assignments. Customize `003_departments.sql` when seeding department names. Seeds are setup helpers, not upgrade migrations; do not replay them blindly on an existing database.

The migration set provides:

- Tables: `profiles`, `user_security`, `departments`, `work_items`, `work_instructions`, `instruction_media`, `password_reset_tokens`, `process_documents`, `process_document_revisions`, `process_document_audit_events`, `document_search_events`, `system_settings`, `ai_usage_events`
- Enum roles and media types
- Triggers for profile creation from `auth.users`
- PIN helpers: `set_my_pin`, `set_user_pin`, `verify_pin_login`
- RLS policies by role
- Storage bucket: `instruction-media` + storage RLS policies

### Controlled writes and migration troubleshooting

Apply only pending migrations according to the target database's migration history. The initial schema alone is insufficient. The controlled document, instruction, import, upload, access-hardening and AI provider migrations through `202611090001_ai_provider_settings.sql` are required by this application version.

Instruction saves use `save_work_instruction_controlled`; document saves use `save_process_document_controlled`. Approval, archive, restore, merge and import operations use their corresponding controlled RPCs. These transactions enforce revision checks, permissions, retained evidence and audit events. Direct browser mutations of controlled instruction records and tool links are intentionally revoked.

If an operation fails after an upgrade, check the pending migration list, RPC availability and application version together. Do not restore historical write policies, grant browser roles direct write access or replay individual older migrations as an Advisor fix. Test any new Advisor remediation as a new migration against the complete current schema.

## 4) Local development run

```bash
npm ci
npm run dev
```

App URL: `http://localhost:3000`

## 5) Docker + Mailpit local run

```bash
docker compose up --build
```

- App: `http://localhost:3000`
- Mailpit web inbox: `http://localhost:8025`
- SMTP: `mailpit:1025` inside Docker network

## First account / system admin

Provision the first administrator through the trusted Supabase administration console, with a confirmed email and a numeric 1–6 digit Employee ID. Then run `supabase/seeds/001_promote_system_admin.sql` after setting the intended email in that file.

`SYSTEM_ADMIN_EMAIL` identifies this trusted account for the bootstrap endpoint. Public registration cannot claim the configured administrator email, and all public registrations receive the `user` role. Existing administrators can create subsequent accounts from User Admin. This prevents someone from obtaining administrator access by typing an unverified email address into registration.

## User management flow

Only `system_admin` can create and change accounts, in **User Management** on the System Administration page:

- Create users (with role, employee ID, password, and PIN)
- Change role (`user`, `admin`, `system_admin`)
- Update employee ID
- Reset user PIN (this also clears a sign-in lockout)
- Change the automatic sign-out time
- Deactivate or reactivate accounts (deactivated users are signed out and cannot sign in)
- Delete users (cannot delete own account or last system admin)

`admin` and `system_admin` can both use the same page to add, rename, reorder and delete departments, set the instruction review window, open quality metrics and export records. Admins don't see the user list, and the server refuses every account request from them. The rule lives in `canManageAccounts` in `src/lib/user-management.ts`.

## Instruction authoring flow

`admin` and `system_admin` can:

- Create instructions
- Edit instructions
- Assign department on create/edit/fork
- Upload image/video media
- Capture from tablet camera (file input uses `capture="environment"`)

`user` can:

- Search by part number or mold number
- View all permitted instructions and media
- Create instructions, upload/capture media, and edit their own unreleased instructions for review

Saving a successor revision preserves the current approved release. Approval requires an authorized reviewer. See [change and control review](./docs/CHANGE_REVIEW.md) for the retained revision and evidence controls.

## Sign-in help

The self-service password and PIN recovery tools were removed. On the login page, **Help** emails the administrators a request (limited to 5 per hour per device). A system admin can then reset the user's PIN in User Management, which also clears a sign-in lockout.

## PIN login design

PIN login endpoint verifies hashed PIN against `user_security.pin_hash` using Employee ID as the login identifier, then issues a Supabase magic-link token hash through admin API. Client verifies OTP and receives normal Supabase session.

Employee IDs are unique in `profiles.employee_id` and constrained to numeric `1-6` digits.

Sign-in protections (migration `202611080001_access_hardening.sql`):

- Only the server can check a PIN. Browsers cannot call `verify_pin_login` or read PIN hashes.
- Ten wrong PINs in a row lock that Employee ID for 1 minute, even for the correct PIN. The count starts again after the minute, after a successful sign-in, or after 15 minutes without a failed attempt. Unknown IDs are counted and answered the same way, so the response never reveals whether an ID exists. A system admin's PIN reset clears the lock immediately.
- One device (network address) that fails 20 times within a minute, across any IDs, is paused for up to a minute. This count is kept in the app server's memory, so a restart resets it but not the per-ID lock.
- New PINs must not be guessable (repeated or sequential digits and common patterns). PINs no longer have to be unique, so setting one never reveals that someone else already uses it.
- Changing your own PIN requires your current PIN; ten wrong guesses in a row pause PIN changes for 1 minute.
- Self-registration always creates an operator (`user`) account and is limited to 10 per address per hour. Feedback and help requests are limited to 5 per hour.

## AI provider key

System admins choose the AI provider for writing help, search ranking and chart suggestions under **AI provider** on the System Administration page. The choices are Claude (Anthropic), ChatGPT (OpenAI), Grok (xAI) and Gemini (Google), with any model the provider account offers.

How the key is protected (migration `202611090001_ai_provider_settings.sql`):

- **Encrypted at rest.** The key is encrypted with AES-256-GCM before it is stored, with a fresh nonce on every save, and the stored value only opens for the provider it was saved for. The encryption key is `AI_KEY_ENCRYPTION_KEY` in the server environment and is never stored in the database, so database access or a backup alone cannot reveal the API key.
- **Server-only.** No browser session can read or write the key table or its activity log, whatever its role. The server decrypts the key only at the moment it sends a request.
- **System admins only, with their PIN.** Only system admins see the section. Saving, viewing or removing the key requires re-entering their own PIN, and wrong PINs count toward the sign-in lockout.
- **Never exposed.** Status responses show only the last four characters, and the key is never written to logs. A viewed key stays on screen for 30 seconds (less if the tab is hidden), and responses are marked not to be cached.
- **Sent only to the provider.** Each provider's official API address is fixed in the code.
- **Checked before saving.** By default the key is tested with the provider first, so a mistyped key is never stored.
- **Recorded permanently.** Every save, model change, view, test, removal and wrong PIN is logged with who and when. Not even the server can change or delete these records.

To set it up:

1. Generate the encryption key once: `openssl rand -base64 32`.
2. Add it to the server environment as `AI_KEY_ENCRYPTION_KEY` and restart the app.
3. Add the API key in System Administration.

Back up the encryption key separately from database backups. If it is lost or changed, the saved API key can't be decrypted: AI features stay off until a system admin enters the key again. Until a key is saved in the app, the server's `OPENAI_API_KEY` (if set) is used.

## PostHog

Set:

- `NEXT_PUBLIC_POSTHOG_KEY` = your PostHog **Project token** (`phc_...`)
- `NEXT_PUBLIC_POSTHOG_HOST` = `https://us.i.posthog.com` (US Cloud) or `https://eu.i.posthog.com` (EU Cloud)

If key is empty, PostHog is disabled automatically.

What this app sends:

- `$pageview` on route changes
- `autocapture` browser interaction events
- identified user profile on authenticated pages (`email`, `full_name`, `role`)

Quick verification checklist:

1. Start app and sign in.
2. Open a few pages (`/dashboard`, `/instructions/new`, etc.).
3. In PostHog, open **Product analytics -> Events** and filter for `$pageview`.
4. In dashboard insights, choose event `$pageview` (or `All events`) and a recent time window.
5. If you changed PostHog public environment values, restart the development server or rebuild and redeploy the production image so the browser bundle includes them.

## Scripts

- `npm run dev` - start dev server
- `npm run build` - production build
- `npm run start` - run production server
- `npm run lint` - lint code
- `npm run typecheck` - TypeScript checks
- `npm test` / `npm run test:unit` - navigation, pagination, manufacturing calculation, formula security, export-format, Markdown editor, homepage layout and AI key encryption regressions
- `npm run test:e2e` - isolated fixture-backed browser checks; install Chromium first with `npx playwright install chromium`
- `npm run test:sql` - SQL regression checks in a disposable schema clone of the running local Supabase database
- `npm run test:integration` - real-backend workflows (create, edit, approve, archive/restore, documents, homepage) against a disposable local Supabase stack; see [docs/VALIDATION.md](./docs/VALIDATION.md)
- `npm run docker:build` - build Docker image
- `npm run docker:run` - run Docker compose stack
- `npm run supabase:start` - start local Supabase backend (Docker)
- `npm run supabase:stop` - stop local Supabase backend
- `npm run supabase:status` - show local Supabase endpoints and keys
- `npm run supabase:reset` - recreate DB, apply migrations, run seeds

The browser tests use a local fixture backend and do not write to the configured Supabase project. `npm run test:sql` requires Docker and the running local `supabase_db_work-instructions` container. It creates a database from a schema-only dump, applies the control migrations and regression fixtures, then removes its own test database. It does not migrate or reset the application database. Set `SQL_TEST_CONTAINER` only to another intended local test backend container.

Spreadsheet imports use SheetJS 0.20.3 from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), since the npm registry's legacy `xlsx` package is no longer current. The package lock records the downloaded tarball's integrity. Runtime and dependency updates should be verified with `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`, `npm run test:integration`, and `npm run build`.

## Deploy to Synology (Docker)

Follow [Synology deployment and tablet media](./docs/SYNOLOGY_DEPLOYMENT.md) for environment values, database migrations, HTTPS reverse proxy, resumable uploads and coordinated upgrades. Build the image with its final `NEXT_PUBLIC_*` values. Set private server credentials at runtime, use production SMTP, and serve the app through its trusted HTTPS hostname.

## Mobile/tablet testing

- Open the app on the tablet through its final trusted HTTPS hostname, also configured in `NEXT_PUBLIC_APP_URL` and Supabase Auth redirects.
- Use **Take photo** and **Record video**, allow the device's camera permissions, and confirm the completed media appears before saving.
- Play and seek the recorded video, then repeat on a large-screen workstation. The deployment guide includes real-device, codec and interrupted-upload acceptance checks.

## Security notes

- Passwords are managed and hashed by Supabase Auth
- PINs are stored as bcrypt hashes in `user_security.pin_hash`
- RLS enforces role-based access at DB level
- Browsers cannot insert, update or delete `profiles`, read `user_security`, or write `process_map_formulas`; those changes go through role-checked API routes
- Service role key is only used server-side in API routes
- Never expose `SUPABASE_SERVICE_ROLE_KEY` client-side
- AI provider keys are stored encrypted with `AI_KEY_ENCRYPTION_KEY`, which stays in the server environment; keep it out of `NEXT_PUBLIC_*` variables, Docker build arguments and database backups

## Troubleshooting

- `missing_profile` on login:
  - migration not applied or trigger missing
- Notification or help emails not appearing:
  - check Mailpit at `http://localhost:8025`
  - verify SMTP env values
- Cannot upload media:
  - verify pending migrations, storage global/bucket limits, HTTPS/backend addressing and reverse-proxy upload headers using the deployment guide
- Role update denied:
  - only a `system_admin` can create or change accounts and roles
- "Too many failed sign-in attempts":
  - wait a minute, or have a system admin reset that user's PIN, which clears the lock
- AI provider section says keys can't be saved:
  - set `AI_KEY_ENCRYPTION_KEY` (32 bytes, for example from `openssl rand -base64 32`) in the server environment and restart the app
- AI provider section says the saved key can't be decrypted:
  - `AI_KEY_ENCRYPTION_KEY` changed since the key was saved; restore the old value or enter the API key again
- `supabase_vector_*` container keeps restarting:
  - root cause is Docker API on `host.docker.internal:2375` not exposed
  - this repo disables local Supabase analytics by default in `supabase/config.toml` (`[analytics].enabled = false`)
  - if you want Supabase analytics enabled, turn on Docker Desktop setting: `Expose daemon on tcp://localhost:2375 without TLS`, then restart Supabase

## Notes

- This app expects Supabase project-level auth settings suitable for internal use.
- Document controls include retained revision and audit evidence. Configure organization-specific retention, backups, network restrictions and identity policies for the intended deployment.
