import { usePolicyAnalysis } from "./hooks/usePolicyAnalysis.js";
import StatusMessage from "./components/StatusMessage.jsx";
import AnalysisResults from "./components/AnalysisResults.jsx";
import LoadingState from "./components/LoadingState.jsx";
import ErrorState from "./components/ErrorState.jsx";
import NoPolicyState from "./components/NoPolicyState.jsx";
import Footer from "./components/Footer.jsx";

export default function App() {
  const { viewState, analysisPhase, analysis, analysisSource, analysisTimestamp, domain, errorInfo, retry, reAnalyze } =
    usePolicyAnalysis();

  return (
    <div className="flex h-[500px] w-[400px] flex-col overflow-hidden bg-gray-900 text-gray-100">
      <header className="shrink-0 border-b border-gray-800 px-4 py-3">
        <h1 className="text-base font-semibold">PolicyLens</h1>
      </header>

      <main className="scrollbar-hide flex-1 overflow-y-auto scroll-smooth">
        {viewState === "loading" && <StatusMessage icon="⏳" title="Checking this page..." />}

        {viewState === "no-policy" && <NoPolicyState />}

        {viewState === "no-key" && (
          <ErrorState
            errorType="NO_KEY"
            message="Add your Cerebras API key to start analyzing policies."
            onRetry={retry}
          />
        )}

        {viewState === "analyzing" && <LoadingState phase={analysisPhase} />}

        {viewState === "success" && analysis && (
          <AnalysisResults analysis={analysis} source={analysisSource} timestamp={analysisTimestamp} domain={domain} />
        )}

        {viewState === "error" && (
          <ErrorState errorType={errorInfo?.error} message={errorInfo?.message} onRetry={retry} />
        )}
      </main>

      {viewState === "success" && (
        <Footer source={analysisSource} timestamp={analysisTimestamp} onReAnalyze={reAnalyze} />
      )}
    </div>
  );
}
