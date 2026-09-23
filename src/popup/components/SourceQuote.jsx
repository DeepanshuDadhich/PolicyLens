import { useState } from "react";

/**
 * "View source"/"Hide source" toggle that reveals a recessed quote block.
 * Shared by ListSection, RetentionInfo, and RedFlagsSection, which all need
 * the identical sourceClause disclosure — extracted here so the styling
 * only has one place to change.
 */
export default function SourceQuote({ text }) {
  const [showSource, setShowSource] = useState(false);

  if (!text) {
    return null;
  }

  return (
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
          &ldquo;{text}&rdquo;
        </blockquote>
      )}
    </div>
  );
}
