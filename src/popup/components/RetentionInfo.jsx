import { useState } from "react";

/**
 * Non-collapsible retention summary block. Its "View source" disclosure
 * uses the same recessed quote-block styling as ListSection's per-item
 * toggle (bg-gray-900/60, left border accent, italic) for visual
 * consistency across the popup.
 */
export default function RetentionInfo({ retentionPolicy }) {
  const [showSource, setShowSource] = useState(false);
  const { summary, sourceClause } = retentionPolicy;

  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">⏱️ Data Retention</h2>
      <div className="mt-2 rounded-md bg-gray-800 p-3">
        <p className="text-sm text-gray-300">{summary}</p>

        {sourceClause && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowSource((prev) => !prev)}
              className="text-xs font-medium text-teal-400 hover:text-teal-300"
            >
              {showSource ? "Hide source" : "View source"}
            </button>

            {showSource && (
              <blockquote className="mt-2 border-l-2 border-gray-600 bg-gray-900/60 px-3 py-2 text-xs italic text-gray-400">
                &ldquo;{sourceClause}&rdquo;
              </blockquote>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
