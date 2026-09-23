const CACHE_KEY_PREFIX = "policy_cache_";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EVICTION_BATCH_SIZE = 5;

function buildCacheKey(domain, textHash) {
  return `${CACHE_KEY_PREFIX}${domain}_${textHash}`;
}

/**
 * Returns [key, entry] pairs for every cached analysis currently stored,
 * regardless of domain or hash.
 */
async function getAllCacheEntries() {
  const allItems = await chrome.storage.local.get(null);
  return Object.entries(allItems).filter(([key]) => key.startsWith(CACHE_KEY_PREFIX));
}

/**
 * Removes the oldest `count` cache entries by timestamp, to make room when
 * chrome.storage.local's quota is exceeded.
 */
async function evictOldestEntries(count) {
  const entries = await getAllCacheEntries();
  const oldestKeys = entries
    .sort((a, b) => (a[1]?.timestamp ?? 0) - (b[1]?.timestamp ?? 0))
    .slice(0, count)
    .map(([key]) => key);

  if (oldestKeys.length > 0) {
    await chrome.storage.local.remove(oldestKeys);
  }
}

/**
 * Looks up a cached analysis for the given domain + policy text hash.
 * Returns { analysis, timestamp } on a hit, or null on a miss or if the
 * cached entry is older than the 30-day TTL (an expired entry is
 * opportunistically deleted rather than left behind).
 */
export async function getCachedAnalysis(domain, textHash) {
  const key = buildCacheKey(domain, textHash);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];

  if (!entry) {
    return null;
  }

  const isExpired = Date.now() - entry.timestamp > CACHE_TTL_MS;
  if (isExpired) {
    chrome.storage.local.remove(key).catch(() => {});
    return null;
  }

  return { analysis: entry.analysis, timestamp: entry.timestamp };
}

/**
 * Caches an analysis result for the given domain + policy text hash. If
 * chrome.storage.local's 10MB quota is exceeded, evicts the 5 oldest
 * entries across all domains and retries once before giving up.
 */
export async function setCachedAnalysis(domain, textHash, analysis) {
  const key = buildCacheKey(domain, textHash);
  const entry = { analysis, timestamp: Date.now(), domain, textHash };

  try {
    await chrome.storage.local.set({ [key]: entry });
  } catch (error) {
    console.warn("[PolicyLens] Cache write failed, evicting oldest entries and retrying:", error);
    await evictOldestEntries(EVICTION_BATCH_SIZE);

    try {
      await chrome.storage.local.set({ [key]: entry });
    } catch (retryError) {
      console.error("[PolicyLens] Cache write failed again after eviction, giving up:", retryError);
    }
  }
}

/**
 * Removes every cached entry for a domain, regardless of which policy text
 * hashes were cached under it. Used by the "Re-analyze" button so a fresh
 * analysis isn't served the old cached result.
 */
export async function clearCacheForDomain(domain) {
  const entries = await getAllCacheEntries();
  const keysForDomain = entries
    .filter(([, entry]) => entry?.domain === domain)
    .map(([key]) => key);

  if (keysForDomain.length > 0) {
    await chrome.storage.local.remove(keysForDomain);
  }
}

/**
 * Returns cache size info for the options page: how many analyses are
 * cached and how much storage they occupy.
 */
export async function getCacheStats() {
  const entries = await getAllCacheEntries();
  const keys = entries.map(([key]) => key);

  if (keys.length === 0) {
    return { totalEntries: 0, totalSizeKB: 0 };
  }

  const bytesInUse = await chrome.storage.local.getBytesInUse(keys);

  return {
    totalEntries: keys.length,
    totalSizeKB: Math.round((bytesInUse / 1024) * 100) / 100,
  };
}
