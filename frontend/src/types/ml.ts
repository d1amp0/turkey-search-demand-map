export type PredictionRequest = {
  province_number: number;
  start_hour?: number;
  predict_timestamp?: string;
};

export type PredictionResponse = {
  prediction: number | string | unknown[];
  model_path: string;
  province_number: number;
  prediction_timestamp: string;
  start_hour?: number | null;
};

export type RecursivePredictionRequest = {
  province_number: number;
  start_timestamp: string;
  hours: number;
};

export type RecursivePredictionPoint = {
  timestamp: string;
  prediction: number;
};

export type RecursivePredictionResponse = {
  points: RecursivePredictionPoint[];
  model_path: string;
  province_number: number;
  start_timestamp: string;
  hours: number;
};

export type PredictionWindow = {
  startTimestamp: string;
  hours: number;
} | null;

export type ModelInfoResponse = {
  model_path: string;
  model_exists: boolean;
  features: string[];
};
