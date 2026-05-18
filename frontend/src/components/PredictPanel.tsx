import { useEffect, useMemo, useState } from "react";
import { fetchModelInfo, predictDemand } from "../api/client";
import { translations } from "../i18n";
import type { ModelInfoResponse } from "../types/ml";
import type { CoordinateMatch } from "../types/selection";
import type { Language } from "../i18n";

function formatPrediction(value: number | string | unknown[]) {
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 3,
    }).format(value);
  }

  return Array.isArray(value) ? JSON.stringify(value) : value;
}

export function PredictPanel({
  language,
  resetVersion,
  selection,
}: {
  language: Language;
  resetVersion: number;
  selection: CoordinateMatch | null;
}) {
  const t = translations[language];
  const [modelInfo, setModelInfo] = useState<ModelInfoResponse | null>(null);
  const [prediction, setPrediction] = useState<number | string | unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canPredict = Boolean(selection?.provinceNumber);

  useEffect(() => {
    void fetchModelInfo()
      .then(setModelInfo)
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : t.modelInfoFailed);
      });
  }, [t.modelInfoFailed]);

  useEffect(() => {
    setPrediction(null);
    setError(null);
  }, [resetVersion, selection?.provinceNumber]);

  const modelStatus = useMemo(() => {
    if (!modelInfo) {
      return t.checkingModel;
    }

    return modelInfo.model_exists ? t.modelReady : t.modelFileMissing;
  }, [modelInfo, t.checkingModel, t.modelFileMissing, t.modelReady]);

  async function handlePredict() {
    if (!selection?.provinceNumber) {
      return;
    }

    setError(null);
    setPrediction(null);
    setIsLoading(true);

    try {
      const response = await predictDemand({
        province_number: selection.provinceNumber,
      });
      setPrediction(response.prediction);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t.predictionFailed);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="predict-panel" aria-label={t.mlPredict}>
      <div className="predict-header">
        <div>
          <h2>{t.mlPredict}</h2>
          <span>{modelStatus}</span>
        </div>
        {prediction !== null ? (
          <strong className="predict-result">{formatPrediction(prediction)}</strong>
        ) : null}
      </div>
      <p className="predict-help">
        {canPredict
          ? `${selection?.regionName ?? t.province}: ${t.mlPredictHelp}`
          : t.selectProvinceForPrediction}
      </p>

      {error ? <p className="predict-error">{error}</p> : null}

      <button
        className="predict-submit"
        disabled={!canPredict || isLoading}
        type="button"
        onClick={handlePredict}
      >
        {isLoading ? t.predicting : t.predict}
      </button>
    </section>
  );
}
