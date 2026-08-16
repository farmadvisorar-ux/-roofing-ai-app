import { MeshBuilder, MeshData, RGB } from "./geometry";
import { Vec3 } from "./math";

/** A small flat disk used as the AR hit-test placement reticle. */
export function buildDiskMesh(radius: number, segments: number, color: RGB): MeshData {
  const b = new MeshBuilder();
  const center: Vec3 = [0, 0, 0];
  const ring: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, 0, Math.sin(a) * radius]);
  }
  for (let i = 0; i < segments; i++) {
    const next = ring[(i + 1) % segments];
    b.addPolygonFacing([center, ring[i], next], color, [0, 1, 0]);
  }
  return b.build();
}
