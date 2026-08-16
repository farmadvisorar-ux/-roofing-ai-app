export type RoofStyle = "GABLE" | "LEAN_TO" | "GAMBREL";

export interface ShedConfigInput {
  widthFt: number;
  lengthFt: number;
  wallHeightFt: number;
  roofStyle: RoofStyle;
  roofPitch: number;
  sidingColor: string;
  trimColor: string;
  roofColor: string;
  doorCount: number;
  doorWidthFt: number;
  windowCount: number;
}

export const DEFAULT_SHED_CONFIG: ShedConfigInput = {
  widthFt: 10,
  lengthFt: 12,
  wallHeightFt: 7,
  roofStyle: "GABLE",
  roofPitch: 4,
  sidingColor: "#c9c2b4",
  trimColor: "#ffffff",
  roofColor: "#3a3f44",
  doorCount: 1,
  doorWidthFt: 3,
  windowCount: 2,
};

export const ROOF_STYLE_LABELS: Record<RoofStyle, string> = {
  GABLE: "Gable",
  LEAN_TO: "Lean-To",
  GAMBREL: "Gambrel (Barn)",
};

const BASE_PRICE_PER_SQFT = 42;
const ROOF_MULTIPLIER: Record<RoofStyle, number> = {
  GABLE: 1,
  LEAN_TO: 0.9,
  GAMBREL: 1.18,
};
const EXTRA_WALL_HEIGHT_PER_FT = 6; // per linear ft of wall perimeter, per ft over 7'
const DOOR_PRICE = 350;
const WINDOW_PRICE = 180;

export function clampShedConfig(input: Partial<ShedConfigInput>): ShedConfigInput {
  const cfg = { ...DEFAULT_SHED_CONFIG, ...input };
  return {
    ...cfg,
    widthFt: clamp(cfg.widthFt, 6, 40),
    lengthFt: clamp(cfg.lengthFt, 6, 60),
    wallHeightFt: clamp(cfg.wallHeightFt, 6, 14),
    roofPitch: clamp(cfg.roofPitch, 2, 12),
    doorCount: clamp(Math.round(cfg.doorCount), 0, 6),
    doorWidthFt: clamp(cfg.doorWidthFt, 2, 10),
    windowCount: clamp(Math.round(cfg.windowCount), 0, 12),
  };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

const QUERY_KEYS: (keyof ShedConfigInput)[] = [
  "widthFt",
  "lengthFt",
  "wallHeightFt",
  "roofStyle",
  "roofPitch",
  "sidingColor",
  "trimColor",
  "roofColor",
  "doorCount",
  "doorWidthFt",
  "windowCount",
];

/** Packs a shed config into short URL query params so it can travel to /ar without a server round trip. */
export function shedConfigToQuery(cfg: ShedConfigInput): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    params.set(key, String(cfg[key]).replace("#", ""));
  }
  return params;
}

export function shedConfigFromQuery(params: URLSearchParams): ShedConfigInput {
  const raw: Partial<ShedConfigInput> = {};
  const num = (k: string) => {
    const v = params.get(k);
    return v === null ? undefined : Number(v);
  };
  const color = (k: string) => {
    const v = params.get(k);
    return v === null ? undefined : v.startsWith("#") ? v : `#${v}`;
  };

  raw.widthFt = num("widthFt");
  raw.lengthFt = num("lengthFt");
  raw.wallHeightFt = num("wallHeightFt");
  raw.roofPitch = num("roofPitch");
  raw.doorCount = num("doorCount");
  raw.doorWidthFt = num("doorWidthFt");
  raw.windowCount = num("windowCount");
  const style = params.get("roofStyle");
  if (style === "GABLE" || style === "LEAN_TO" || style === "GAMBREL") raw.roofStyle = style;
  raw.sidingColor = color("sidingColor");
  raw.trimColor = color("trimColor");
  raw.roofColor = color("roofColor");

  return clampShedConfig(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as Partial<ShedConfigInput>,
  );
}

export function calculateShedPrice(cfg: ShedConfigInput): number {
  const footprint = cfg.widthFt * cfg.lengthFt;
  const perimeter = 2 * (cfg.widthFt + cfg.lengthFt);
  const extraHeight = Math.max(0, cfg.wallHeightFt - 7);

  let price = footprint * BASE_PRICE_PER_SQFT * ROOF_MULTIPLIER[cfg.roofStyle];
  price += perimeter * extraHeight * EXTRA_WALL_HEIGHT_PER_FT;
  price += cfg.doorCount * DOOR_PRICE;
  price += cfg.windowCount * WINDOW_PRICE;

  return Math.round(price / 10) * 10;
}
