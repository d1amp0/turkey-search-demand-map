import { useEffect, useMemo, useState } from "react";
import { fetchModelInfo, predictDemandRecursive } from "../api/client";
import { translations } from "../i18n";
import type {
  ModelInfoResponse,
  PredictionWindow,
  RecursivePredictionPoint,
} from "../types/ml";
import type { CoordinateMatch } from "../types/selection";
import type { Language } from "../i18n";
import { canPredictProvince } from "../types/prediction";

export function PredictPanel({
  language,
  predictionWindow,
  resetVersion,
  selection,
  onPredictionsChange,
  onPredictionLoadingChange,
}: {
  language: Language;
  predictionWindow: PredictionWindow;
  resetVersion: number;
  selection: CoordinateMatch | null;
  onPredictionsChange: (points: RecursivePredictionPoint[]) => void;
  onPredictionLoadingChange: (isLoading: boolean) => void;
}) {
  const t = translations[language];
  const [modelInfo, setModelInfo] = useState<ModelInfoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isProvinceAllowed = canPredictProvince(selection?.provinceNumber);
  const canPredict = Boolean(selection?.provinceNumber && predictionWindow && isProvinceAllowed);

  useEffect(() => {
    void fetchModelInfo()
      .then(setModelInfo)
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : t.modelInfoFailed);
      });
  }, [t.modelInfoFailed]);

  useEffect(() => {
    setError(null);
    onPredictionsChange([]);
  }, [onPredictionsChange, predictionWindow, resetVersion, selection?.provinceNumber]);

  useEffect(() => () => onPredictionLoadingChange(false), [onPredictionLoadingChange]);

  const modelStatus = useMemo(() => {
    if (!modelInfo) {
      return t.checkingModel;
    }

    return modelInfo.model_exists ? t.modelReady : t.modelFileMissing;
  }, [modelInfo, t.checkingModel, t.modelFileMissing, t.modelReady]);

  async function handlePredict() {
    if (!selection?.provinceNumber || !predictionWindow) {
      return;
    }

    const provinceNumber = selection.provinceNumber;

    setError(null);
    onPredictionsChange([]);
    setIsLoading(true);
    onPredictionLoadingChange(true);

    try {
      const categories = predictionWindow.categories.length
        ? predictionWindow.categories
        : [null];
      const responses = await Promise.all(
        categories.map(async (category) => {
          const response = await predictDemandRecursive({
            category,
            hours: predictionWindow.hours,
            province_number: provinceNumber,
            start_timestamp: predictionWindow.startTimestamp,
          });

          return response.points.map((point) => ({
            ...point,
            category,
          }));
        }),
      );

      onPredictionsChange(responses.flat());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t.predictionFailed);
    } finally {
      setIsLoading(false);
      onPredictionLoadingChange(false);
    }
  }

  return (
    <section className="predict-panel" aria-label={t.mlPredict}>
      <div className="predict-header">
        <div>
          <h2>{t.mlPredict}</h2>
          <span>{modelStatus}</span>
        </div>
      </div>
      <p className="predict-help">
        {canPredict
          ? `${selection?.regionName ?? t.province}: ${t.mlPredictHelp}`
          : selection?.provinceNumber && !isProvinceAllowed
            ? t.predictionProvinceUnavailable
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
