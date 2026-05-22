export type PredictionRequest = {
  province_number: number;
  start_hour?: number;
  predict_timestamp?: string;
  category?: string | null;
};

export type PredictionResponse = {
  prediction: number | string | unknown[];
  model_path: string;
  province_number: number;
  prediction_timestamp: string;
  start_hour?: number | null;
  category?: string | null;
};

export type RecursivePredictionRequest = {
  province_number: number;
  start_timestamp: string;
  hours: number;
  category?: string | null;
};

export type RecursivePredictionPoint = {
  timestamp: string;
  prediction: number;
  category?: string | null;
};

export type RecursivePredictionResponse = {
  points: RecursivePredictionPoint[];
  model_path: string;
  province_number: number;
  start_timestamp: string;
  hours: number;
  category?: string | null;
};

export type PredictionWindow = {
  startTimestamp: string;
  hours: number;
  categories: Array<string | null>;
} | null;

export type ModelInfoResponse = {
  model_path: string;
  model_exists: boolean;
  features: string[];
};
