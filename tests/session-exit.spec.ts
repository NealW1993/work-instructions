import { expect, test } from "@playwright/test";
import {
  clearBrowserExitSignOutPending,
  consumeBrowserExitSignOutPending,
  markBrowserExitSignOutPending,
  prepareIntentionalSignOut,
} from "../src/lib/session-exit";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: local, sessionStorage: session };
const userId = "a1000000-0000-0000-0000-000000000001";
const exitMark = () => local.getItem(`work_instructions_browser_exit_logout:${userId}`);

// The steps share the module's state, so they run in order in one test.
test("closing the browser signs out on the next visit, but signing out on purpose and signing in again do not", () => {
  // Closing the browser while signed in leaves a mark; a later visit in a new tab signs out.
  markBrowserExitSignOutPending(userId);
  expect(exitMark()).not.toBeNull();
  session.clear();
  expect(consumeBrowserExitSignOutPending(userId)).toBe(true);

  // Reloading the same tab within the grace period is not a browser exit.
  markBrowserExitSignOutPending(userId);
  expect(consumeBrowserExitSignOutPending(userId)).toBe(false);

  // A fresh sign-in clears a mark left behind by a closed browser (the login page does this).
  markBrowserExitSignOutPending(userId);
  session.clear();
  clearBrowserExitSignOutPending(userId);
  expect(consumeBrowserExitSignOutPending(userId)).toBe(false);

  // Signing out on purpose (account menu, sign-out button or inactivity timeout) ends with a full page
  // load, which fires the same "page is closing" events. That must not leave a mark behind, or the next
  // sign-in is signed straight out again.
  prepareIntentionalSignOut(userId);
  markBrowserExitSignOutPending(userId);
  expect(exitMark()).toBeNull();
  session.clear();
  expect(consumeBrowserExitSignOutPending(userId)).toBe(false);
});
