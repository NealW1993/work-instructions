# Validation record

Recorded for the local working tree on 2026-11-17, after the plant-floor simplification round (optional instruction details instead of ISO fields, the always-open tools field, consistent review status, the header loop switch, the homepage department menu and gap-free layout, Process Docs, metrics and System Settings), on top of the 2026-11-13 formatted editor, header and homepage redesign, account-security, sign-in lockout and AI provider key changes. These checks establish the specific behavior below; they do not certify ISO compliance or guarantee that every defect has been eliminated.

## Completed checks

| Check | Result | Scope |
| --- | --- | --- |
| TypeScript and ESLint | Passed | Application, scripts and all test sources. |
| Library and regression tests (`npm run test:unit`) | 6 Node checks and 70 Playwright checks passed (2026-11-17) | Markdown rendering and conversion (callouts, charts, media, task lists, tables, legacy HTML), round-trip stability, how each editor block is written back as Markdown (callouts, nested lists, checklists, valid and broken charts, photos, videos, uploads in progress, simple and merged tables), sanitization, chart accuracy, AI asset retention, homepage layouts, manufacturing calculations, paging guard, AI key encryption (round trip, fresh nonces, tamper detection, key format). |
| Real-backend workflows (`npm run test:integration`) | 2026-11-17: 23 passed, 3 failed, 5 did not run, while the test PC was repeatedly freezing; one failure was a test defect (now fixed), the other two were timeouts on that PC, and the suite needs a clean re-run (see [Release acceptance](#release-acceptance-still-required)). 2026-11-13: 31 passed | Run against a disposable local Supabase stack freshly reset from every migration in `supabase/migrations`, with no data left from earlier runs (see below). In the full run 30 passed; the AI key page test found the expected notice twice because the development server had left a hidden, streamed copy of the page in place. A probe found no hydration errors or leftover copies on repeat visits, so the assertion now looks only in the visible page content, and the spec passed 6 of 6. |
| Isolated browser suite (`npm run test:e2e`) | 54 of 54 passed against the final production build (2026-11-17) | In-memory fixture backend; five viewport sweeps of 18 routes, the formatted editor (toolbar, typing shortcuts, lists, callouts, links, tables, charts, imports, uploads, AI suggestions, unsaved-change prompts), a new instruction saved with only a part, a title and steps (tools and the optional details left empty), the More details section, the header tabs, menus and background loop (it plays even when the device asks for reduced motion, and the account-menu switch turns it off and on), media, homepage editor and settings API checks. Tests start with the header animation switched off for the test browser, the same setting as the account-menu switch, so that the header video does not hold the network busy for ~20 s per page. |
| Database control tests (`npm run test:sql`) | All seven suites passed (2026-11-17) | Instruction revisions, optional instruction details (new: a save without the optional details stores them empty and gets the default references, edits keep existing references, part, title and steps are still required), import evidence, controlled documents, media storage permissions, PIN/account hardening (PIN policy, 1-minute lockout after ten failures, PIN changes, browser privileges) and AI provider settings (server-only access, one configuration, permanent activity log), in a disposable schema clone that is removed afterwards. The local database already had two of the November migrations applied by hand, which made the runner stop; it now recognises an already-applied migration and re-applies only its permission statements, so the browser-permission checks still cover them. |
| Production build | Passed | The browser suite's production build compiled and served every route. The Docker image build (below) compiles the same code with the standalone output used in deployment. |

### Real-backend workflows

The integration suite signs in with Employee ID and PIN as a system administrator, an author (admin) and an operator, and drives the real UI, API routes, database functions, row-level security and storage:

- An author writes a new instruction in the formatted editor with the toolbar and keyboard (a heading typed as `## `, a CAUTION callout left with Enter on its empty line, numbered steps typed as `1. ` and continued with Enter, bold text, a checklist, a table filled from its first cell, the chart dialog) and uploads a photo to storage, adds a tool and fills in one optional detail (What good looks like). What the editor shows, the saved instruction page and the stored Markdown all match; the photo loads from storage, and the tool and detail are stored while the details left empty are stored as empty text. The form shows no ISO fields.
- Operators cannot find the instruction until a system administrator approves it. After approval, an operator scans the part number (Enter with a single match opens it), cannot edit or archive it, and pins it to their homepage.
- An author revises the released instruction: the editor opens it formatted (callout, photo and all), Ctrl+End reaches the empty line below the final photo, revision 2 is saved for review, and revision 1 stays released and unchanged.
- Deleting an instruction (Archive) removes it from the homepage and search; restoring it from the archive brings it back. Permanent deletion stays disabled for ISO record retention.
- A legacy rich-text (HTML) instruction opens converted in the editor with a notice (highlighted text becomes bold), leaving without editing does not prompt about unsaved changes, Enter continues its numbered list, and saving stores Markdown.
- A controlled document is written in the formatted editor (stored as sanitized HTML), reopened formatted, revised with a change summary, submitted for review straight after saving, and marked obsolete; the database refuses to delete its retained evidence.
- Saving an instruction or document over someone else's newer change is refused within a second with a clear message.
- Operators (Contributors) get New instruction, My drafts and Document center shortcuts, because they may submit work for review; the Department menu filters the lists; a search with no results hides the lists until it is cleared. Homepage layout changes persist after a reload and Reset restores the Plant floor layout.
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

- Clicking a link inside the formatted editor (to edit it) raised the "unsaved changes" prompt on instructions and controlled documents, because the leave-page guards treated it as navigation. Links inside an editor are now ignored by the guards.
- After a chart or photo was inserted it stayed selected, so the next keystroke replaced it, and several uploaded photos landed in reverse order. The cursor now continues on the line below each new chart or photo.
- After Ctrl+A, a second click on Numbered list, Bulleted list, Checklist, Quote or Remove callout did nothing. Select-all is now narrowed to the text it covers for these commands.
- Clicking into an instruction that ended with a table, chart or photo could mark it as changed, because the editor adds an empty last line on first use. That line is now added when the editor opens and is ignored when checking for changes.
- A new table left the cursor in its last cell; it now starts in the first empty cell. Leaving a callout at the end of a document added a second blank line.
- A redesign had removed the animated header loop; it is restored. While playing, it kept the browser network busy for about 20 seconds per page load.
- The restored loop still never played on PCs with Windows animation effects turned off, because browsers then report "reduce motion" and the loop was hidden for that. It now plays by default, with a per-device switch in the account menu.
- An instruction whose review check was due still showed **Up to date** on its page; only flagged instructions showed **Needs review**. A due check now shows **Needs review** everywhere.
- A global border colour rule sat outside Tailwind's layers and overrode every border colour utility, so all borders rendered the same grey. It is now in the base layer.
- Homepage panels of mixed widths left empty gaps at the end of a row; panels in a row now widen to fill it.
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

The 2026-11-17 integration run had three failures, diagnosed from their screenshots, page snapshots and traces:

- **New instruction (test defect, fixed).** The optional detail was saved correctly and shown on the instruction page in its own "What good looks like" box above the steps. The test looked for it inside the steps text instead; it now checks the box.
- **Archive (timeout).** The instruction was archived and the browser reached the homepage, but the page's load event took longer than the test's 60 seconds while the PC was freezing.
- **Controlled document edit (timeout).** The editor held the new "Records" section and the save request was sent, but the development server did not answer within 30 seconds; other requests in that minute took about a second instead of the usual tens of milliseconds. The save route and its helpers are unchanged since the last passing run.

Five later tests in those groups did not run. Re-run the integration suite on a machine with enough free memory (the Supabase stack, the development server and the test browser together need several GB) before release.

This round adds migration `202611140001_instruction_details_optional.sql`, which lets an instruction be saved without the optional details. It was applied to the local development database on 2026-11-16 (the previous definition of `save_work_instruction_controlled` was saved first); browsers keep the same permissions on the function. Production (Synology) has not been updated. Apply migrations `202606031230` through `202611140001` with a backup in place, following [Synology deployment](./SYNOLOGY_DEPLOYMENT.md). After `202611080001`, PINs are checked only by the server, so deploy the matching application version at the same time. Set `AI_KEY_ENCRYPTION_KEY` before a system admin saves an AI key, and back it up separately from database backups.

No real AI provider was called during these checks. After saving a real key, use **Test connection** in System Administration to confirm the provider accepts the key and model.

Real tablet camera/microphone permissions, device video codecs, barcode scanners, Wi-Fi interruption, the Synology HTTPS proxy and production backup/restore must be checked on the intended equipment. Real model-generated wording still requires engineering review and the normal approval process.

See [the editor guide](./EDITOR.md), [homepage guide](./HOMEPAGE.md) and [the change review](./CHANGE_REVIEW.md).
