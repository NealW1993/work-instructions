# Synology deployment and tablet media

Use Node.js 24 LTS (the Dockerfile uses `node:24-alpine`). Build the application with its final public environment values; `NEXT_PUBLIC_*` values are embedded in the browser bundle.

## HTTPS and the backend

Create a DSM reverse-proxy rule for your application hostname, such as `https://instructions.example.com:443`, pointing to the app container's HTTP port 3000. Assign a certificate trusted by the tablets. Preserve the public `Host` and set `X-Forwarded-Proto: https` at the trusted reverse proxy. Keep database credentials and the service-role key server-side.

For hosted Supabase, set the public endpoint and keys for that project:

```dotenv
NEXT_PUBLIC_APP_URL=https://instructions.example.com
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-key
```

For self-hosted Supabase reachable only on the private network, point both URLs at that backend, for example:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://supabase-gateway:8000
SUPABASE_URL_INTERNAL=http://supabase-gateway:8000
```

Use the anon and service-role keys from that same backend. `SUPABASE_URL_INTERNAL` is an optional server-side override for the same Supabase project, not a second database. It must be reachable from the app container. Use an actual Docker service hostname or the NAS's reachable private address; `localhost` inside the app container identifies that container. Private/local URLs and HTTP backends on an HTTPS page are routed through the app's same-origin `/api/backend` gateway for browser requests. Configure Supabase Auth's site URL and redirect allowlist for the final HTTPS application URL.

Keep `SUPABASE_SERVICE_ROLE_KEY`, `AI_KEY_ENCRYPTION_KEY`, `OPENAI_API_KEY` and SMTP credentials in the runtime environment; never put them in `NEXT_PUBLIC_*` variables or Docker build arguments. Configure a production SMTP service instead of the local Mailpit inbox. Changes to public variables require an image rebuild; changes to runtime values require restarting/recreating the app container.

Allow storage `POST`, `PATCH`, `HEAD` and `OPTIONS` requests through the reverse proxy. Preserve TUS upload headers (`Upload-*`, `Tus-*`, `Location`) and video `Range`, `Content-Range` and `Accept-Ranges` headers. Do not cache authenticated application/API responses at the reverse proxy.

## Photos and videos

The instruction editor provides separate **Take photo**, **Record video**, and existing-file upload controls. Capture requests the rear camera on supporting tablets. Device permissions and native camera behavior are controlled by the browser and operating system. Open the app directly on its HTTPS hostname for device acceptance testing.

Images support JPEG, PNG, WebP, GIF and AVIF up to 20 MiB. HEIC files require export as JPEG; use the capture action or the device's compatible camera format. Videos support MP4, MOV and WebM up to 1 GiB. MP4 encoded with H.264/AAC is recommended when instructions must play across iPads and Windows/Android devices. Accepting a container does not transcode its codec.

Uploads above 6 MiB use resumable TUS transfers with 6 MiB chunks, progress and retry. Allow at least 8 MiB per request at the reverse proxy for media, with enough request/read timeout for a chunk on the slowest supported Wi-Fi connection. To support full-size document imports, allow at least 32 MiB for application/API requests: the 15 MiB source limit can become about 20 MiB after base64 encoding, before the content and JSON fields are included. A 1 GiB video is transferred as chunks; the browser does not send a 1 GiB request. The editor prevents submission until its upload completes and provides cancellation.

Apply the media upload migration, and configure the **global** Supabase Storage limit as well as the bucket limit. The repository's local `[storage].file_size_limit` is `1GiB`; an existing hosted or self-hosted Storage service needs its equivalent runtime limit configured and restarted separately. The migration sets the bucket's 1 GiB limit and allowed MIME types. Ordinary active contributors can upload their own media; existing objects cannot be overwritten through the browser.

## Upgrade sequence

1. Back up the database and storage objects together. Confirm the current migration history.
2. Test against a restored staging instance. Apply only pending migrations in filename order, including `202611070001_document_control.sql` through `202611090001_ai_provider_settings.sql`. Fresh databases require the complete earlier migration set as well. Configure the global Storage limit separately.
3. Build the new container with the final public environment values. During a maintenance window, stop application writes, apply the tested pending migrations and replace the app container together. The new application requires the new RPCs; the old application uses write paths that are intentionally restricted by the new schema. Do not restore browser write grants or replay old policy hotfixes to make an old container work.
4. Validate login, approved-versus-working revision visibility, an instruction submission/approval, a photo capture and a video capture using the actual HTTPS hostname.
5. Play and seek an uploaded video on the production tablet and a large-screen workstation. Interrupt Wi-Fi during a large upload, reconnect, and confirm it completes without inserting a partial document.

The local SQL regression runner creates an empty schema clone, runs fixtures, and drops only its own test database. It never resets the application database:

```sh
npm run test:sql
```

Run this with Node.js 24, Docker and the local `supabase_db_work-instructions` container running. The test runner verifies the control migrations on a clone; it does not apply migrations to the application database or deploy a container. See [README setup](../README.md) for first-account provisioning and [Structured instruction editor](./EDITOR.md) for formatting and Markdown behavior.

Browser automation validates layout and file uploads using an isolated backend fixture. Physical camera permissions, device codecs, the NAS reverse proxy, certificate trust and real Wi-Fi behavior require the device checks above. Software controls support document-control evidence; organizational approval, training, retention and backup procedures remain part of audit readiness.

Sources: [Synology reverse proxy](https://kb.synology.com/en-in/DSM/help/DSM/AdminCenter/system_login_portal_advanced), [HTML media capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture), [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).
