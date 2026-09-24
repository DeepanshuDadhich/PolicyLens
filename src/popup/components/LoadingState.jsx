import { useEffect, useState } from "react";

const PROGRESS_MESSAGES = [
  "Reading the fine print so you don't have to...",
  "Scanning for data collection practices...",
  "Checking who they share your data with...",
  "Looking for red flags...",
  "Almost done...",
];

const MESSAGE_INTERVAL_MS = 2000;

function useCyclingMessage(messages, intervalMs, isActive) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isActive) return undefined;
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [messages, intervalMs, isActive]);

  return messages[index];
}

function SkeletonBlock({ className }) {
  return <div className={`animate-pulse rounded bg-gray-700 ${className}`} />;
}

function RiskCardSkeleton() {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-gray-700" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-4 w-1/2" />
          <SkeletonBlock className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonBlock className="mt-3 h-3 w-full" />
      <SkeletonBlock className="mt-3 h-1.5 w-full" />
    </div>
  );
}

function ListSectionSkeleton() {
  return (
    <div className="mt-4">
      <SkeletonBlock className="h-4 w-32" />
      <div className="mt-2 space-y-3">
        <div className="rounded-md bg-gray-800 p-3">
          <SkeletonBlock className="h-4 w-2/3" />
          <SkeletonBlock className="mt-2 h-3 w-full" />
        </div>
        <div className="rounded-md bg-gray-800 p-3">
          <SkeletonBlock className="h-4 w-1/2" />
          <SkeletonBlock className="mt-2 h-3 w-5/6" />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the popup's two "in progress" sub-states, matching the hook's
 * analysisPhase value:
 *   - 'analyzing': a skeleton mimicking the real results layout, with a
 *     progress message that cycles every 2s.
 *   - 'queued': a calmer, static message — this can last up to a minute
 *     (5 requests/min rate limit), so cycling fake progress here would be
 *     misleading rather than reassuring.
 */
export default function LoadingState({ phase }) {
  const message = useCyclingMessage(PROGRESS_MESSAGES, MESSAGE_INTERVAL_MS, phase === "analyzing");

  if (phase === "queued") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-4xl">⏸️</div>
        <p className="text-base font-semibold text-gray-100">Waiting for rate limit...</p>
        <p className="text-sm text-gray-400">
          Cerebras allows 5 requests per minute. Your analysis will start shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <RiskCardSkeleton />
      <ListSectionSkeleton />
      <ListSectionSkeleton />
      <p className="mt-4 text-center text-sm text-gray-400">{message}</p>
    </div>
  );
}
