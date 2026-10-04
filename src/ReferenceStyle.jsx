import { useState } from "react";
import { API, saveAll } from "./api";
import ResultGrid from "./ResultGrid";

export default function ReferenceStyle({ images, onBack }) {
  const [ref, setRef] = useState(null);
  const [style, setStyle] = useState(null);
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const pick = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setRef({ file: f, url: URL.createObjectURL(f) });
    setStyle(null);
    setOut(null);
  };

  const post = async (path, label, fd, onOk) => {
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

  const analyze = () => {
    if (!ref) return setError("Pehle reference image choose karo.");
    const fd = new FormData();
    fd.append("reference", ref.file);
    post("/reference-style/analyze-style", "analyze", fd, (d) => setStyle(d.style));
  };

  const apply = () => {
    const files = images.filter((i) => i.file);
    if (!ref) return setError("Pehle reference image choose karo.");
    if (!files.length) return setError("Pehle Studio me images upload karo.");
    const fd = new FormData();
    fd.append("reference", ref.file);
    files.forEach((i) => fd.append("images", i.file, i.name));
    post("/reference-style/apply-reference-style", "apply", fd, setOut);
  };

  const c = style?.averageColor;

  return (
    <div className="tool-page">
      <div className="tool-wrap">
        <div className="tool-top">
          <button className="tool-ghost" onClick={onBack}>← Back to Studio</button>
          <span className="tag">◈ REFERENCE STYLE</span>
        </div>
        <h2>Reference Style</h2>
        <p className="tool-sub">Ek reference image do, poora batch uske color tone me aa jayega.</p>
        {error && <div className="tool-error">{error}</div>}

        <label className="upload-box">
          <input type="file" accept="image/*" onChange={pick} />
          {ref ? <img className="ref-thumb" src={ref.url} alt="reference" /> : <div className="upload-symbol">↑</div>}
          <h3>{ref ? ref.file.name : "Choose reference image"}</h3>
        </label>

        <div className="tool-actions">
          <button className="tool-btn" disabled={!!busy} onClick={analyze}>
            {busy === "analyze" ? "Analyzing..." : "1. Analyze Style"}
          </button>
          <button className="tool-btn" disabled={!!busy} onClick={apply}>
            {busy === "apply" ? "Applying..." : `2. Apply to ${images.length} images`}
          </button>
        </div>

        {style && (
          <div className="tool-card style-row">
            <span className="swatch" style={{ background: `rgb(${c.r},${c.g},${c.b})` }} />
            <div>
              <strong>Tone: {style.tone}</strong>
              <p>Average color rgb({c.r}, {c.g}, {c.b}) · {style.width}×{style.height}</p>
            </div>
          </div>
        )}

        {out && (
          <>
            <ResultGrid results={out.results} images={images} />
            <button className="tool-btn wide" onClick={() => saveAll(out.results, "styled")}>↓ Download All</button>
          </>
        )}
      </div>
    </div>
  );
}
