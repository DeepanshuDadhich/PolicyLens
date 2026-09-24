import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  CHUNK_SYSTEM_PROMPT,
  buildChunkUserPrompt,
} from "../utils/prompts.js";

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

// ---- Chunked analysis ----
// Policies longer than CHUNK_CHAR_SIZE are split and analyzed in sequential
// calls so the whole document gets read instead of truncated.
//
// Per-chunk token cost (the 8,000 TPM budget is what everything below is
// sized against):
//   CHUNK_SYSTEM_PROMPT   ~609 tokens   (vs ~3,107 for the full prompt)
//   chunk text            ~1,500 tokens (6,000 chars / 4)
//   user-prompt wrapper   ~134 tokens
//   max output             800 tokens
//   -------------------------------------
//   total                ~3,043 tokens per call
//
// At ~3,043 tokens/call, 8,000 TPM allows ~2.6 calls/minute, so calls are
// spaced by (tokensPerCall / TPM_LIMIT) * 60s ≈ 23s. Using the full system
// prompt instead would cost ~5,541 tokens/call and push that spacing to
// ~42s — which is why the compact chunk prompt exists.
const CHUNK_CHAR_SIZE = 6000;
const MAX_CHUNKS = 6; // ~36,000 chars of policy covered
const CHUNK_MAX_OUTPUT_TOKENS = 800; // partial results need less room than a whole-policy analysis

const VALID_SEVERITIES = ["high", "medium", "low"];
const VALID_RISK_SCORES = ["A", "B", "C", "D", "F"];

// Worst-first ordering, used when merging chunk results.
const RISK_SCORE_RANK = { A: 0, B: 1, C: 2, D: 3, F: 4 };
const SEVERITY_RANK = { low: 0, medium: 1, high: 2 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spacing needed between sequential calls so the rolling 60s token spend
 * stays under TPM_LIMIT: (tokensPerCall / TPM_LIMIT) * 60,000ms.
 */
function chunkDelayMs(estimatedTokensPerCall) {
  return Math.ceil((estimatedTokensPerCall / TPM_LIMIT) * 60_000);
}

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
async function requestAnalysis(systemPrompt, userPromptContent, maxOutputTokens, apiKey) {
  const estimatedTotal =
    estimateTokens(systemPrompt) + estimateTokens(userPromptContent) + maxOutputTokens;
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
        { role: "system", content: systemPrompt },
        { role: "user", content: userPromptContent },
      ],
      temperature: 0.1,
      max_tokens: maxOutputTokens,
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
 * Issues one analysis call, retrying once on a parse/schema failure.
 * Shared by the whole-policy and per-chunk paths so both get identical
 * HTTP error mapping, JSON extraction, and schema validation.
 *
 * @returns {Promise<object>} a validated analysis object, or
 *   { error: string, message: string } on failure.
 */
async function runWithRetry(systemPrompt, userPromptContent, maxOutputTokens, apiKey) {
  const MAX_ATTEMPTS = 2; // one retry, only on parse/schema failure

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result;
    try {
      result = await requestAnalysis(systemPrompt, userPromptContent, maxOutputTokens, apiKey);
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
  return runWithRetry(SYSTEM_PROMPT, buildUserPrompt(truncatedText), MAX_OUTPUT_TOKENS, apiKey);
}

/** Splits oversized single paragraphs that exceed the chunk budget on their own. */
function hardSplit(text, size) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

/**
 * Splits text into at most maxChunks pieces of ~chunkSize characters,
 * breaking at paragraph boundaries so clauses aren't cut mid-sentence.
 */
function splitIntoChunks(text, chunkSize, maxChunks) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .flatMap((paragraph) => (paragraph.length > chunkSize ? hardSplit(paragraph, chunkSize) : [paragraph]))
    .filter((paragraph) => paragraph.trim().length > 0);

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length > chunkSize && current) {
      chunks.push(current);
      if (chunks.length >= maxChunks) return chunks;
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current && chunks.length < maxChunks) {
    chunks.push(current);
  }

  return chunks;
}

function normalizeKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Keeps the first entry seen for each normalized key, dropping near-identical repeats. */
function dedupeBy(items, keyField) {
  const seen = new Map();
  for (const item of items) {
    const key = normalizeKey(item?.[keyField]);
    if (!key || seen.has(key)) continue;
    seen.set(key, item);
  }
  return [...seen.values()];
}

/** Same as dedupeBy, but a repeated flag keeps whichever chunk rated it worst. */
function dedupeRedFlags(flags) {
  const seen = new Map();
  for (const flag of flags) {
    const key = normalizeKey(flag?.flag);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing || (SEVERITY_RANK[flag?.severity] ?? -1) > (SEVERITY_RANK[existing?.severity] ?? -1)) {
      seen.set(key, flag);
    }
  }
  return [...seen.values()];
}

/** Prefers the most detailed retention statement found across chunks. */
function pickRetentionPolicy(policies) {
  const specified = policies.filter(
    (policy) => isString(policy?.summary) && normalizeKey(policy.summary) !== "not specified"
  );

  if (specified.length === 0) {
    return { summary: "Not specified", sourceClause: "Not specified" };
  }

  return specified.reduce((best, policy) => (policy.summary.length > best.summary.length ? policy : best));
}

