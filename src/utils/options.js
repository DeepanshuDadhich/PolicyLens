/**
 * Opens the extension's options page.
 *
 * TODO: no options page is registered in the manifest yet (planned for a
 * later prompt) — this will silently no-op until then. Shared by
 * ErrorState's key-related CTAs and the popup Footer's gear button so the
 * TODO only has to be removed in one place once the page exists.
 */
export async function openOptionsPage() {
  try {
    await chrome.runtime.openOptionsPage();
  } catch (error) {
    console.warn("[PolicyLens] openOptionsPage failed (no options page registered yet):", error);
  }
}
