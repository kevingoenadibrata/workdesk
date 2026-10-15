const DONE_KEY = "workdesk.onboarded";

/**
 * Whether to show onboarding at launch: only on a first install. Someone who
 * already has a saved session is an existing user, so they're marked as done
 * without seeing it (they can still replay it from the menu bar).
 */
export function shouldOnboard(hasSession: boolean): boolean {
  try {
    if (localStorage.getItem(DONE_KEY)) return false;
    if (hasSession) {
      localStorage.setItem(DONE_KEY, "1");
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

export function markOnboarded() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Shown again next launch, which is harmless.
  }
}
