# Validation record

Recorded for the local working tree on 2026-11-09, after the Markdown editor, plant-floor homepage, account-security, sign-in lockout and AI provider key changes. These checks establish the specific behavior below; they do not certify ISO compliance or guarantee that every defect has been eliminated.

## Completed checks

| Check | Result | Scope |
| --- | --- | --- |
| TypeScript and ESLint | Passed | Application, scripts and all test sources. |
| Library and regression tests (`npm run test:unit`) | 6 Node checks and 68 Playwright checks passed | Markdown rendering and conversion (callouts, charts, media, task lists, tables, legacy HTML), round-trip stability, editor text commands, sanitization, chart accuracy, AI asset retention, homepage layouts, manufacturing calculations, paging guard, AI key encryption (round trip, fresh nonces, tamper detection, key format). |
| Real-backend workflows (`npm run test:integration`) | 31 passed | Run against a disposable local Supabase stack freshly reset from every migration in `supabase/migrations`, with no data left from earlier runs (see below). |
| Isolated browser suite (`npm run test:e2e`) | 49 of 51 passed in the full run; both remaining specs pass | In-memory fixture backend; five viewport sweeps of 18 routes, editor, media, homepage editor and settings API checks. One failure was a test still expecting the old "AI enhancement is not configured" wording (updated). The other was the homepage editor timing out while the development server compiled its large bundle on a machine with 2–3 GB of free memory; repeat development-server runs failed the same way, with the bundle requests never completing. Against a production build of the same code, the AI route and homepage specs passed 15 of 15. The suites ignore errors raised from inside Next's development hot reloader, which does not exist in production. |
| Database control tests (`npm run test:sql`) | All six SQL regression suites passed | Instruction revisions, import evidence, controlled documents, media storage permissions, PIN/account hardening (PIN policy, 1-minute lockout after ten failures, PIN changes, browser privileges) and AI provider settings (server-only access, one configuration, permanent activity log), in a disposable schema clone that is removed afterwards. |
| Production build (`npm run build`) | Passed | Compiled, type-checked and generated all 65 pages (standalone output), built into a separate folder that was removed afterwards. |

### Real-backend workflows

The integration suite signs in with Employee ID and PIN as a system administrator, an author (admin) and an operator, and drives the real UI, API routes, database functions, row-level security and storage:

- An author writes a new instruction with the Markdown toolbar and keyboard (heading, CAUTION callout, numbered steps continued with Enter, bold text, checklist, table, chart dialog) and uploads a photo to storage. The preview, the saved instruction page and the stored Markdown all match; the photo loads from storage.
- Operators cannot find the instruction until a system administrator approves it. After approval, an operator scans the part number (Enter with a single match opens it), cannot edit or archive it, and pins it to their homepage.
- An author revises the released instruction: the editor loads Markdown, revision 2 is saved for review, and revision 1 stays released and unchanged.
- Deleting an instruction (Archive) removes it from the homepage and search; restoring it from the archive brings it back. Permanent deletion stays disabled for ISO record retention.
- A legacy rich-text (HTML) instruction opens as converted Markdown with a notice, leaving without editing does not prompt about unsaved changes, and saving stores Markdown.
- A controlled document is created in Markdown (stored as sanitized HTML), reopened as Markdown, revised with a change summary, submitted for review straight after saving, and marked obsolete; the database refuses to delete its retained evidence.
- Saving an instruction or document over someone else's newer change is refused within a second with a clear message.
- Operators (Contributors) get New instruction, My drafts and Document center shortcuts, because they may submit work for review; department chips filter the lists; a search with no results hides the lists until it is cleared. Homepage layout changes persist after a reload and Reset restores the Plant floor layout.
- Sign-in and PINs: ten wrong PINs lock an Employee ID for a minute, even for the right PIN, and a system admin's reset clears it; a device that fails 20 times within a minute is paused for a minute; unknown IDs fail identically; browsers cannot verify PINs, read PIN hashes, or rewrite profiles and formulas; changing your own PIN requires the current PIN and rejects guessable PINs.
- Self-registration creates an operator account even when another role is requested, and rejects weak PINs and duplicate Employee IDs.
- Roles: operators cannot open administration pages or call their APIs; only system admins list, create or change accounts (admins are refused for every account, including operators and their own, and see no user list); system admins create, re-PIN, promote, deactivate, reactivate and delete accounts; a deactivated user with an open session is signed out with an explanation instead of looping between pages.
- AI provider key: only system admins can see, change, view or test it; saving, viewing and removing need their PIN; the database holds only ciphertext and no browser role can read it; a key the provider rejects is not saved; the key never appears in API responses or server logs; AI features use the saved provider, model and key (Claude, then OpenAI, then a model-only change), and stop when it is removed; every action is recorded and the record cannot be deleted. A local stand-in provider answers these requests, so no real provider is called.
- Instruction import retains the source file and it can be downloaded; system admins can assign access-group members; work-instruction submission notifications are accepted. (All four were rejecting every request before.)

