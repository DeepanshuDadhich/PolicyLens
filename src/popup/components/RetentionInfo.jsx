import SourceQuote from "./SourceQuote.jsx";

/**
 * Non-collapsible retention summary block. Its "View source" disclosure
 * uses the same recessed quote-block styling as ListSection's per-item
 * toggle (bg-gray-900/60, left border accent, italic) for visual
 * consistency across the popup.
 */
export default function RetentionInfo({ retentionPolicy }) {
  const { summary, sourceClause } = retentionPolicy;

  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">⏱️ Data Retention</h2>
      <div className="mt-2 rounded-md bg-gray-800 p-3">
        <p className="text-sm text-gray-300">{summary}</p>

        <SourceQuote text={sourceClause} />
      </div>
    </section>
  );
}
