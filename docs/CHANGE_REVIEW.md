# Application cleanup and control review

## Controlled documents and work instructions

- Document saves commit content, revision evidence, imported source and access assignments together. Conflicting edits are rejected at once with a clear "changed after you opened it" message instead of overwriting another author's work. The database reports these conflicts with SQLSTATE `PT409` (HTTP 409). `40001` must not be used for this, because PostgREST retries it as a transient serialization failure until the gateway times out.
- A save returns the new revision stamp, and the document actions wait for the refreshed page, so Submit for Review straight after Save Draft is not mistaken for a conflicting edit.
- Status-only submission and approval preserve a process document's revision number. Content changes create a revision with a required change summary. Released snapshots remain visible to readers during drafting.
- Work instructions retain a stable revision family when the part, title or department changes. A working revision can coexist with the current approved revision. Approval swaps the release within one transaction.
- Released content, approval evidence, archived revisions and retained source files are protected against mutation. Tooling and media evidence travel with a revised instruction. Permanent document deletion remains blocked.
- Approvals require an active authorized reviewer, the version being reviewed, a pending submission and a reason for rejection. Cancelling a rejection prompt leaves the submission unchanged.
- Branch merges create a new revision requiring approval. Archive/restore operations and their audit evidence commit atomically.
- Prints identify unreleased or archived copies, part and department, and the requirement to verify the current release before use.

## Accounts, sign-in and roles

Each item below closes a gap found while reviewing account creation, sign-in and role access. The integration suite and `tests/access-hardening.sql` cover each one.

- **Role changes.** Any admin could create system administrators, promote any account (including their own) to system admin, and reset a system admin's PIN. Now only system admins list, create and change accounts and roles. Admins keep departments, review settings, metrics and exports on the same page but do not see the user list, and every account route refuses them.
- **PIN guessing.** Supabase's default function grants let browsers call `verify_pin_login` directly, which allowed unlimited PIN guessing. Now only the server can call it. Ten failures in a row lock an Employee ID for 1 minute, unknown IDs fail the same way, and a device that fails 20 times within a minute is paused for up to a minute. A system admin's PIN reset clears a lock.
- **PIN disclosure.** Setting a PIN that someone else already used failed with "already in use", which revealed a working PIN. PINs no longer have to be unique. Guessable PINs (repeated or sequential digits, common patterns) are refused instead.
- **Changing your own PIN.** This needed only an open session. It now requires the current PIN, and ten wrong guesses in a row pause PIN changes for a minute.
- **Direct database writes.** A signed-in user could rewrite their own profile row (employee ID, email, sign-out timeout) through the database API. Formula owners could edit formula records directly, including the approval state stored in the formula payload. Browser roles can no longer write profiles or formulas or read PIN hashes. Those changes go through role-checked API routes.
- **Signed-in time KPI.** Ending a session accepted elapsed time reported by the browser, so a user could inflate it. The server now records session time itself.
- **Deactivated accounts.** A deactivated user with an open session bounced between the login page and the homepage. The session is now signed out and the login page explains that the account is inactive. System admins can deactivate and reactivate accounts, which also blocks sign-in.
- **Registration and help forms.** Self-registration always creates an operator account, rejects weak PINs and duplicate Employee IDs, and is rate-limited, as are the feedback and help forms.
- **Broken features.** A malformed ID check rejected every request to instruction import, retained-source download, submission notifications and access-group membership. These now work.

Apply `supabase/migrations/202611080001_access_hardening.sql` together with the other pending migrations.

## AI provider key

System admins choose the AI provider (Claude, OpenAI, Grok or Gemini) and model, and manage its API key in System Administration. All AI features use one shared client (`src/lib/ai-provider.server.ts`), so the choice applies to writing help, search ranking, chart suggestions, formula interpretation and page explanations.

