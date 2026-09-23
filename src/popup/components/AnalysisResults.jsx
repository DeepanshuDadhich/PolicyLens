import RiskCard from "./RiskCard.jsx";
import ListSection from "./ListSection.jsx";
import RedFlagsSection from "./RedFlagsSection.jsx";
import RetentionInfo from "./RetentionInfo.jsx";

// Data-Collected-specific: maps a free-text category (as written by the
// model, e.g. "Precise location data") to a representative icon. This only
// makes sense for dataCollected items — thirdPartySharing/userRights have
// no comparable "category" concept, so ListSection's getIcon prop is left
// unset for those two sections.
const CATEGORY_ICON_KEYWORDS = [
  { keyword: "location", icon: "📍" },
  { keyword: "browsing", icon: "🌐" },
  { keyword: "history", icon: "🌐" },
  { keyword: "device", icon: "📱" },
  { keyword: "email", icon: "✉️" },
  { keyword: "name", icon: "👤" },
  { keyword: "identity", icon: "👤" },
  { keyword: "financial", icon: "💳" },
  { keyword: "payment", icon: "💳" },
  { keyword: "health", icon: "❤️" },
  { keyword: "medical", icon: "❤️" },
  { keyword: "biometric", icon: "❤️" },
];

function getDataCollectedIcon(item) {
  const category = item.category?.toLowerCase() ?? "";
  const match = CATEGORY_ICON_KEYWORDS.find(({ keyword }) => category.includes(keyword));
  return match ? match.icon : "📄";
}

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
        getIcon={getDataCollectedIcon}
        renderItem={(item) => (
          <>
            <p className="font-medium text-gray-100">{item.category}</p>
            <p className="mt-1 text-sm text-gray-300">{item.details}</p>
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
          </>
        )}
      />

      <RetentionInfo retentionPolicy={retentionPolicy} />
    </div>
  );
}
