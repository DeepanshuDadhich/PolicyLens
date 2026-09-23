import RiskCard from "./RiskCard.jsx";
import ListSection from "./ListSection.jsx";
import RedFlagsSection from "./RedFlagsSection.jsx";

export default function AnalysisResults({ analysis, source, timestamp, domain }) {
  const { dataCollected, thirdPartySharing, retentionPolicy, userRights, redFlags, riskScore, riskJustification } =
    analysis;

  return (
    <div className="p-4">
      <RiskCard
        riskScore={riskScore}
        riskJustification={riskJustification}
        source={source}
        timestamp={timestamp}
        domain={domain}
      />

      <RedFlagsSection redFlags={redFlags} />

      <ListSection
        title="Data Collected"
        emptyText="No specific data collection described."
        items={dataCollected}
        renderItem={(item) => (
          <>
            <p className="font-medium text-gray-100">{item.category}</p>
            <p className="mt-1 text-sm text-gray-300">{item.details}</p>
            <p className="mt-1 text-xs italic text-gray-500">&ldquo;{item.sourceClause}&rdquo;</p>
          </>
        )}
      />

      <ListSection
        title="Third-Party Sharing"
        emptyText="No third-party sharing described."
        items={thirdPartySharing}
        renderItem={(item) => (
          <>
            <p className="font-medium text-gray-100">{item.recipient}</p>
            <p className="mt-1 text-sm text-gray-300">{item.purpose}</p>
            <p className="mt-1 text-xs italic text-gray-500">&ldquo;{item.sourceClause}&rdquo;</p>
          </>
        )}
      />

      <ListSection
        title="Your Rights"
        emptyText="No user rights described."
        items={userRights}
        renderItem={(item) => (
          <>
            <p className="font-medium text-gray-100">{item.right}</p>
            <p className="mt-1 text-sm text-gray-300">{item.howToExercise}</p>
            <p className="mt-1 text-xs italic text-gray-500">&ldquo;{item.sourceClause}&rdquo;</p>
          </>
        )}
      />

      <section className="mt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Data Retention</h2>
        <div className="mt-2 rounded-md bg-gray-800 p-3">
          <p className="text-sm text-gray-300">{retentionPolicy.summary}</p>
          <p className="mt-1 text-xs italic text-gray-500">&ldquo;{retentionPolicy.sourceClause}&rdquo;</p>
        </div>
      </section>
    </div>
  );
}
