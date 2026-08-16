"use client";

import ShedViewer3D from "./ShedViewer3D";
import { DEFAULT_SHED_CONFIG } from "@/lib/shed";

export default function HeroViewer() {
  return (
    <ShedViewer3D
      config={{ ...DEFAULT_SHED_CONFIG, roofStyle: "GAMBREL", widthFt: 12, lengthFt: 16 }}
      className="aspect-square w-full overflow-hidden rounded-xl bg-neutral-800 shadow-2xl"
    />
  );
}
