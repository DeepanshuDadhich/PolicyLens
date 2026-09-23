import { useState } from "react";
import AccordionSection from "./AccordionSection.jsx";

function ListItem({ item, renderItem, getIcon }) {
  const [showSource, setShowSource] = useState(false);
  const icon = getIcon?.(item);

  return (
    <li className="rounded-md bg-gray-800 p-3">
      <div className="flex gap-2">
        {icon && (
          <span aria-hidden="true" className="shrink-0">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">{renderItem(item)}</div>
      </div>

      {item.sourceClause && (
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
              &ldquo;{item.sourceClause}&rdquo;
            </blockquote>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Generic titled, collapsible list of quote-backed items. Used for Data
 * Collected, Third-Party Sharing, and Your Rights, which all share the same
 * label + detail + sourceClause shape.
 *
 * `getIcon` is optional: when provided, it's called per item and the
 * returned icon is rendered before that item's content. It's used only by
 * Data Collected today (see AnalysisResults.jsx) — Third-Party Sharing and
 * Your Rights simply omit the prop and render with no icon.
 */
export default function ListSection({ title, emptyText, items, renderItem, getIcon }) {
  return (
    <AccordionSection title={title} count={items.length}>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item, index) => (
            <ListItem key={index} item={item} renderItem={renderItem} getIcon={getIcon} />
          ))}
        </ul>
      )}
    </AccordionSection>
  );
}
