import type { CoordinateMatch } from "../types/selection";

export function SelectionSummary({
  selection,
}: {
  selection: CoordinateMatch | null;
}) {
  return (
    <section className="summary-panel" aria-label="Selection summary">
      <div className="summary-header">
        <h2>Selection</h2>
        <span>{selection?.regionName ? "Inside Turkey" : "No region"}</span>
      </div>

      {selection ? (
        <div className="summary-content">
          <div className="summary-primary">
            <strong>{selection.regionName ?? "Outside Turkey"}</strong>
            <span>
              {selection.provinceNumber
                ? `Province ${selection.provinceNumber}`
                : "Point is outside mapped provinces"}
            </span>
          </div>

          <dl className="summary-grid">
            <div>
              <dt>Latitude</dt>
              <dd>{selection.latitude.toFixed(6)}</dd>
            </div>
            <div>
              <dt>Longitude</dt>
              <dd>{selection.longitude.toFixed(6)}</dd>
            </div>
            <div>
              <dt>Region status</dt>
              <dd>{selection.regionName ? "Matched" : "Not matched"}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="summary-empty">Pick a point on the map to see its summary.</p>
      )}
    </section>
  );
}
