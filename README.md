# Work Instructions Platform

Internal work-instructions software built with React (Next.js), TypeScript, Supabase Postgres + RLS, Tailwind CSS, PostHog, SMTP email, and Docker.

## What this app includes

- Role levels:
  - `system_admin`: full access + user management
  - `admin`: create/edit instructions
  - `user`: view/search instructions
- Authentication:
  - Email + password login (Supabase Auth passwords are hashed by Supabase)
  - Employee ID + 6-digit PIN login (`employee_id` must be numeric, 1-6 digits)
  - Password recovery tools inside Password tab (email reset link and PIN-based temporary password)
- Work instruction data model:
  - Search by `Part Number` or `Mold Number`
  - Each part/mold work item can have multiple instructions
  - Each work item/instruction is assigned to a department
  - Dashboard department filter + department instruction counts
  - Markdown steps + markdown notes
  - Inline image/video inserts upload to Supabase Storage bucket `instruction-media` (tablet camera compatible)
- Dashboard Studio + KPI layer:
  - Header-driven Dashboard Studio controls (layout presets, widget library, KPI widget library, save/discard/default actions)
  - KPI widgets support responsive compact/standard/wide/full layouts
  - KPI drill-down modals include total events summaries and card titles
  - Layout customization supports drag/reorder and auto-scroll behavior
- Security:
  - Full Postgres schema + RLS + role policies
  - Storage policies for media bucket
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
- `supabase/migrations/202602210001_init.sql`: full database schema + RLS + policies
- `supabase/seeds/001_promote_system_admin.sql`: manual system-admin promotion helper
- `supabase/migrations/202602210007_employee_id_login_requirements.sql`: employee ID constraints + PIN lookup updates
- `supabase/seeds/002_backfill_employee_ids.sql`: helper seed to assign employee IDs to existing users
- `supabase/migrations/202602230009_departments_and_work_item_assignment.sql`: departments table + work item department assignment
- `supabase/seeds/003_departments.sql`: helper seed to add baseline departments
- `docker-compose.yml`: app + Mailpit local stack

## Prerequisites

- Node.js 20+
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

- `SYSTEM_ADMIN_EMAIL=you@company.com` for automatic first system-admin bootstrap
- `SMTP_HOST=mailpit` and `SMTP_PORT=1025` for local email testing in Docker
- `NEXT_PUBLIC_POSTHOG_KEY` if analytics is desired
- `OPENAI_API_KEY` to enable AI instruction enhancement in the editor
- `OPENAI_ENHANCE_MODEL=gpt-4.1-mini` (optional override)

## 2) Start local Supabase backend in Docker (recommended for local)

```bash
npm run supabase:start
```

Local endpoints:

- API: `http://127.0.0.1:56321`
- DB: `postgresql://postgres:postgres@127.0.0.1:56322/postgres`
- Studio: `http://127.0.0.1:56323`

Reset DB + apply migration + run seed:

```bash
npm run supabase:reset
```

Local reset seeds are configured in `supabase/config.toml` and include:
- `supabase/seeds/001_promote_system_admin.sql`
- `supabase/seeds/003_departments.sql`

## 3) Apply Supabase schema + policies to hosted Supabase (optional)

Run SQL in Supabase SQL Editor:

1. Execute migrations in order from `supabase/migrations/`
2. Optional: run `supabase/seeds/001_promote_system_admin.sql` after replacing email
3. Optional: run `supabase/seeds/002_backfill_employee_ids.sql` after replacing values
4. Optional: run `supabase/seeds/003_departments.sql` after customizing department names

What this migration creates:

- Tables: `profiles`, `user_security`, `departments`, `work_items`, `work_instructions`, `instruction_media`, `password_reset_tokens`
- Enum roles and media types
- Triggers for profile creation from `auth.users`
- PIN helpers: `set_my_pin`, `set_user_pin`, `verify_pin_login`
- RLS policies by role
- Storage bucket: `instruction-media` + storage RLS policies

### Security/Performance Advisor hotfix query

If Supabase Advisor reports:
- `Function public.set_updated_at has a role mutable search_path`
- RLS policy performance warnings on `profiles`, `work_items`, `work_instructions`, `instruction_media`

Run the SQL in:
- `supabase/migrations/202602210002_advisor_fixes.sql`
- `supabase/migrations/202602210003_pin_crypto_and_pin_only_login.sql` if you see `function gen_salt(unknown) does not exist` during signup/PIN login

Copy/paste query:

