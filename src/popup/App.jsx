import { useEffect, useState } from "react";

export default function App() {
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    chrome.storage?.local.get("policylens:lastScan", (result) => {
      if (result["policylens:lastScan"]) {
        setStatus("scanned");
      }
    });
  }, []);

  return (
    <div className="p-4 font-sans">
      <h1 className="text-lg font-semibold text-slate-900">PolicyLens</h1>
      <p className="mt-1 text-sm text-slate-500">Status: {status}</p>
    </div>
  );
}
