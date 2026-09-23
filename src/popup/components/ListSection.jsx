/**
 * Generic titled list of quote-backed items. Used for Data Collected,
 * Third-Party Sharing, and Your Rights, which all share the same
 * label + detail + sourceClause shape.
 */
export default function ListSection({ title, emptyText, items, renderItem }) {
  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{emptyText}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {items.map((item, index) => (
            <li key={index} className="rounded-md bg-gray-800 p-3">
              {renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
