const SCORE_COLORS = {
  A: "#22C55E",
  B: "#14B8A6",
  C: "#EAB308",
  D: "#F97316",
  F: "#EF4444",
};

const SCORE_LABELS = {
  A: "Excellent",
  B: "Good",
  C: "Fair",
  D: "Poor",
  F: "Critical",
};

const SCORE_DESCRIPTIONS = {
  A: "This site respects your privacy.",
  B: "Mostly privacy-friendly with minor concerns.",
  C: "Significant data collection and sharing practices.",
  D: "Extensive data collection with weak user protections.",
  F: "Serious privacy concerns — read carefully.",
};

const SEVERITY_COLORS = {
  high: "#EF4444",
  medium: "#F97316",
  low: "#EAB308",
};

const SEVERITY_ICONS = {
  high: "🔴",
  medium: "🟠",
  low: "🟡",
};

const FALLBACK_COLOR = "#6B7280";

export function getScoreColor(score) {
  return SCORE_COLORS[score] ?? FALLBACK_COLOR;
}

export function getScoreLabel(score) {
  return SCORE_LABELS[score] ?? "Unknown";
}

export function getScoreDescription(score) {
  return SCORE_DESCRIPTIONS[score] ?? "No assessment available.";
}

export function getSeverityColor(severity) {
  return SEVERITY_COLORS[severity] ?? FALLBACK_COLOR;
}

export function getSeverityIcon(severity) {
  return SEVERITY_ICONS[severity] ?? "⚪";
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function pluralize(count, unit) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * Formats a Unix timestamp (ms) as a friendly relative-or-absolute string
 * for display next to a cached analysis, e.g. "Cached 2 hours ago" or
 * "Cached on Sep 20".
 */
export function formatCachedDate(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "Cached date unknown";
  }

  const diffMs = Date.now() - timestamp;

  if (diffMs < MINUTE_MS) {
    return "Cached just now";
  }

  if (diffMs < HOUR_MS) {
    return `Cached ${pluralize(Math.floor(diffMs / MINUTE_MS), "minute")} ago`;
  }

  if (diffMs < DAY_MS) {
    return `Cached ${pluralize(Math.floor(diffMs / HOUR_MS), "hour")} ago`;
  }

  if (diffMs < WEEK_MS) {
    return `Cached ${pluralize(Math.floor(diffMs / DAY_MS), "day")} ago`;
  }

  const date = new Date(timestamp);
  const now = new Date();
  const options =
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };

  return `Cached on ${date.toLocaleDateString("en-US", options)}`;
}