```sql
begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id or (select public.is_system_admin()))
with check ((select auth.uid()) = id or (select public.is_system_admin()));

drop policy if exists work_items_insert_editors on public.work_items;
create policy work_items_insert_editors
on public.work_items
for insert
to authenticated
with check ((select public.is_editor()) and created_by = (select auth.uid()));

drop policy if exists work_items_update_editors on public.work_items;
create policy work_items_update_editors
on public.work_items
for update
to authenticated
using ((select public.is_editor()))
with check ((select public.is_editor()));

drop policy if exists work_items_delete_editors on public.work_items;
create policy work_items_delete_editors
on public.work_items
for delete
to authenticated
using ((select public.is_editor()));

drop policy if exists work_instructions_insert_editors on public.work_instructions;
create policy work_instructions_insert_editors
on public.work_instructions
for insert
to authenticated
with check (
  (select public.is_editor())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists work_instructions_update_editors on public.work_instructions;
create policy work_instructions_update_editors
on public.work_instructions
for update
to authenticated
using ((select public.is_editor()))
with check ((select public.is_editor()));

drop policy if exists work_instructions_delete_editors on public.work_instructions;
create policy work_instructions_delete_editors
on public.work_instructions
for delete
to authenticated
using ((select public.is_editor()));

drop policy if exists instruction_media_insert_editors on public.instruction_media;
create policy instruction_media_insert_editors
on public.instruction_media
for insert
to authenticated
with check ((select public.is_editor()) and created_by = (select auth.uid()));

drop policy if exists instruction_media_update_editors on public.instruction_media;
create policy instruction_media_update_editors
on public.instruction_media
for update
to authenticated
using ((select public.is_editor()))
with check ((select public.is_editor()));

drop policy if exists instruction_media_delete_editors on public.instruction_media;
create policy instruction_media_delete_editors
on public.instruction_media
for delete
to authenticated
using ((select public.is_editor()));

commit;
```

## 4) Local development run

```bash
npm install
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

Two options:

1. Auto-bootstrap option (recommended):
   - Set `SYSTEM_ADMIN_EMAIL` in `.env`
   - Create account from login page with that email and a numeric 1-6 digit Employee ID
   - If no existing system admin exists, account is promoted automatically

2. Manual SQL promotion:
   - Run `supabase/seeds/001_promote_system_admin.sql` after updating email

## User management flow

`system_admin` can open **User Admin** page to:

- Add, rename, and delete departments
- Create users (with role, employee ID, password, and PIN)
- Change role (`user`, `admin`, `system_admin`)
- Update employee ID
- Reset user PIN
- Delete users (cannot delete own account or last system admin)

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

## Password recovery

- From Password tab -> **Forgot password?**:
  - Send reset link by email
  - Or enter email + PIN to generate a temporary password (masked until revealed)

## PIN login design

PIN login endpoint verifies hashed PIN against `user_security.pin_hash` using Employee ID as the login identifier, then issues a Supabase magic-link token hash through admin API. Client verifies OTP and receives normal Supabase session.

Employee IDs are unique in `profiles.employee_id` and constrained to numeric `1-6` digits.

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
5. If you changed PostHog env vars, restart the Next.js server so client-side env values refresh.

## Scripts

- `npm run dev` - start dev server
- `npm run build` - production build
- `npm run start` - run production server
- `npm run lint` - lint code
- `npm run typecheck` - TypeScript checks
- `npm run docker:build` - build Docker image
- `npm run docker:run` - run Docker compose stack
- `npm run supabase:start` - start local Supabase backend (Docker)
- `npm run supabase:stop` - stop local Supabase backend
- `npm run supabase:status` - show local Supabase endpoints and keys
- `npm run supabase:reset` - recreate DB, apply migrations, run seeds

## Deploy to Synology (Docker)

1. Copy repo to Synology or push image to your registry.
2. Put production `.env` on Synology.
3. Run docker compose stack:
   - `docker compose up -d --build`
4. Expose container port `3000` through reverse proxy or local network.
5. Ensure `NEXT_PUBLIC_APP_URL` points to the final accessible URL.

## Mobile/tablet testing

- Open app on tablet browser using local network IP (example: `http://192.168.1.50:3000`)
- Ensure same value is used in `NEXT_PUBLIC_APP_URL`
- Use instruction editor media upload input to capture photos/videos from camera

## Security notes

- Passwords are managed and hashed by Supabase Auth
- PINs are stored as bcrypt hashes in `user_security.pin_hash`
- RLS enforces role-based access at DB level
- Service role key is only used server-side in API routes
- Never expose `SUPABASE_SERVICE_ROLE_KEY` client-side

## Troubleshooting

- `missing_profile` on login:
  - migration not applied or trigger missing
- Email reset not appearing:
  - check Mailpit at `http://localhost:8025`
  - verify SMTP env values
- Cannot upload media:
  - verify storage bucket and policies from migration
- Role update denied:
  - ensure logged in user has `system_admin`
- `supabase_vector_*` container keeps restarting:
  - root cause is Docker API on `host.docker.internal:2375` not exposed
  - this repo disables local Supabase analytics by default in `supabase/config.toml` (`[analytics].enabled = false`)
  - if you want Supabase analytics enabled, turn on Docker Desktop setting: `Expose daemon on tcp://localhost:2375 without TLS`, then restart Supabase

## Notes

- This app expects Supabase project-level auth settings suitable for internal use.
- For stricter enterprise controls, add rate limiting, audit trails, IP restrictions, and SSO.
