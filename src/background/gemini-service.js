import { SYSTEM_PROMPT, buildUserPrompt } from "../utils/prompts.js";

// Model confirmed live against GET .../v1beta/models on 2026-09-24 — see the
// PR discussion for the full list. gemini-2.5-flash (the seemingly obvious
// "stable" choice) returned 404 "no longer available to new users; use
// models/gemini-3.6-flash", so that redirect is the actual source of truth
// here, not a guess.
const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-3.6-flash";
const MAX_OUTPUT_TOKENS = 2048;

// Gemini's rate-limit numbers are no longer published globally — Google's
// docs page states they're account/tier-specific and viewable only in each
// user's own AI Studio dashboard. No TPM figure here is independently
// verified; the truncation limit below is instead sized against the one
// number that IS confirmed live: gemini-3.6-flash's inputTokenLimit of
// 1,048,576 tokens (from the /v1beta/models response).
const CONFIRMED_INPUT_TOKEN_LIMIT = 1_048_576;

// Fixed overhead per request: SYSTEM_PROMPT (~3,107 tokens, measured) +
// buildUserPrompt's wrapper text (~140 tokens, measured) + the output
// reserve. With thinkingConfig.thinkingBudget: 0 (see below), none of
// MAX_OUTPUT_TOKENS is consumed by hidden reasoning, so the full amount
// counts as overhead, not risk margin.
//   3,107 + 140 + 2,048 = 5,295 tokens fixed
//   1,048,576 - 5,295 = 1,043,281 tokens theoretically available for policy text
//
// Rather than truncate anywhere near that ceiling, the limit below is set
// far more conservatively — comfortably above Forbes' 111,253-char policy
// (this project's known largest real-world sample) while using only a
// small fraction of the confirmed context window, as a guard against
// pathological input (e.g. a mis-extracted page dumping megabytes of
// unrelated text) rather than a real functional constraint:
//   300,000 chars ≈ 75,000 tokens ≈ 7% of the 1,043,281 tokens available
const MAX_POLICY_TEXT_LENGTH = 300_000;

const VALID_SEVERITIES = ["high", "medium", "low"];
const VALID_RISK_SCORES = ["A", "B", "C", "D", "F"];

/**
 * Quick 4-chars-per-token approximation. Used only to log an estimate
 * alongside the real number — usageMetadata.totalTokenCount from the
 * response is the source of truth, logged in requestAnalysis().
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function truncatePolicyText(text) {
  if (text.length <= MAX_POLICY_TEXT_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_POLICY_TEXT_LENGTH);
}

/**
 * Defensively strips any leading/trailing text outside the outer {...}
 * object, in case commentary leaks around the JSON despite
 * responseMimeType and the prompt's instructions.
 */
function extractJsonPayload(rawContent) {
  const firstBrace = rawContent.indexOf("{");
  const lastBrace = rawContent.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("No JSON object boundaries found in model output");
  }

  return rawContent.slice(firstBrace, lastBrace + 1);
}

function isString(value) {
  return typeof value === "string";
}

/**
 * Validates the parsed response against the schema defined in prompts.js.
 * Returns false (rather than throwing) so callers can treat an
 * unexpected-shape response the same way as unparseable JSON.
 */
function validateAnalysisSchema(data) {
  if (!data || typeof data !== "object") return false;

  if (!Array.isArray(data.dataCollected)) return false;
  for (const item of data.dataCollected) {
    if (!isString(item?.category) || !isString(item?.details) || !isString(item?.sourceClause)) {
      return false;
    }
  }

  if (!Array.isArray(data.thirdPartySharing)) return false;
  for (const item of data.thirdPartySharing) {
    if (!isString(item?.recipient) || !isString(item?.purpose) || !isString(item?.sourceClause)) {
      return false;
    }
  }

  if (typeof data.retentionPolicy !== "object" || data.retentionPolicy === null) return false;
  if (!isString(data.retentionPolicy.summary) || !isString(data.retentionPolicy.sourceClause)) {
    return false;
  }

  if (!Array.isArray(data.userRights)) return false;
  for (const item of data.userRights) {
    if (!isString(item?.right) || !isString(item?.howToExercise) || !isString(item?.sourceClause)) {
      return false;
    }
  }

  if (!Array.isArray(data.redFlags)) return false;
  for (const item of data.redFlags) {
    if (
      !isString(item?.flag) ||
      !VALID_SEVERITIES.includes(item?.severity) ||
      !isString(item?.explanation) ||
      !isString(item?.sourceClause)
    ) {
      return false;
    }
  }

  if (!VALID_RISK_SCORES.includes(data.riskScore)) return false;
  if (!isString(data.riskJustification)) return false;

  return true;
}