To run it, start a separate local Supabase project with its own ports so the development database is untouched, then point the suite at it:

```bash
# A copy of supabase/ with project_id "wi-e2e" and API port 57321 (keep other ports distinct too)
npx supabase start --workdir <copy-dir>
npx supabase status --workdir <copy-dir> -o env   # ANON_KEY and SERVICE_ROLE_KEY

INTEGRATION_SUPABASE_URL=http://127.0.0.1:57321 \
INTEGRATION_SUPABASE_ANON_KEY=<anon key> \
INTEGRATION_SUPABASE_SERVICE_ROLE_KEY=<service role key> \
npm run test:integration
```

The suite refuses non-loopback URLs. It seeds three test accounts (`scripts/tests/integration-seed.mjs`) and starts the app on port 3200 with email delivery and analytics disabled and AI requests answered by a local stand-in provider (`scripts/tests/ai-provider-mock.mjs`). `npm run test:integration:demo-data` adds sample instructions for exploring the stack by hand. Stop the stack with `npx supabase stop --no-backup --workdir <copy-dir>`.

## Defects found and fixed during validation

- Ending a list or callout with Enter left the next paragraph attached to the last item; it now leaves a separating blank line.
- A cancelled or failed upload left stray blank lines where its placeholder had been.
- Homepage search showed two clear buttons in Chromium; system events were listed among document results.
- `readAllRows` could loop forever if a backend ignored paging (the profile test fixture did, which hung `/groups` and `/process-documents` in the browser suite); the reader now stops with an error after 2,000 pages and the fixture honours paging.
- The fork/merge comparison now compares rendered text, so a Markdown branch and an older HTML root line up.
- Edit conflicts were raised with SQLSTATE `40001`, which PostgREST retries automatically. A save that clashed with another user's change hung for about a minute and then failed with "The upstream server is timing out". Conflicts now use `PT409` and are refused immediately with the intended message.
- Submit for Review straight after Save Draft sent the revision stamp from before the save, so it would have been refused as a conflict. The save now returns the new stamp, and the document actions stay disabled until the page has refreshed.
- A department chip tapped while saved homepage preferences were still loading snapped back to the stored department, and the choice was not saved.
- Notification emails were sent before the API responded, so an unreachable mail server held a submission open for up to 30 seconds. They are now sent after the response.
- Account and role security gaps (admins could create or promote system administrators and reset their PINs, browsers could guess PINs without limit, and more) are listed in [the change review](./CHANGE_REVIEW.md#accounts-sign-in-and-roles).

## Release acceptance still required

These checks did not deploy the container or apply the new migrations to the existing application database. Apply migrations `202606031230` through `202611090001` with a backup in place, following [Synology deployment](./SYNOLOGY_DEPLOYMENT.md). After `202611080001`, PINs are checked only by the server, so deploy the matching application version at the same time. Set `AI_KEY_ENCRYPTION_KEY` before a system admin saves an AI key, and back it up separately from database backups.

No real AI provider was called during these checks. After saving a real key, use **Test connection** in System Administration to confirm the provider accepts the key and model.

Real tablet camera/microphone permissions, device video codecs, barcode scanners, Wi-Fi interruption, the Synology HTTPS proxy and production backup/restore must be checked on the intended equipment. Real model-generated wording still requires engineering review and the normal approval process.

See [the editor guide](./EDITOR.md), [homepage guide](./HOMEPAGE.md) and [the change review](./CHANGE_REVIEW.md).
