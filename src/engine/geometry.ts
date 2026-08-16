import { Vec3, vCross, vNormalize, vSub } from "./math";

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean, 16);
  return [
    ((bigint >> 16) & 255) / 255,
    ((bigint >> 8) & 255) / 255,
    (bigint & 255) / 255,
  ];
}

/** Accumulates triangle geometry (position/normal/color/index) for the whole shed in one draw call. */
export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  /** Adds a planar quad. Points must be given in CCW order when viewed from the front (outward) face. */
  addQuad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, color: RGB) {
    const normal = vNormalize(vCross(vSub(p1, p0), vSub(p2, p0)));
    const base = this.positions.length / 3;
    for (const p of [p0, p1, p2, p3]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color[0], color[1], color[2]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Fan-triangulates a convex planar polygon (CCW winding for an outward-facing normal). */
  addPolygon(points: Vec3[], color: RGB) {
    if (points.length < 3) return;
    const normal = vNormalize(vCross(vSub(points[1], points[0]), vSub(points[2], points[0])));
    const base = this.positions.length / 3;
    for (const p of points) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color[0], color[1], color[2]);
    }
    for (let i = 1; i < points.length - 1; i++) {
      this.indices.push(base, base + i, base + i + 1);
    }
  }

  /** Axis-aligned box centered at `center`, given full width/height/depth in `size`. */
  addBox(center: Vec3, size: Vec3, color: RGB) {
    const [cx, cy, cz] = center;
    const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const p = (x: number, y: number, z: number): Vec3 => [cx + x * sx, cy + y * sy, cz + z * sz];

    // +Z front
    this.addQuad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), color);
    // -Z back
    this.addQuad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), color);
    // +X right
    this.addQuad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), color);
    // -X left
    this.addQuad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), color);
    // +Y top
    this.addQuad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), color);
    // -Y bottom
    this.addQuad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), color);
  }

  /** Like addPolygon, but reverses winding if needed so the face normal points toward `desiredDir`. */
  addPolygonFacing(points: Vec3[], color: RGB, desiredDir: Vec3) {
    if (points.length < 3) return;
    const normal = vNormalize(vCross(vSub(points[1], points[0]), vSub(points[2], points[0])));
    const dot = normal[0] * desiredDir[0] + normal[1] * desiredDir[1] + normal[2] * desiredDir[2];
    this.addPolygon(dot < 0 ? [...points].reverse() : points, color);
  }

  build(): MeshData {
    const useShort = this.positions.length / 3 <= 65536;
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      indices: useShort ? new Uint16Array(this.indices) : new Uint32Array(this.indices),
    };
  }
}
