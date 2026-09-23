import { useEffect, useState } from "react";
import { getScoreColor, getScoreLabel, formatCachedDate } from "../../utils/scoring.js";

export default function RiskCard({ riskScore, riskJustification, source, timestamp, domain }) {
  const color = getScoreColor(riskScore);

  // Fade-in/scale-up the score badge on mount. requestAnimationFrame
  // guarantees the browser paints the "before" state first, so the
  // transition to the "after" state actually animates.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-4xl font-bold text-white transition-all duration-300 ease-out ${
            isMounted ? "scale-100 opacity-100" : "scale-75 opacity-0"
          }`}
          style={{ backgroundColor: color }}
        >
          {riskScore}
        </div>
        <div>
          <p className="font-bold text-white">{domain}</p>
          <p className="text-sm font-medium" style={{ color }}>
            {getScoreLabel(riskScore)}
          </p>
        </div>
      </div>

      <p className="mt-3 truncate text-sm text-gray-400">{riskJustification}</p>

      <div className="mt-3 h-1.5 w-full rounded-full" style={{ backgroundColor: color }} />

      {source === "cache" && (
        <span className="mt-3 inline-block rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-400">
          {Number.isFinite(timestamp) ? formatCachedDate(timestamp) : "Cached result"}
        </span>
      )}
    </div>
  );
}
