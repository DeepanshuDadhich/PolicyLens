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

const result = detectPolicyPage();

chrome.runtime.sendMessage({ type: "POLICY_DETECTED", data: result });
