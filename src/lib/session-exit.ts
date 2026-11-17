const BROWSER_EXIT_LOGOUT_KEY_PREFIX = "work_instructions_browser_exit_logout";
const SAME_TAB_EXIT_KEY_PREFIX = "work_instructions_same_tab_exit";
const SAME_TAB_RELOAD_GRACE_MS = 30_000;

function parseTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getBrowserExitKey(userId: string) {
  return `${BROWSER_EXIT_LOGOUT_KEY_PREFIX}:${userId}`;
}

function getSameTabExitKey(userId: string) {
  return `${SAME_TAB_EXIT_KEY_PREFIX}:${userId}`;
}

// Set when this page signs the user out on purpose (the account menu, the sign-out button or the
// inactivity timeout). Sign-out ends with a full page load to the sign-in page, which fires the same
// "page is closing" events as closing the browser; without this, that load left a "sign out on the
// next visit" mark behind, and the next sign-in was signed straight out again.
let signingOutOnPurpose = false;

/** Call before an intentional sign-out leaves the page, so leaving is not mistaken for closing the browser. */
export function prepareIntentionalSignOut(userId: string | null | undefined) {
  signingOutOnPurpose = true;
  if (userId) {
    clearBrowserExitSignOutPending(userId);
  }
}

export function markBrowserExitSignOutPending(userId: string) {
  if (typeof window === "undefined" || signingOutOnPurpose) {
    return;
  }

  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return;
  }

  const now = String(Date.now());
  window.localStorage.setItem(getBrowserExitKey(normalizedUserId), now);
  window.sessionStorage.setItem(getSameTabExitKey(normalizedUserId), now);
}

export function clearBrowserExitSignOutPending(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return;
  }

  window.localStorage.removeItem(getBrowserExitKey(normalizedUserId));
  window.sessionStorage.removeItem(getSameTabExitKey(normalizedUserId));
}

export function consumeBrowserExitSignOutPending(userId: string) {
  if (typeof window === "undefined") {
    return false;
  }

  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return false;
  }

  const browserExitKey = getBrowserExitKey(normalizedUserId);
  const sameTabExitKey = getSameTabExitKey(normalizedUserId);
  const hasPendingBrowserExit = Boolean(window.localStorage.getItem(browserExitKey));

  if (!hasPendingBrowserExit) {
    return false;
  }

  const sameTabExitAt = parseTimestamp(window.sessionStorage.getItem(sameTabExitKey));
  const sameTabReload =
    sameTabExitAt !== null && Date.now() - sameTabExitAt <= SAME_TAB_RELOAD_GRACE_MS;

  if (sameTabReload) {
    window.localStorage.removeItem(browserExitKey);
    window.sessionStorage.removeItem(sameTabExitKey);
    return false;
  }

  window.localStorage.removeItem(browserExitKey);
  window.sessionStorage.removeItem(sameTabExitKey);
  return true;
}
