import { analyzePolicy } from "./cerebras-service.js";
import { getCachedAnalysis, setCachedAnalysis, clearCacheForDomain } from "../utils/cache.js";

const BADGE_COLORS = {
  high: "#3B82F6",
  medium: "#F59E0B",
  low: "#6B7280",
};

// tabId -> { isPolicy, confidence, matchedSignals, title, text, textHash, textLength, extractionMethod, domain }
const detectionResults = new Map();

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// tabId -> Promise resolving to the analyzePolicy() result for an
// in-progress request. Lets a duplicate REQUEST_ANALYSIS/RE_ANALYZE for the
// same tab join the existing call instead of firing a second one.
const inFlightAnalyses = new Map();

// tabId -> { status: 'queued' | 'analyzing' | 'done' | 'error', ... }
// Queried by the popup via GET_ANALYSIS_STATE and pushed proactively via
// ANALYSIS_STATE_CHANGED so an open popup can show "Waiting for rate
// limit..." instead of a generic spinner.
const analysisState = new Map();

const CEREBRAS_RPM_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Timestamps (ms) of the last calls into analyzePolicy(), for the sliding
// 60s window. Note this counts calls to the wrapper, not raw HTTP requests —
// if analyzePolicy() internally retries once on a parse failure, that second
// HTTP call isn't separately counted here.
let requestTimestamps = [];

// Serializes rate-limit slot checks so concurrently queued callers take
// slots one at a time as they free up, rather than all waking on the same
// setTimeout and overshooting the limit together.
let rateLimitQueueTail = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves once it's safe to make a Cerebras call, having reserved a slot
 * in requestTimestamps. Calls onWait() the first time this particular
 * caller actually has to wait for a slot (i.e. was queued, not immediate).
 *
 * MV3 caveat: a wait can take up to ~60s. This relies on Chrome's
 * allowance that a service worker stays alive while an onMessage listener
 * has returned `true` and not yet called sendResponse (up to ~5 minutes),
 * rather than a bare setTimeout, which would not by itself keep the worker
 * alive. If queued requests ever pile up deep enough to approach that
 * 5-minute ceiling, this should move to chrome.alarms instead.
 */
function reserveRateLimitSlot(onWait) {
  const reservation = rateLimitQueueTail.then(async () => {
    let hasWaited = false;
    for (;;) {
      const now = Date.now();
      requestTimestamps = requestTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

      if (requestTimestamps.length < CEREBRAS_RPM_LIMIT) {
        requestTimestamps.push(Date.now());
        return;
      }

      if (!hasWaited) {
        hasWaited = true;
        onWait?.();
      }

      const waitMs = RATE_LIMIT_WINDOW_MS - (now - requestTimestamps[0]) + 50;
      await sleep(Math.max(waitMs, 50));
    }
  });

  rateLimitQueueTail = reservation;
  return reservation;
}

function broadcastAnalysisState(tabId) {
  chrome.runtime
    .sendMessage({ type: "ANALYSIS_STATE_CHANGED", tabId, state: analysisState.get(tabId) ?? null })
    .catch(() => {
      // No popup open to receive it — GET_ANALYSIS_STATE covers the pull case.
    });
}

async function runAnalysis(tabId, detection, apiKey) {
  const { text: policyText, domain, textHash } = detection;

  const cached = await getCachedAnalysis(domain, textHash);
  if (cached) {
    analysisState.set(tabId, {
      status: "done",
      analysis: cached.analysis,
      source: "cache",
      timestamp: cached.timestamp,
    });
    broadcastAnalysisState(tabId);
    return cached.analysis;
  }

  await reserveRateLimitSlot(() => {
    analysisState.set(tabId, { status: "queued" });
    broadcastAnalysisState(tabId);
  });

  analysisState.set(tabId, { status: "analyzing" });
  broadcastAnalysisState(tabId);

  const result = await analyzePolicy(policyText, apiKey);

  if (result?.error) {
    analysisState.set(tabId, { status: "error", error: result.error, message: result.message });
  } else {
    setCachedAnalysis(domain, textHash, result).catch((error) => {
      console.error("[PolicyLens] Failed to cache analysis result:", error);
    });
    analysisState.set(tabId, { status: "done", analysis: result, source: "fresh" });
  }
  broadcastAnalysisState(tabId);

  return result;
}

async function handleAnalysisRequest(tabId, sendResponse, { forceRefresh = false } = {}) {
  if (inFlightAnalyses.has(tabId)) {
    // Already running for this tab — join it instead of calling the API again.
    inFlightAnalyses.get(tabId).then(sendResponse);
    return;
  }

  const { cerebrasApiKey } = await chrome.storage.sync.get("cerebrasApiKey");
  if (!cerebrasApiKey) {
    // No cache lookup, no rate-limit slot — this request can't succeed anyway.
    sendResponse({ status: "error", error: "NO_KEY" });
    return;
  }

  const detection = detectionResults.get(tabId);
  if (!detection?.text) {
    sendResponse({ error: "NO_TEXT", message: "No extracted policy text available for this tab." });
    return;
  }

  const promise = (async () => {
    if (forceRefresh) {
      // RE_ANALYZE's whole point is to bypass any cached result.
      await clearCacheForDomain(detection.domain);
    }
    return runAnalysis(tabId, detection, cerebrasApiKey);
  })().finally(() => {
    inFlightAnalyses.delete(tabId);
  });

  inFlightAnalyses.set(tabId, promise);
  promise.then(sendResponse);
}

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
        domain: extractDomain(sender.tab?.url ?? ""),
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
    return;
  }

  if (message?.type === "REQUEST_ANALYSIS" || message?.type === "RE_ANALYZE") {
    const tabId = message.tabId ?? sender.tab?.id;
    if (tabId === undefined) {
      sendResponse?.({ error: "NO_TAB", message: "No tab context for this request." });
      return;
    }
    handleAnalysisRequest(tabId, sendResponse, {
      forceRefresh: message.type === "RE_ANALYZE",
    });
    return true; // keep the message channel open for the async response
  }

  if (message?.type === "GET_ANALYSIS_STATE") {
    const tabId = message.tabId ?? sender.tab?.id;
    sendResponse?.(analysisState.get(tabId) ?? null);
    return;
  }

  if (message?.type === "GET_STATUS") {
    const tabId = message.tabId ?? sender.tab?.id;
    (async () => {
      const detection = detectionResults.get(tabId);
      const { cerebrasApiKey } = await chrome.storage.sync.get("cerebrasApiKey");
      sendResponse?.({
        isPolicy: detection?.isPolicy ?? false,
        confidence: detection?.confidence ?? null,
        hasApiKey: Boolean(cerebrasApiKey),
        analysisStatus: analysisState.get(tabId)?.status ?? null,
      });
    })();
    return true; // keep the message channel open for the async response
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
    detectionResults.delete(tabId);
    inFlightAnalyses.delete(tabId);
    analysisState.delete(tabId);
  }
});
