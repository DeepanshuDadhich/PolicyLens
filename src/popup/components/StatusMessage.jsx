/**
 * Generic centered icon/title/message layout, reused for every non-results
 * view (loading, no-policy, no-key, analyzing, error).
 */
export default function StatusMessage({ icon, title, message, children }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-4xl">{icon}</div>
      <p className="text-base font-semibold text-gray-100">{title}</p>
      {message && <p className="text-sm text-gray-400">{message}</p>}
      {children}
    </div>
  );
}
