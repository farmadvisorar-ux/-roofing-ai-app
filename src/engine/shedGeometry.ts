import { ShedConfigInput } from "@/lib/shed";
import { MeshBuilder, MeshData, RGB, hexToRgb } from "./geometry";
import { Vec3 } from "./math";

export const FT_TO_M = 0.3048;

const OVERHANG = 0.28; // meters, roof eave overhang
const RAKE_OVERHANG = 0.22; // meters, roof overhang at the gable ends
const WALL_THICKNESS = 0.12; // meters

interface ProfilePoint {
  x: number;
  y: number;
}

function darken(c: RGB, amount: number): RGB {
  return [c[0] * (1 - amount), c[1] * (1 - amount), c[2] * (1 - amount)];
}

function lighten(c: RGB, amount: number): RGB {
  return [
    c[0] + (1 - c[0]) * amount,
    c[1] + (1 - c[1]) * amount,
    c[2] + (1 - c[2]) * amount,
  ];
}

/** Roof cross-section profile (in the X/Y plane) shared by the sloped surfaces and the gable-end fill. */
function roofProfile(style: ShedConfigInput["roofStyle"], hw: number, h: number, rise: number): ProfilePoint[] {
  switch (style) {
    case "LEAN_TO":
      return [
        { x: -hw - OVERHANG, y: h },
        { x: -hw, y: h },
        { x: hw, y: h + rise },
        { x: hw + OVERHANG, y: h + rise },
      ];
    case "GAMBREL": {
      const bx = hw * 0.55;
      const by = h + rise * 0.65;
      return [
        { x: -hw - OVERHANG, y: h },
        { x: -hw, y: h },
        { x: -bx, y: by },
        { x: 0, y: h + rise },
        { x: bx, y: by },
        { x: hw, y: h },
        { x: hw + OVERHANG, y: h },
      ];
    }
    case "GABLE":
    default:
      return [
        { x: -hw - OVERHANG, y: h },
        { x: -hw, y: h },
        { x: 0, y: h + rise },
        { x: hw, y: h },
        { x: hw + OVERHANG, y: h },
      ];
  }
}

export function buildShedMesh(config: ShedConfigInput): MeshData {
  const b = new MeshBuilder();

  const w = config.widthFt * FT_TO_M;
  const l = config.lengthFt * FT_TO_M;
  const h = config.wallHeightFt * FT_TO_M;
  const hw = w / 2;
  const hl = l / 2;
  const t = WALL_THICKNESS;

  const siding = hexToRgb(config.sidingColor);
  const trim = hexToRgb(config.trimColor);
  const roofColor = hexToRgb(config.roofColor);
  const doorColor = darken(siding, 0.55);
  const windowColor: RGB = lighten([0.55, 0.72, 0.82], 0.15);
  const foundation: RGB = [0.55, 0.55, 0.56];

  // Foundation slab
  b.addBox([0, -0.05, 0], [w + 0.3, 0.1, l + 0.3], foundation);

  const leanTo = config.roofStyle === "LEAN_TO";
  const run = leanTo ? w : hw;
  const rise = run * (config.roofPitch / 12);

  // Walls -----------------------------------------------------------------
  if (leanTo) {
    // Low wall on -X, tall wall on +X, front/back walls follow the slope.
    b.addBox([-hw, h / 2, 0], [t, h, l + t], siding);
    b.addBox([hw, (h + rise) / 2, 0], [t, h + rise, l + t], siding);

    const frontPanel: Vec3[] = [
      [-hw, 0, -hl],
      [hw, 0, -hl],
      [hw, h + rise, -hl],
      [-hw, h, -hl],
    ];
    const backPanel: Vec3[] = [
      [-hw, 0, hl],
      [-hw, h, hl],
      [hw, h + rise, hl],
      [hw, 0, hl],
    ];
    b.addPolygonFacing(frontPanel, siding, [0, 0, -1]);
    b.addPolygonFacing(backPanel, siding, [0, 0, 1]);
  } else {
    b.addBox([0, h / 2, -hl], [w, h, t], siding);
    b.addBox([0, h / 2, hl], [w, h, t], siding);
    b.addBox([-hw, h / 2, 0], [t, h, l + t], siding);
    b.addBox([hw, h / 2, 0], [t, h, l + t], siding);
  }

  // Corner trim posts
  const wallTopForTrim = leanTo ? h : h; // trim posts sit at the low wall height
  for (const [cx, cz] of [[-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl]] as const) {
    b.addBox([cx, wallTopForTrim / 2, cz], [0.08, wallTopForTrim, 0.08], trim);
  }

  // Roof --------------------------------------------------------------------
  if (!leanTo) {
    const profile = roofProfile(config.roofStyle, hw, h, rise);
    const zExt = hl + RAKE_OVERHANG;
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i];
      const c = profile[i + 1];
      const p0: Vec3 = [a.x, a.y, -zExt];
      const p1: Vec3 = [a.x, a.y, zExt];
      const p2: Vec3 = [c.x, c.y, zExt];
      const p3: Vec3 = [c.x, c.y, -zExt];
      b.addPolygonFacing([p0, p1, p2, p3], roofColor, [0, 1, 0]);
    }

    // Gable-end fill between the wall top and the roof peak.
    const wallRange = profile.slice(1, -1).map((p): Vec3 => [p.x, p.y, -hl]);
    if (wallRange.length >= 3) {
      b.addPolygonFacing(wallRange, siding, [0, 0, -1]);
      b.addPolygonFacing(
        wallRange.map((p): Vec3 => [p[0], p[1], hl]),
        siding,
        [0, 0, 1],
      );
    }
  } else {
    const profile = roofProfile(config.roofStyle, hw, h, rise);
    const zExt = hl;
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i];
      const c = profile[i + 1];
      const p0: Vec3 = [a.x, a.y, -zExt];
      const p1: Vec3 = [a.x, a.y, zExt];
      const p2: Vec3 = [c.x, c.y, zExt];
      const p3: Vec3 = [c.x, c.y, -zExt];
      b.addPolygonFacing([p0, p1, p2, p3], roofColor, [0, 1, 0]);
    }
  }

  // Doors (front wall) --------------------------------------------------
  const doorHeight = Math.min(h - 0.2, 2.1);
  const doorWidth = config.doorWidthFt * FT_TO_M;
  const doorCount = Math.max(0, config.doorCount);
  if (doorCount > 0) {
    const usableWidth = w * 0.82;
    const spacing = usableWidth / doorCount;
    for (let i = 0; i < doorCount; i++) {
      const cx = -usableWidth / 2 + spacing * (i + 0.5);
      b.addBox([cx, doorHeight / 2, -hl - t / 2 - 0.02], [doorWidth, doorHeight, 0.04], doorColor);
    }
  }

  // Windows (side walls) --------------------------------------------------
  const windowCount = Math.max(0, config.windowCount);
  const winW = 0.85;
  const winH = 1.0;
  const winY = h * 0.58;
  for (let i = 0; i < windowCount; i++) {
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const indexOnSide = Math.floor(i / 2);
    const perSide = Math.ceil(windowCount / 2);
    const usableLen = l * 0.7;
    const spacing = usableLen / Math.max(1, perSide);
    const cz = -usableLen / 2 + spacing * (indexOnSide + 0.5);
    const cx = side * (hw + t / 2 + 0.02);
    b.addBox([cx, winY, cz], [0.04, winH, winW], windowColor);
  }

  return b.build();
}
