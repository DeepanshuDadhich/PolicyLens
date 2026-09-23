import { SYSTEM_PROMPT, buildUserPrompt } from "../utils/prompts.js";

const CEREBRAS_ENDPOINT = "https://api.cerebras.ai/v1/chat/completions";
const MODEL = "gpt-oss-120b";
const MAX_OUTPUT_TOKENS = 2048;

// Cerebras Free Trial limits for gpt-oss-120b, per
// https://inference-docs.cerebras.ai/support/rate-limits (checked 2026-09-23):
// 5 RPM, 30K uncached TPM, 90K total TPM, 1M TPH, 1M TPD, 65K context window.
// Uncached TPM is the tightest per-request ceiling, so we budget against it.
const TPM_LIMIT = 30000;
const TPM_WARNING_MARGIN = 500;

// ~76,000 chars (~19,000 tokens) leaves headroom under the 30K uncached TPM
// limit after the ~3,100-token system prompt and 2,048-token output budget
// (3,100 + 2,048 = 5,148 fixed; ~24,850 tokens remain, budgeted at ~19,000
// with margin for the buildUserPrompt() wrapper and estimation error).
// Large outliers (e.g. a ~111,000-char Forbes policy, ~27,800 tokens) still
// exceed this and get truncated.
const MAX_POLICY_TEXT_LENGTH = 76000;

const VALID_SEVERITIES = ["high", "medium", "low"];
const VALID_RISK_SCORES = ["A", "B", "C", "D", "F"];

/**
 * Quick 4-chars-per-token approximation. Used only to warn early during
 * testing — the real number comes from response.usage.total_tokens, which
 * requestAnalysis logs after every successful call.
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
 * object, in case reasoning or commentary leaks around the JSON despite
 * response_format and the system prompt's instructions.
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
    console.error(`[PolicyLens] Cerebras API 400 Bad Request: ${body}`);
    return { error: "BAD_REQUEST", message: "The request to Cerebras was malformed." };
  }

  if (status === 401) {
    return { error: "INVALID_KEY", message: "Your Cerebras API key is invalid or expired." };
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
    return { error: "SERVER_ERROR", message: "Cerebras API is temporarily unavailable." };
  }

  const body = await response.text().catch(() => "<unreadable body>");
  console.error(`[PolicyLens] Cerebras API unexpected ${status} response: ${body}`);
  return { error: "UNKNOWN_ERROR", message: `Cerebras API returned an unexpected error (${status}).` };
}

/**
 * Performs a single request/parse/validate cycle. Returns one of:
 *   { httpError }   — a non-2xx response; caller should not retry
 *   { parseFailed }  — JSON.parse failed or schema validation failed
 *   { analysis }     — a validated analysis object
 */
async function requestAnalysis(policyText, apiKey) {
  const userPromptContent = buildUserPrompt(policyText);

  const estimatedTotal =
    estimateTokens(SYSTEM_PROMPT) + estimateTokens(userPromptContent) + MAX_OUTPUT_TOKENS;
  if (estimatedTotal >= TPM_LIMIT - TPM_WARNING_MARGIN) {
    console.warn(
      `[PolicyLens] Estimated request size (~${estimatedTotal} tokens) is within ${TPM_WARNING_MARGIN} tokens of the ${TPM_LIMIT} TPM limit.`
    );
  }

  const response = await fetch(CEREBRAS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPromptContent },
      ],
      temperature: 0.1,
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    return { httpError: await buildHttpError(response) };
  }

  const payload = await response.json();

  if (payload?.usage?.total_tokens !== undefined) {
    console.log(
      `[PolicyLens] Cerebras actual usage: ${payload.usage.total_tokens} total tokens (estimated ~${estimatedTotal}).`
    );
  }

  const rawContent = payload?.choices?.[0]?.message?.content ?? "";

  let parsed;
  try {
    parsed = JSON.parse(extractJsonPayload(rawContent));
  } catch (error) {
    console.warn("[PolicyLens] Failed to parse Cerebras response as JSON:", error, rawContent);
    return { parseFailed: true };
  }

  if (!validateAnalysisSchema(parsed)) {
    console.warn("[PolicyLens] Cerebras response did not match the expected schema:", parsed);
    return { parseFailed: true };
  }

  return { analysis: parsed };
}

/**
 * Sends policy text to Cerebras for structured analysis.
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
      console.error("[PolicyLens] Cerebras request failed:", error);
      return {
        error: "NETWORK_ERROR",
        message: "Could not reach the Cerebras API. Check your connection.",
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