- The key is encrypted with AES-256-GCM before storage. The encryption key (`AI_KEY_ENCRYPTION_KEY`) stays in the server environment, so database access or a backup alone cannot reveal the API key. Each stored value only opens for the provider it was saved for, and any tampering is detected.
- No browser role can read or write the key table or its activity log. Only system admins see the settings, and saving, viewing or removing the key requires re-entering their own PIN, with the sign-in lockout applying to wrong PINs.
- The key is never returned in status responses or written to logs. Provider error text is redacted before logging and replaced by plain messages for users. A viewed key stays on screen for 30 seconds and is never cached.
- Requests go only to each provider's fixed official address. Saving tests the key first by default, so a mistyped key is not stored.
- Saves, model changes, views, tests, removals and wrong PINs are recorded permanently; not even the server can change or delete the records.
- Until a key is saved in the app, the server's `OPENAI_API_KEY` is used, so existing deployments keep working.

Apply `supabase/migrations/202611090001_ai_provider_settings.sql` and set `AI_KEY_ENCRYPTION_KEY` before saving a key.

## Reliability, calculations and interface

- Manufacturing calculation checks cover stopped shifts, zero good output, zero defects, invalid counts, mixed-product OEE weighting, capability and Individuals control limits. Invalid input is shown rather than silently converted to zero.
- First pass yield uses failed units separately from the total defect count used for defects per unit. Older saved formulas retain their total defects and require an explicit failed-unit count before displaying FPY. DPMO's complementary percentage is labeled opportunity yield. This follows the [ASQ definitions of first pass yield and defective units](https://asq.org/quality-resources/quality-glossary).
- Custom arithmetic expressions use a bounded parser instead of executing JavaScript.
- Search respects the requester's document permissions and published revision. Export pagination retains complete datasets and includes release and source evidence.
- Document browsing supports filters, sorting and pagination. Secondary settings use expandable sections. Shared navigation, keyboard focus, reduced motion, loading, errors and empty states have been improved.
- The homepage is designed for the plant floor: a large search with scan-to-open (a single match opens on Enter), department chips, role-based quick actions, and large touch-friendly rows for pinned, recently changed, new and needs-review instructions. A new default **Plant floor** layout shows only those lists; existing personal layouts are unchanged. The layout editor keeps its searchable widget library, presets, preview, order and width controls, undo/redo, staged defaults and explicit save/cancel with versioned atomic saves. See [homepage setup](./HOMEPAGE.md).
- Instruction media supports tablet capture, visible upload progress, resumable large uploads, cancellation, inline playback and a playback fallback. Manufacturing images use containment so details are not cropped.
- Font assets and their licenses are bundled locally, removing the Google Fonts network dependency during builds. Errors persist until addressed or dismissed, and required fields expose their invalid state to assistive technology.
- Instructions and controlled documents are written in Markdown with a toolbar, live preview (Write/Split/Preview), list continuation, GitHub-style safety callouts, `chart` blocks, tables, checklists, and camera/paste/drag-and-drop media uploads. The previous rich-text editor (TipTap) and its dependencies were removed. Instruction bodies are stored as Markdown; controlled documents keep sanitized HTML for revisions and downloads and convert at the editor boundary. Legacy HTML instructions display unchanged and convert to Markdown when edited (colour and highlight become bold) without a false unsaved-changes prompt.
- Viewer, print, AI comparison, preview and standalone downloads share one renderer and sanitizer for Markdown and legacy HTML. Chart graphics and complete data tables are regenerated from validated values, and an invalid chart value is reported with its line number instead of being plotted.
- AI suggestions are compared side by side and convert to Markdown when applied; they remain subject to the author's review and normal approval. The server rejects changed, omitted or invented chart data and image/video sources, and a delayed suggestion cannot overwrite newer edits. See [the editor guide](./EDITOR.md).

## Validation and rollout

Run the package's type, lint, unit, browser and SQL scripts before release. SQL tests run against a disposable schema clone. UI tests use an isolated backend and ports, leaving the existing app and its records untouched. See [Synology deployment and tablet media](./SYNOLOGY_DEPLOYMENT.md) for the coordinated schema/container upgrade and physical-device acceptance checks.

This review implements and tests specific controls. It is not a certification of ISO compliance or a guarantee that every defect has been eliminated.
