import { openOptionsPage } from "../../utils/options.js";

// Per-error-type presentation. `action: "options"` opens the extension's
// options page instead of retrying — used for key-related errors where
// retrying the same request can't possibly help.
const ERROR_CONFIG = {
  NO_KEY: { icon: "🔑", title: "API key required", buttonLabel: "Set up API key →", action: "options" },
  INVALID_KEY: { icon: "🔑", title: "Invalid API key", buttonLabel: "Set up API key →", action: "options" },
  RATE_LIMIT: { icon: "🕐", title: "Rate limit reached", buttonLabel: "Try again", action: "retry" },
  // No button: retrying can't possibly help until the daily quota resets
  // tomorrow, unlike RATE_LIMIT's per-minute wait above.
  DAILY_LIMIT: { icon: "📅", title: "Daily limit reached", buttonLabel: null, action: "none" },
  BAD_REQUEST: { icon: "⚠️", title: "Request failed", buttonLabel: "Retry", action: "retry" },
  SERVER_ERROR: { icon: "⚠️", title: "Server unavailable", buttonLabel: "Retry", action: "retry" },
  PARSE_ERROR: { icon: "🐛", title: "Couldn't parse the analysis", buttonLabel: "Re-analyze", action: "retry" },
  NETWORK_ERROR: { icon: "🔌", title: "Connection failed", buttonLabel: "Retry", action: "retry" },
  UNKNOWN_ERROR: { icon: "⚠️", title: "Something went wrong", buttonLabel: "Retry", action: "retry" },
  // NO_TEXT/NO_TAB indicate an unexpected internal state rather than a
  // normal failure a user should have to reason about, so they get a
  // deliberately generic, low-key treatment rather than surfacing the raw
  // internal message.
  NO_TEXT: { icon: "⚠️", title: "Something went wrong", buttonLabel: "Retry", action: "retry" },
  NO_TAB: { icon: "⚠️", title: "Something went wrong", buttonLabel: "Retry", action: "retry" },
};

const DEFAULT_CONFIG = ERROR_CONFIG.UNKNOWN_ERROR;

const GENERIC_MESSAGE_OVERRIDES = {
  NO_TEXT: "Couldn't read this page. Try reopening the popup.",
  NO_TAB: "Couldn't detect the current tab. Try reopening the popup.",
};

export default function ErrorState({ errorType, message, onRetry }) {
  const config = ERROR_CONFIG[errorType] ?? DEFAULT_CONFIG;
  const displayMessage = GENERIC_MESSAGE_OVERRIDES[errorType] ?? message ?? "Something went wrong.";

  const handleAction = () => {
    if (config.action === "options") {
      openOptionsPage();
    } else {
      onRetry?.();
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-4xl">{config.icon}</div>
      <p className="text-base font-semibold text-gray-100">{config.title}</p>
      <p className="text-sm text-gray-400">{displayMessage}</p>
      {config.buttonLabel && (
        <button
          type="button"
          onClick={handleAction}
          className="mt-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
        >
          {config.buttonLabel}
        </button>
      )}
    </div>
  );
}
