import { absUrl } from "./api";

export default function ResultGrid({ results, images }) {
  return (
    <div className="tool-results">
      {results.map((r, i) => {
        const before = images.find((img) => img.name === r.originalName);
        return (
          <div className="tool-result" key={i}>
            <div className="tool-pair">
              <div><small>BEFORE</small>{before && <img src={before.url} alt="before" />}</div>
              <div><small>AFTER</small><img src={absUrl(r.outputUrl)} alt="after" /></div>
            </div>
            <p>{r.originalName}</p>
          </div>
        );
      })}
    </div>
  );
}
