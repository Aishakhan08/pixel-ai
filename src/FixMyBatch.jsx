import { useState } from "react";
import { API, saveAll } from "./api";
import ResultGrid from "./ResultGrid";

export default function FixMyBatch({ images, onBack }) {
  const [report, setReport] = useState(null);
  const [fixed, setFixed] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const call = async (path, label, onOk) => {
    const files = images.filter((i) => i.file);
    if (!files.length) return setError("Pehle Studio me images upload karo.");
    const fd = new FormData();
    files.forEach((i) => fd.append("files", i.file, i.name));
    setBusy(label);
    setError("");
    try {
      const res = await fetch(`${API}${path}`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(res.status);
      onOk(await res.json());
    } catch {
      setError(`Backend se connect nahi hua (${API}). Backend chal raha hai?`);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="tool-page">
      <div className="tool-wrap">
        <div className="tool-top">
          <button className="tool-ghost" onClick={onBack}>← Back to Studio</button>
          <span className="tag">✨ FIX MY BATCH</span>
        </div>
        <h2>Fix My Batch</h2>
        <p className="tool-sub">{images.length} images selected. Pehle analyze karo, phir fix.</p>
        {error && <div className="tool-error">{error}</div>}

        <div className="tool-actions">
          <button className="tool-btn" disabled={!!busy} onClick={() => call("/fix-batch/analyze", "analyze", setReport)}>
            {busy === "analyze" ? "Analyzing..." : "1. Analyze Batch"}
          </button>
          <button className="tool-btn" disabled={!!busy} onClick={() => call("/fix-batch/fix", "fix", setFixed)}>
            {busy === "fix" ? "Fixing..." : "2. Fix Batch"}
          </button>
        </div>

        {report && (
          <div className="tool-card">
            <strong>{report.message}</strong>
            {report.improvements.map((p) => (
              <div className="issue" key={p.type}>
                <span className={`sev ${p.severity}`}>{p.severity}</span>
                <div><b>{p.title}</b><p>{p.description}</p></div>
              </div>
            ))}
          </div>
        )}

        {fixed && (
          <>
            <div className="tool-card">
              <strong>{fixed.processedImages} images fixed · Consistency {fixed.consistencyScore}%</strong>
            </div>
            <ResultGrid results={fixed.results} images={images} />
            <button className="tool-btn wide" onClick={() => saveAll(fixed.results, "fixed")}>↓ Download All</button>
          </>
        )}
      </div>
    </div>
  );
}
