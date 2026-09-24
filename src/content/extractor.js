import { Readability } from "@mozilla/readability";

// Lines shorter than this are treated as nav/menu noise in the fallback path.
const MIN_FALLBACK_LINE_LENGTH = 10;

/**
 * Collapses runs of whitespace and drops short "noise" lines (nav items,
 * button labels, etc.) that tend to survive a raw innerText dump.
 */
function cleanFallbackText(rawText) {
  return rawText
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= MIN_FALLBACK_LINE_LENGTH)
    .join("\n")
    .trim();
}

/**
 * Falls back to a plain document.body.innerText dump when Readability
 * can't produce usable content. Always logs WHY it was reached, so a
 * fallback result is never silently indistinguishable from a real failure.
 */
function extractFallbackText(reason) {
  console.warn(`[PolicyLens] Falling back to innerText extraction — reason: ${reason}`);

  const rawText = document.body?.innerText ?? "";
  const text = cleanFallbackText(rawText);

  const result = {
    title: document.title ?? "",
    text,
    length: text.length,
    extractionMethod: "fallback",
  };
  return result;
}

/**
 * Extracts the main readable text of the current page, preferring
 * Mozilla's Readability (used by Firefox Reader View) and falling back
 * to a cleaned-up innerText dump when Readability can't parse the page.
 *
 * @returns {Promise<{ title: string, text: string, length: number, extractionMethod: 'readability' | 'fallback' | 'failed' }>}
 */
export async function extractPolicyText() {
  try {
    if (typeof Readability !== "function") {
      return extractFallbackText(
        `Readability import is not a constructor (typeof === "${typeof Readability}") — check the bundler output`
      );
    }

    // The clone step lives in the SAME try as parse(), not before it:
    // document.cloneNode(true) can itself throw on pages using Custom
    // Elements (e.g. "Cannot read properties of null (reading
    // '__CE_registry')" — seen on policies.google.com/privacy), and a
    // thrown clone should fall back exactly like a thrown parse(), not
    // skip straight to the outer "failed" result. Readability mutates the
    // DOM it's given, so cloning is still necessary to leave the live page
    // untouched.
    let article;
    try {
      const clonedDocument = document.cloneNode(true);

      if (!clonedDocument?.documentElement) {
        return extractFallbackText(
          "document.cloneNode(true) produced no documentElement — Readability would reject it"
        );
      }

      article = new Readability(clonedDocument).parse();
    } catch (error) {
      console.error("[PolicyLens] Readability clone/parse step threw:", error);
      return extractFallbackText(
        `Readability threw an exception: ${error?.name ?? "Error"}: ${error?.message ?? String(error)}`
      );
    }

    if (article === null) {
      return extractFallbackText(
        "Readability.parse() returned null — no article candidate scored high enough on this page"
      );
    }

    const text = article.textContent?.trim() ?? "";

    if (text.length === 0) {
      return extractFallbackText(
        `Readability returned an article object but textContent was empty (title: "${article.title ?? ""}", length: ${article.length ?? 0})`
      );
    }

    const result = {
      title: article.title ?? document.title ?? "",
      text,
      length: text.length,
      extractionMethod: "readability",
    };
    return result;
  } catch (error) {
    console.error("[PolicyLens] Extraction failed entirely:", error);
    return { title: "", text: "", length: 0, extractionMethod: "failed" };
  }
}

/**
 * Computes a SHA-256 hash of the given text using the Web Crypto API,
 * for use as a cache key (e.g. to skip re-analyzing unchanged policy text).
 *
 * @param {string} text
 * @returns {Promise<string>} hex-encoded hash
 */
export async function getTextHash(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
