import { getSeverityColor, getSeverityIcon } from "../../utils/scoring.js";

export default function RedFlagsSection({ redFlags }) {
  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Red Flags</h2>
      {redFlags.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No red flags found.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {redFlags.map((flag, index) => (
            <li
              key={index}
              className="rounded-md border-l-4 bg-gray-800 p-3"
              style={{ borderColor: getSeverityColor(flag.severity) }}
            >
              <p className="flex items-center gap-2 font-medium text-gray-100">
                <span aria-hidden="true">{getSeverityIcon(flag.severity)}</span>
                {flag.flag}
              </p>
              <p className="mt-1 text-sm text-gray-300">{flag.explanation}</p>
              <p className="mt-1 text-xs italic text-gray-500">&ldquo;{flag.sourceClause}&rdquo;</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
