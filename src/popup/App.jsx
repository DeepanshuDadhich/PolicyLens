import { usePolicyAnalysis } from "./hooks/usePolicyAnalysis.js";
import StatusMessage from "./components/StatusMessage.jsx";
import AnalysisResults from "./components/AnalysisResults.jsx";

const ERROR_MESSAGES = {
  INVALID_KEY: "Your Cerebras API key is invalid or expired.",
  RATE_LIMIT: "Rate limit reached. Try again in a moment.",
  SERVER_ERROR: "Cerebras is temporarily unavailable.",
  NETWORK_ERROR: "Could not reach the extension background.",
  PARSE_ERROR: "Failed to parse the analysis.",
  NO_TEXT: "No policy text could be extracted from this page.",
  BAD_REQUEST: "The analysis request was malformed.",
  UNKNOWN_ERROR: "Something went wrong.",
};

export default function App() {
  const { viewState, analysisPhase, analysis, analysisSource, analysisTimestamp, errorInfo, retry } =
    usePolicyAnalysis();

  return (
    <div className="flex h-[500px] w-[400px] flex-col overflow-y-auto bg-gray-900 text-gray-100">
      <header className="shrink-0 border-b border-gray-800 px-4 py-3">
        <h1 className="text-base font-semibold">PolicyLens</h1>
      </header>

      <main className="flex-1">
        {viewState === "loading" && <StatusMessage icon="⏳" title="Checking this page..." />}

        {viewState === "no-policy" && (
          <StatusMessage
            icon="🔍"
            title="No policy detected"
            message="PolicyLens didn't find a privacy policy or terms of service on this page."
          />
        )}

        {viewState === "no-key" && (
          <StatusMessage
            icon="🔑"
            title="API key required"
            message="Add your Cerebras API key in the extension's settings to start analyzing policies."
          />
        )}

        {viewState === "analyzing" && (
          <StatusMessage
            icon={analysisPhase === "queued" ? "⏸️" : "🧠"}
            title={analysisPhase === "queued" ? "Waiting for rate limit..." : "Analyzing policy..."}
            message={
              analysisPhase === "queued"
                ? "Cerebras allows 5 requests per minute. Your analysis will start shortly."
                : "This usually takes a few seconds."
            }
          />
        )}

        {viewState === "success" && analysis && (
          <AnalysisResults analysis={analysis} source={analysisSource} timestamp={analysisTimestamp} />
        )}

        {viewState === "error" && (
          <StatusMessage
            icon="⚠️"
            title="Analysis failed"
            message={errorInfo?.message || ERROR_MESSAGES[errorInfo?.error] || ERROR_MESSAGES.UNKNOWN_ERROR}
          >
            <button
              type="button"
              onClick={retry}
              className="mt-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
            >
              Retry
            </button>
          </StatusMessage>
        )}
      </main>
    </div>
  );
}