async function buildHttpError(response) {
  const status = response.status;

  if (status === 400) {
    const body = await response.text().catch(() => "<unreadable body>");

    // Confirmed live: an invalid key comes back as HTTP 400 with
    // status "INVALID_ARGUMENT" and a details[].reason of
    // "API_KEY_INVALID" — NOT as 401/403 like the 401/403 branch below
    // assumes for other providers. A plain malformed request (e.g. a bad
    // generationConfig field) also returns 400, so the reason/message is
    // inspected to tell the two apart rather than treating every 400 as
    // BAD_REQUEST.
    let parsedBody = null;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      // Leave parsedBody null; falls through to the generic BAD_REQUEST path below.
    }

    const isInvalidKey =
      parsedBody?.error?.details?.some((detail) => detail.reason === "API_KEY_INVALID") ||
      /api key not valid/i.test(parsedBody?.error?.message ?? "");

    if (isInvalidKey) {
      return { error: "INVALID_KEY", message: "Your Gemini API key is invalid or expired." };
    }

    console.error(`[PolicyLens] Gemini API 400 Bad Request: ${body}`);
    return { error: "BAD_REQUEST", message: "The request to Gemini was malformed." };
  }

  if (status === 401 || status === 403) {
    // Not confirmed live for this key — kept as a defensive fallback since
    // these are the conventional HTTP codes for auth failures, and other
    // Google APIs do use 403 for permission-denied (e.g. a key valid for
    // one project but lacking access to this API).
    return { error: "INVALID_KEY", message: "Your Gemini API key is invalid or expired." };
  }

  if (status === 429) {
    const retryAfter = response.headers.get("retry-after");
    return {
      error: "RATE_LIMIT",
      message: retryAfter
        ? `Rate limit reached. Try again in ${retryAfter} seconds.`
        : "Rate limit reached. Try again shortly.",
    };
  }

  if (status >= 500) {
    return { error: "SERVER_ERROR", message: "Gemini API is temporarily unavailable." };
  }

  const body = await response.text().catch(() => "<unreadable body>");
  console.error(`[PolicyLens] Gemini API unexpected ${status} response: ${body}`);
  return { error: "UNKNOWN_ERROR", message: `Gemini API returned an unexpected error (${status}).` };
}

/**
 * Performs a single request/parse/validate cycle. Returns one of:
 *   { httpError }   — a non-2xx response; caller should not retry
 *   { parseFailed }  — JSON.parse failed or schema validation failed
 *   { analysis }     — a validated analysis object
 */
async function requestAnalysis(policyText, apiKey) {
  const userPromptContent = buildUserPrompt(policyText);
  const combinedPrompt = `${SYSTEM_PROMPT}\n\n${userPromptContent}`;
  const estimatedTotal = estimateTokens(combinedPrompt) + MAX_OUTPUT_TOKENS;

  const response = await fetch(
    `${GEMINI_ENDPOINT_BASE}/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: combinedPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // Confirmed live: gemini-3.6-flash has "thinking" enabled by
          // default, and its hidden reasoning tokens count against
          // maxOutputTokens. Without this, a test call spent 181 of a
          // 200-token budget on invisible "thoughts" and nearly hit
          // finishReason: MAX_TOKENS before the visible JSON even started.
          // Setting thinkingBudget: 0 removed the thoughtsTokenCount field
          // entirely and returned finishReason: STOP. This is an API
          // parameter, not a prompt instruction — SYSTEM_PROMPT's
          // reasoning-suppression text (written for GPT-OSS-120b) doesn't
          // control this and doesn't need to for correctness.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!response.ok) {
    return { httpError: await buildHttpError(response) };
  }

  const payload = await response.json();

  if (payload?.usageMetadata?.totalTokenCount !== undefined) {
    console.log(
      `[PolicyLens] Gemini actual usage: ${payload.usageMetadata.totalTokenCount} total tokens (estimated ~${estimatedTotal}).`
    );
  }

  // If Gemini's safety filters block the content, candidates can be empty
  // or missing rather than an HTTP error. That falls through to an empty
  // string here, which extractJsonPayload() below turns into a thrown
  // "no JSON boundaries" error — handled by the existing parseFailed path,
  // not a special case.
  const rawContent = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  let parsed;
  try {
    parsed = JSON.parse(extractJsonPayload(rawContent));
  } catch (error) {
    console.warn("[PolicyLens] Failed to parse Gemini response as JSON:", error, rawContent);
    return { parseFailed: true };
  }

  if (!validateAnalysisSchema(parsed)) {
    console.warn("[PolicyLens] Gemini response did not match the expected schema:", parsed);
    return { parseFailed: true };
  }

  return { analysis: parsed };
}

/**
 * Sends policy text to Gemini for structured analysis.
 *
 * @param {string} policyText
 * @param {string} apiKey
 * @returns {Promise<object>} the validated analysis object, or
 *   { error: string, message: string } on failure.
 */
export async function analyzePolicy(policyText, apiKey) {
  const truncatedText = truncatePolicyText(policyText);
  const MAX_ATTEMPTS = 2; // one retry, only on parse/schema failure

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result;
    try {
      result = await requestAnalysis(truncatedText, apiKey);
    } catch (error) {
      console.error("[PolicyLens] Gemini request failed:", error);
      return {
        error: "NETWORK_ERROR",
        message: "Could not reach the Gemini API. Check your connection.",
      };
    }

    if (result.httpError) {
      return result.httpError;
    }

    if (result.parseFailed) {
      continue; // retry once, same request
    }

    return result.analysis;
  }

  return { error: "PARSE_ERROR", message: "Failed to parse the analysis. Try re-analyzing." };
}
