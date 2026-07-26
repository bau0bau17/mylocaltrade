// Logged-out deep-link recovery.
//
// When a Universal Link (or custom-scheme bounce) opens the app at /open but
// the user has no session yet, we can't navigate to the destination — the
// authed screens would just error or bounce. Instead we stash the intended
// in-app path here, send the user to the login screen, and after a successful
// login the login screen consumes the stash and continues to the original
// destination. Module-level (not persisted): if the user abandons login or
// cold-restarts, the stale intent is dropped rather than surprising them
// on a later, unrelated login.

let pending: string | null = null;

export function setPendingDeepLink(path: string) {
  pending = path;
}

/** Returns the stashed destination (once) and clears it. */
export function consumePendingDeepLink(): string | null {
  const p = pending;
  pending = null;
  return p;
}
