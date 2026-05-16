export type TurkeyProvinceProperties = {
  name: string;
  number: number;
};

export type RegionValue = {
  name: string;
  value: number;
};

export type RegionValuesResponse = {
  updated_at: string;
  key: "province_number";
  values: Record<string, RegionValue>;
};
