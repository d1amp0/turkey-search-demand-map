export const allowedPredictionProvinceNumbers = new Set([
  1,
  6,
  7,
  16,
  21,
  27,
  34,
  35,
  38,
  41,
  42,
  66,
]);

export const maxPredictionHours = 24 * 30;

export function canPredictProvince(provinceNumber: number | null | undefined) {
  return provinceNumber ? allowedPredictionProvinceNumbers.has(provinceNumber) : false;
}
