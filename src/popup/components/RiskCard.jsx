import { getScoreColor, getScoreLabel, getScoreDescription, formatCachedDate } from "../../utils/scoring.js";

export default function RiskCard({ riskScore, riskJustification, source, timestamp }) {
  const color = getScoreColor(riskScore);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="flex items-center gap-4">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-3xl font-bold text-gray-900"
          style={{ backgroundColor: color }}
        >
          {riskScore}
        </div>
        <div>
          <p className="text-lg font-semibold" style={{ color }}>
            {getScoreLabel(riskScore)}
          </p>
          <p className="text-sm text-gray-300">{getScoreDescription(riskScore)}</p>
        </div>
      </div>

      <p className="mt-3 text-sm text-gray-300">{riskJustification}</p>

      {source === "cache" && (
        <span className="mt-3 inline-block rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-400">
          {Number.isFinite(timestamp) ? formatCachedDate(timestamp) : "Cached result"}
        </span>
      )}
    </div>
  );
}
