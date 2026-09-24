export default function NoPolicyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-4xl">🛡️</div>
      <p className="text-base font-semibold text-gray-100">No privacy policy detected</p>
      <p className="text-sm text-gray-400">
        Navigate to a privacy policy or terms of service page, then reopen PolicyLens.
      </p>
    </div>
  );
}
