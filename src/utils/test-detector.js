/**
 * Manual test harness for the policy-page detection heuristics.
 *
 * How to run:
 *   1. Open DevTools on any page, go to the Console tab.
 *   2. Paste this entire file and press Enter (or copy it into a Snippet
 *      and run that) — it auto-executes `runTests()` at the bottom.
 *   3. Read the console.table output: PASS/FAIL per case, expected vs actual.
 *
 * This file intentionally duplicates the matching logic from
 * src/content/detector.js instead of importing it, so it can be pasted
 * directly into any page's console without module/bundling concerns.
 * If you change the patterns or confidence rules in detector.js, mirror
 * the change here too.
 */

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

function matchUrl(pathname) {
  const path = pathname.toLowerCase();
  const hit = URL_PATTERNS.find((pattern) => path.includes(pattern));
  return hit ? `url:${hit}` : null;
}

function matchHeading(doc) {
  const headings = doc.querySelectorAll("h1, h2, h3");
  for (const heading of headings) {
    const text = heading.textContent?.trim() ?? "";
    const pattern = TEXT_PATTERNS.find((regex) => regex.test(text));
    if (pattern) {
      return `heading:${text.slice(0, 60)}`;
    }
  }
  return null;
}

function matchTitle(title) {
  const pattern = TEXT_PATTERNS.find((regex) => regex.test(title));
  return pattern ? `title:${title.slice(0, 60)}` : null;
}

// Mirrors detectPolicyPage() from detector.js, but takes a parsed Document
// and pathname as input instead of reading the live page.
function detectPolicyPage(doc, pathname) {
  const urlSignal = matchUrl(pathname);
  const headingSignal = matchHeading(doc);
  const titleSignal = matchTitle(doc.title ?? "");

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

const CASES = [
  {
    name: "URL + heading match -> high",
    pathname: "/privacy",
    title: "Acme Inc.",
    html: "<h1>Privacy Policy</h1><p>We respect your data.</p>",
    expected: { isPolicy: true, confidence: "high" },
  },
  {
    name: "URL match only -> medium",
    pathname: "/legal/terms",
    title: "Acme Inc. — Legal",
    html: "<h1>Legal Information</h1><p>General legal notices.</p>",
    expected: { isPolicy: true, confidence: "medium" },
  },
  {
    name: "Heading match only (URL not matched) -> medium",
    pathname: "/about/company-info",
    title: "About Acme",
    html: "<h2>Terms and Conditions</h2><p>By using this site...</p>",
    expected: { isPolicy: true, confidence: "medium" },
  },
  {
    name: "Title match only -> low",
    pathname: "/about/company-info",
    title: "Cookie Policy | Acme Inc.",
    html: "<h1>About Us</h1><p>We are a small company.</p>",
    expected: { isPolicy: true, confidence: "low" },
  },
  {
    name: "No signals at all -> not a policy page",
    pathname: "/products/widget",
    title: "Buy the Acme Widget",
    html: "<h1>Acme Widget</h1><p>Now in five colors.</p>",
    expected: { isPolicy: false, confidence: "low" },
  },
  {
    name: "Case-insensitive heading match",
    pathname: "/help",
    title: "Help Center",
    html: "<h3>terms OF SERVICE</h3>",
    expected: { isPolicy: true, confidence: "medium" },
  },
  {
    name: "Nested markup inside heading still matches via textContent",
    pathname: "/data-policy",
    title: "Acme Inc.",
    html: "<h1>Our <strong>Data Policy</strong> Explained</h1>",
    expected: { isPolicy: true, confidence: "high" },
  },
  {
    name: "Blog post mentioning privacy in body, not heading/title/URL",
    pathname: "/blog/2026/why-privacy-matters",
    title: "Why Privacy Matters in 2026",
    html: "<h1>Why Privacy Matters in 2026</h1><p>Let's talk about privacy policy trends.</p>",
    // Note: pathname contains "/privacy"? "/blog/2026/why-privacy-matters"
    // does NOT contain the literal "/privacy" substring (it's "why-privacy-"),
    // so this should NOT trigger a URL match. Title/heading text is about the
    // *topic* of privacy, not "Privacy Policy" wording, so it also shouldn't
    // match TEXT_PATTERNS. This case is here to confirm we don't over-match.
    expected: { isPolicy: false, confidence: "low" },
  },
  {
    name: "GDPR path with no heading/title match -> medium",
    pathname: "/gdpr-compliance",
    title: "Compliance",
    html: "<h1>Our Approach to Compliance</h1>",
    expected: { isPolicy: true, confidence: "medium" },
  },
  {
    name: "H4 heading is ignored (only h1-h3 checked)",
    pathname: "/support",
    title: "Support",
    html: "<h4>Privacy Policy</h4><p>Not a real heading match by design.</p>",
    expected: { isPolicy: false, confidence: "low" },
  },
];

function runTests() {
  const parser = new DOMParser();
  const rows = CASES.map((testCase) => {
    const doc = parser.parseFromString(testCase.html, "text/html");
    doc.title = testCase.title;

    const result = detectPolicyPage(doc, testCase.pathname);
    const pass =
      result.isPolicy === testCase.expected.isPolicy &&
      result.confidence === testCase.expected.confidence;

    return {
      name: testCase.name,
      pass: pass ? "✅ PASS" : "❌ FAIL",
      expectedIsPolicy: testCase.expected.isPolicy,
      actualIsPolicy: result.isPolicy,
      expectedConfidence: testCase.expected.confidence,
      actualConfidence: result.confidence,
      matchedSignals: result.matchedSignals.join(" | "),
    };
  });

  console.table(rows);

  const failCount = rows.filter((r) => r.pass === "❌ FAIL").length;
  if (failCount === 0) {
    console.log(`%cAll ${rows.length} cases passed.`, "color: green; font-weight: bold;");
  } else {
    console.log(
      `%c${failCount} of ${rows.length} case(s) failed — see table above.`,
      "color: red; font-weight: bold;"
    );
  }

  return rows;
}

runTests();
