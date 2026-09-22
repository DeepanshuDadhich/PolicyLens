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
 * can't produce usable content (common on SPAs or heavily JS-rendered
 * pages where the article isn't in a recognizable content structure).
 */
function extractFallbackText() {
  const rawText = document.body?.innerText ?? "";
  const text = cleanFallbackText(rawText);

  return {
    title: document.title ?? "",
    text,
    length: text.length,
    extractionMethod: "fallback",
  };
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
    // Readability mutates the DOM it's given, so we hand it a clone and
    // leave the live page untouched.
    const clonedDocument = document.cloneNode(true);
    const article = new Readability(clonedDocument).parse();

    if (article?.textContent && article.textContent.trim().length > 0) {
      const text = article.textContent.trim();
      return {
        title: article.title ?? document.title ?? "",
        text,
        length: text.length,
        extractionMethod: "readability",
      };
    }

    // Readability parsed but found nothing usable — fall back.
    return extractFallbackText();
  } catch (error) {
    try {
      return extractFallbackText();
    } catch {
      return { title: "", text: "", length: 0, extractionMethod: "failed" };
    }
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
