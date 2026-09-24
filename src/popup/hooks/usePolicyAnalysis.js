import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives the popup's state machine end-to-end:
 *   loading -> no-policy | no-key | analyzing -> success | error
 *
 * Talks to the background service worker via chrome.runtime messaging only —
 * no direct DOM/tab access beyond resolving the active tab's id once on mount.
 */
export function usePolicyAnalysis() {
  const [viewState, setViewState] = useState("loading");
  const [analysisPhase, setAnalysisPhase] = useState(null); // 'queued' | 'analyzing' | null
  const [analysis, setAnalysis] = useState(null);
  const [analysisSource, setAnalysisSource] = useState(null); // 'fresh' | 'cache' | null
  const [analysisTimestamp, setAnalysisTimestamp] = useState(null); // cache write time, only set when source === 'cache'
  const [domain, setDomain] = useState(null);
  const [errorInfo, setErrorInfo] = useState(null);
  const tabIdRef = useRef(null);

  // messageType is either "REQUEST_ANALYSIS" (cache-aware) or "RE_ANALYZE"
  // (clears this domain's cache first, forcing a fresh API call).
  const runAnalysisRequest = useCallback(async (messageType) => {
    const tabId = tabIdRef.current;
    if (tabId == null) {
      return;
    }

    setViewState("analyzing");
    setAnalysisPhase("analyzing");
    setAnalysisSource(null);
    setAnalysisTimestamp(null);
    setErrorInfo(null);

    try {
      const response = await chrome.runtime.sendMessage({ type: messageType, tabId });

      if (response?.status === "error" && response.error === "NO_KEY") {
        setViewState("no-key");
        return;
      }

      if (response?.error) {
        setErrorInfo({ error: response.error, message: response.message });
        setViewState("error");
        return;
      }

      setAnalysis(response);
      // The ANALYSIS_STATE_CHANGED listener below usually sets this first
      // (it carries `source`, the raw sendMessage response doesn't) — only
      // fall back to "fresh" here if that broadcast hasn't landed yet.
      setAnalysisSource((prev) => prev ?? "fresh");
      setViewState("success");
    } catch (error) {
      console.error(`[PolicyLens] ${messageType} failed:`, error);
      setErrorInfo({ error: "NETWORK_ERROR", message: "Could not reach the extension background." });
      setViewState("error");
    }
  }, []);

  // Wrapped as zero-arg callbacks so passing them straight to onClick can't
  // leak the click event in as the messageType argument.
  const retry = useCallback(() => runAnalysisRequest("REQUEST_ANALYSIS"), [runAnalysisRequest]);
  const reAnalyze = useCallback(() => runAnalysisRequest("RE_ANALYZE"), [runAnalysisRequest]);

  useEffect(() => {
    let isCancelled = false;

    async function init() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (isCancelled) return;

        if (!tab?.id) {
          setErrorInfo({ error: "NO_TAB", message: "Could not determine the active tab." });
          setViewState("error");
          return;
        }
        tabIdRef.current = tab.id;

        const status = await chrome.runtime.sendMessage({ type: "GET_STATUS", tabId: tab.id });
        if (isCancelled) return;

        setDomain(status?.domain ?? null);

        if (!status?.isPolicy) {
          setViewState("no-policy");
          return;
        }

        if (!status.hasApiKey) {
          setViewState("no-key");
          return;
        }

        await runAnalysisRequest("REQUEST_ANALYSIS");
      } catch (error) {
        if (isCancelled) return;
        console.error("[PolicyLens] Failed to initialize popup:", error);
        setErrorInfo({ error: "NETWORK_ERROR", message: "Could not reach the extension background." });
        setViewState("error");
      }
    }

    init();

    return () => {
      isCancelled = true;
    };
  }, [runAnalysisRequest]);

  useEffect(() => {
    function handleMessage(message) {
      if (message?.type !== "ANALYSIS_STATE_CHANGED" || message.tabId !== tabIdRef.current) {
        return;
      }

      const state = message.state;
      if (!state) return;

      if (state.status === "queued") {
        setAnalysisPhase("queued");
      } else if (state.status === "analyzing") {
        setAnalysisPhase("analyzing");
      } else if (state.status === "done") {
        setAnalysis(state.analysis);
        setAnalysisSource(state.source ?? "fresh");
        setAnalysisTimestamp(state.timestamp ?? null);
        setViewState("success");
      } else if (state.status === "error") {
        setErrorInfo({ error: state.error, message: state.message });
        setViewState("error");
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  return {
    viewState,
    analysisPhase,
    analysis,
    analysisSource,
    analysisTimestamp,
    domain,
    errorInfo,
    retry,
    reAnalyze,
  };
}
