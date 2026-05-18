export type PredictionRequest = {
  province_number: number;
};

export type PredictionResponse = {
  prediction: number | string | unknown[];
  model_path: string;
  province_number: number;
  region: string;
};

export type ModelInfoResponse = {
  model_path: string;
  model_exists: boolean;
  features: string[];
};
