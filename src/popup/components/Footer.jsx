import { formatCachedDate } from "../../utils/scoring.js";
import { openOptionsPage } from "../../utils/options.js";

/**
 * Sticky bottom bar shown only alongside a successful analysis: cache
 * provenance on the left, re-analyze and settings actions on the right.
 */
export default function Footer({ source, timestamp, onReAnalyze }) {
  return (
    <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-800 bg-gray-900 px-4 py-2">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-400">
        {source === "cache" ? (
          // formatCachedDate() already returns a "Cached ..." prefixed
          // string, so it isn't prefixed again here.
          <span className="truncate">
            {Number.isFinite(timestamp) ? formatCachedDate(timestamp) : "Cached result"}
          </span>
        ) : (
          <>
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
            <span className="truncate">Just analyzed</span>
          </>
        )}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onReAnalyze}
          className="rounded-md px-2 py-1 text-xs font-medium text-teal-400 transition-colors hover:bg-gray-800 hover:text-teal-300"
        >
          🔄 Re-analyze
        </button>
        <button
          type="button"
          onClick={openOptionsPage}
          aria-label="Settings"
          title="Settings"
          className="rounded-md px-2 py-1 text-sm transition-colors hover:bg-gray-800"
        >
          ⚙️
        </button>
      </div>
    </footer>
  );
}
