const BADGE_COLORS = {
  high: "#3B82F6",
  medium: "#F59E0B",
  low: "#6B7280",
};

// tabId -> { isPolicy, confidence, matchedSignals, title, text, textHash, textLength, extractionMethod }
const detectionResults = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "POLICY_ANALYZED") {
    const tabId = sender.tab?.id;
    const { isPolicy, confidence, matchedSignals, title, text, textHash, textLength, extractionMethod } =
      message.data;

    if (tabId !== undefined) {
      detectionResults.set(tabId, {
        isPolicy,
        confidence,
        matchedSignals,
        title,
        text,
        textHash,
        textLength,
        extractionMethod,
      });

      if (isPolicy) {
        chrome.action.setBadgeText({ text: "!", tabId });
        chrome.action.setBadgeBackgroundColor({
          color: BADGE_COLORS[confidence] ?? BADGE_COLORS.low,
          tabId,
        });
      } else {
        chrome.action.setBadgeText({ text: "", tabId });
      }
    }
    sendResponse?.({ ok: true });
    return;
  }

  if (message?.type === "GET_DETECTION_RESULT") {
    const tabId = message.tabId ?? sender.tab?.id;
    sendResponse?.(detectionResults.get(tabId) ?? null);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
    detectionResults.delete(tabId);
  }
});
