"use client";

import { useEffect, useRef, useState } from "react";
import { ShedConfigInput } from "@/lib/shed";
import {
  buildShedMesh,
  mat4Identity,
  mat4Perspective,
  OrbitControls,
  Renderer,
} from "@/engine";

interface ShedViewer3DProps {
  config: ShedConfigInput;
  className?: string;
}

export default function ShedViewer3D({ config, className }: ShedViewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  // Initialize the GL context + controls once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) {
      setUnsupported(true);
      return;
    }

    const renderer = new Renderer(gl);
    rendererRef.current = renderer;
    const controls = new OrbitControls(canvas);
    controlsRef.current = controls;

    let raf = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, canvas.clientWidth * dpr);
      const height = Math.max(1, canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const loop = () => {
      resize();
      const aspect = canvas.width / canvas.height || 1;
      const proj = mat4Perspective((50 * Math.PI) / 180, aspect, 0.05, 100);
      renderer.render({
        model: mat4Identity(),
        view: controls.getViewMatrix(),
        proj,
        cameraPos: controls.getCameraPos(),
        viewport: { x: 0, y: 0, width: canvas.width, height: canvas.height },
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Rebuild the mesh whenever the configuration changes.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const mesh = buildShedMesh(config);
    renderer.setMesh(mesh);
  }, [config]);

  if (unsupported) {
    return (
      <div className={className}>
        <div className="flex h-full w-full items-center justify-center rounded-lg bg-neutral-800 text-center text-sm text-neutral-300 p-6">
          Your browser doesn&apos;t support WebGL2, so the live 3D preview
          isn&apos;t available here. Try a recent version of Chrome, Safari,
          Edge, or Firefox.
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <canvas ref={canvasRef} className="h-full w-full touch-none rounded-lg" />
    </div>
  );
}