/**
 * Combines per-chunk analyses into one whole-policy analysis: arrays are
 * concatenated and deduped, the risk grade is the WORST any chunk assigned
 * (a single bad clause taints the whole policy), and justifications are
 * merged.
 *
 * @param {object[]} chunkResults validated analysis objects
 * @returns {object} a single merged analysis in the same schema
 */
export function mergeChunkAnalyses(chunkResults) {
  const analyses = chunkResults.filter((result) => result && !result.error);

  if (analyses.length === 0) {
    return {
      dataCollected: [],
      thirdPartySharing: [],
      retentionPolicy: { summary: "Not specified", sourceClause: "Not specified" },
      userRights: [],
      redFlags: [],
      riskScore: "F",
      riskJustification: "No part of this policy could be analyzed.",
    };
  }

  const worstScore = analyses.reduce((worst, analysis) => {
    const rank = RISK_SCORE_RANK[analysis.riskScore] ?? -1;
    return rank > (RISK_SCORE_RANK[worst] ?? -1) ? analysis.riskScore : worst;
  }, "A");

  const justifications = [
    ...new Set(
      analyses
        .map((analysis) => String(analysis.riskJustification ?? "").trim())
        .filter((justification) => justification.length > 0)
    ),
  ];

  return {
    dataCollected: dedupeBy(analyses.flatMap((a) => a.dataCollected ?? []), "category"),
    thirdPartySharing: dedupeBy(analyses.flatMap((a) => a.thirdPartySharing ?? []), "recipient"),
    retentionPolicy: pickRetentionPolicy(analyses.map((a) => a.retentionPolicy)),
    userRights: dedupeBy(analyses.flatMap((a) => a.userRights ?? []), "right"),
    redFlags: dedupeRedFlags(analyses.flatMap((a) => a.redFlags ?? [])),
    riskScore: worstScore,
    riskJustification: justifications.join(" "),
  };
}

/**
 * Analyzes a policy in full, chunking long documents instead of truncating
 * them. Short policies take the single-call fast path.
 *
 * @param {string} policyText
 * @param {string} apiKey
 * @returns {Promise<object>} merged analysis object, or { error, message }.
 */
export async function analyzePolicyChunked(policyText, apiKey) {
  if (policyText.length <= CHUNK_CHAR_SIZE) {
    console.log(
      `[PolicyLens] Policy is ${policyText.length} chars — single-call path. API calls used: 1.`
    );
    return analyzePolicy(policyText, apiKey);
  }

  const chunks = splitIntoChunks(policyText, CHUNK_CHAR_SIZE, MAX_CHUNKS);
  const coveredChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const exceededLimit = coveredChars < policyText.length;

  const estimatedTokensPerCall =
    estimateTokens(CHUNK_SYSTEM_PROMPT) +
    estimateTokens(buildChunkUserPrompt(chunks[0], 1, chunks.length)) +
    CHUNK_MAX_OUTPUT_TOKENS;
  const delayMs = chunkDelayMs(estimatedTokensPerCall);

  console.log(
    `[PolicyLens] Policy is ${policyText.length} chars — split into ${chunks.length} chunk(s), ` +
      `~${estimatedTokensPerCall} tokens/call, ${delayMs}ms between calls to stay under ${TPM_LIMIT} TPM. ` +
      `Estimated wall time: ~${Math.round(((chunks.length - 1) * delayMs) / 1000)}s of rate-limit waiting.`
  );

  const analyses = [];
  let apiCalls = 0;

  for (let index = 0; index < chunks.length; index++) {
    if (index > 0) {
      await sleep(delayMs);
    }

    const result = await runWithRetry(
      CHUNK_SYSTEM_PROMPT,
      buildChunkUserPrompt(chunks[index], index + 1, chunks.length),
      CHUNK_MAX_OUTPUT_TOKENS,
      apiKey
    );
    apiCalls++;

    if (result?.error) {
      // Nothing usable yet — surface the failure as-is.
      if (analyses.length === 0) {
        console.log(`[PolicyLens] Scan failed on chunk 1. API calls used: ${apiCalls}.`);
        return result;
      }
      // Partial coverage still beats nothing; merge what succeeded.
      console.warn(
        `[PolicyLens] Chunk ${index + 1}/${chunks.length} failed (${result.error}) — ` +
          `merging the ${analyses.length} chunk(s) that succeeded.`
      );
      break;
    }

    analyses.push(result);
  }

  const merged = mergeChunkAnalyses(analyses);

  if (exceededLimit) {
    merged.riskJustification =
      `${merged.riskJustification} (Note: this policy exceeded the ${MAX_CHUNKS}-part analysis limit — ` +
      `only the first ${coveredChars} of ${policyText.length} characters were analyzed.)`.trim();
  }

  console.log(
    `[PolicyLens] Scan complete — ${apiCalls} API call(s) for ${policyText.length} chars ` +
      `(${analyses.length}/${chunks.length} chunk(s) analyzed successfully).`
  );

  return merged;
}
