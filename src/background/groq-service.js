import { SYSTEM_PROMPT, buildUserPrompt } from "../utils/prompts.js";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";
const MAX_OUTPUT_TOKENS = 1500;

// Free-tier TPM budget for this model. A single request's total (system +
// user + max output tokens) must fit under this, not just the sum across
// multiple calls in a minute.
const TPM_LIMIT = 8000;
const TPM_WARNING_MARGIN = 500;

// Rough char-based ceiling (~2,500 tokens) to stay within the ~3,050 tokens
// actually available after the fixed ~2,900-token system prompt and the
// 1,500-token output budget.
const MAX_POLICY_TEXT_LENGTH = 10000;

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
    console.error(`[PolicyLens] Groq API 400 Bad Request: ${body}`);
    return { error: "BAD_REQUEST", message: "The request to Groq was malformed." };
  }

  if (status === 401) {
    return { error: "INVALID_KEY", message: "Your Groq API key is invalid or expired." };
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
    return { error: "SERVER_ERROR", message: "Groq API is temporarily unavailable." };
  }

  const body = await response.text().catch(() => "<unreadable body>");
  console.error(`[PolicyLens] Groq API unexpected ${status} response: ${body}`);
  return { error: "UNKNOWN_ERROR", message: `Groq API returned an unexpected error (${status}).` };
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

  const response = await fetch(GROQ_ENDPOINT, {
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
      `[PolicyLens] Groq actual usage: ${payload.usage.total_tokens} total tokens (estimated ~${estimatedTotal}).`
    );
  }

  const rawContent = payload?.choices?.[0]?.message?.content ?? "";

  let parsed;
  try {
    parsed = JSON.parse(extractJsonPayload(rawContent));
  } catch (error) {
    console.warn("[PolicyLens] Failed to parse Groq response as JSON:", error, rawContent);
    return { parseFailed: true };
  }

  if (!validateAnalysisSchema(parsed)) {
    console.warn("[PolicyLens] Groq response did not match the expected schema:", parsed);
    return { parseFailed: true };
  }

  return { analysis: parsed };
}

/**
 * Sends policy text to Groq for structured analysis.
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
      console.error("[PolicyLens] Groq request failed:", error);
      return {
        error: "NETWORK_ERROR",
        message: "Could not reach the Groq API. Check your connection.",
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
