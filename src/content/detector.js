import { extractPolicyText, getTextHash } from "./extractor.js";

const URL_PATTERNS = [
  "/privacy",
  "/legal",
  "/terms",
  "/data-policy",
  "/cookie-policy",
  "/gdpr",
];

const TEXT_PATTERNS = [
  /privacy policy/i,
  /terms of service/i,
  /terms and conditions/i,
  /terms of use/i,
  /data policy/i,
  /cookie policy/i,
];

function matchUrl() {
  const path = window.location.pathname.toLowerCase();
  const hit = URL_PATTERNS.find((pattern) => path.includes(pattern));
  return hit ? `url:${hit}` : null;
}

function matchHeading() {
  const headings = document.querySelectorAll("h1, h2, h3");
  for (const heading of headings) {
    const text = heading.textContent?.trim() ?? "";
    const pattern = TEXT_PATTERNS.find((regex) => regex.test(text));
    if (pattern) {
      return `heading:${text.slice(0, 60)}`;
    }
  }
  return null;
}

function matchTitle() {
  const title = document.title ?? "";
  const pattern = TEXT_PATTERNS.find((regex) => regex.test(title));
  return pattern ? `title:${title.slice(0, 60)}` : null;
}

export function detectPolicyPage() {
  const urlSignal = matchUrl();
  const headingSignal = matchHeading();
  const titleSignal = matchTitle();

  const matchedSignals = [urlSignal, headingSignal, titleSignal].filter(Boolean);

  let confidence = "low";
  if (urlSignal && headingSignal) {
    confidence = "high";
  } else if (urlSignal || headingSignal) {
    confidence = "medium";
  } else if (titleSignal) {
    confidence = "low";
  }

  return {
    isPolicy: matchedSignals.length > 0,
    confidence,
    matchedSignals,
  };
}

/**
 * Runs detection and, if the page looks like a policy page, extraction.
 * Sends a single POLICY_ANALYZED message with the combined result either
 * way, so the background service worker can still clear the badge on
 * non-policy pages.
 */
async function runPipeline() {
  const detection = detectPolicyPage();

  if (!detection.isPolicy) {
    chrome.runtime.sendMessage({
      type: "POLICY_ANALYZED",
      data: {
        isPolicy: false,
        confidence: detection.confidence,
        matchedSignals: detection.matchedSignals,
        title: document.title ?? "",
        text: "",
        textHash: "",
        textLength: 0,
        extractionMethod: "skipped",
      },
    });
    return;
  }

  const extraction = await extractPolicyText();
  const textHash = extraction.text ? await getTextHash(extraction.text) : "";

  chrome.runtime.sendMessage({
    type: "POLICY_ANALYZED",
    data: {
      isPolicy: detection.isPolicy,
      confidence: detection.confidence,
      matchedSignals: detection.matchedSignals,
      title: extraction.title,
      text: extraction.text,
      textHash,
      textLength: extraction.length,
      extractionMethod: extraction.extractionMethod,
    },
  });
}

// Guard on `window` (not a module-level variable) so the pipeline still
// runs at most once per page even if this script is ever re-injected
// programmatically into the same document — e.g. a future SPA
// navigation/MutationObserver hook re-triggering detection.
if (!window.__policylensAnalyzed) {
  window.__policylensAnalyzed = true;
  runPipeline();
}
