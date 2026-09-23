import { getSeverityColor, getSeverityIcon } from "../../utils/scoring.js";
import AccordionSection from "./AccordionSection.jsx";
import SourceQuote from "./SourceQuote.jsx";

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function FlagCard({ flag }) {
  const color = getSeverityColor(flag.severity);

  return (
    <li className="flex gap-3 rounded-md bg-gray-800 p-3">
      <div className="flex shrink-0 flex-col items-center gap-1" style={{ color }}>
        <span aria-hidden="true">{getSeverityIcon(flag.severity)}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide">{flag.severity}</span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-bold text-white">{flag.flag}</p>
        <p className="mt-1 text-sm text-gray-400">{flag.explanation}</p>

        <SourceQuote text={flag.sourceClause} />
      </div>
    </li>
  );
}

export default function RedFlagsSection({ redFlags }) {
  if (redFlags.length === 0) {
    return <p className="mt-4 text-sm text-green-400">✅ No red flags found — this policy looks clean!</p>;
  }

  const hasHighSeverity = redFlags.some((flag) => flag.severity === "high");
  const sortedFlags = [...redFlags].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
  );

  return (
    <AccordionSection
      defaultOpen
      title={
        <span className="flex items-center gap-2">
          <span>⚠️ Red Flags</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-xs font-normal normal-case tracking-normal ${
              hasHighSeverity ? "bg-red-600 text-white" : "bg-gray-700 text-gray-300"
            }`}
          >
            {redFlags.length}
          </span>
        </span>
      }
    >
      <ul className="space-y-3">
        {sortedFlags.map((flag, index) => (
          <FlagCard key={index} flag={flag} />
        ))}
      </ul>
    </AccordionSection>
  );
}
