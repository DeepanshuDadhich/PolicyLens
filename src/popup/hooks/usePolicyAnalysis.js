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
  const [errorInfo, setErrorInfo] = useState(null);
  const tabIdRef = useRef(null);

  const requestAnalysis = useCallback(async () => {
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
      const response = await chrome.runtime.sendMessage({ type: "REQUEST_ANALYSIS", tabId });

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
      console.error("[PolicyLens] REQUEST_ANALYSIS failed:", error);
      setErrorInfo({ error: "NETWORK_ERROR", message: "Could not reach the extension background." });
      setViewState("error");
    }
  }, []);

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

        if (!status?.isPolicy) {
          setViewState("no-policy");
          return;
        }

        if (!status.hasApiKey) {
          setViewState("no-key");
          return;
        }

        await requestAnalysis();
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
  }, [requestAnalysis]);

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

  return { viewState, analysisPhase, analysis, analysisSource, analysisTimestamp, errorInfo, retry: requestAnalysis };
}
