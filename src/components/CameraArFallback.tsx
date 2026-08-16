"use client";

import { useEffect, useRef, useState } from "react";
import { ShedConfigInput } from "@/lib/shed";
import { buildShedMesh, mat4Identity, mat4Perspective, OrbitControls, Renderer } from "@/engine";

interface CameraArFallbackProps {
  config: ShedConfigInput;
  onExit: () => void;
}

/**
 * Simplified AR preview for browsers without WebXR immersive-ar (e.g. iOS Safari, desktop).
 * Overlays the live rear camera feed with the shed rendered via the same proprietary engine;
 * the shed is anchored in front of the camera and you look around it with touch-orbit instead
 * of full 6DoF world tracking.
 */
export default function CameraArFallback({ config, onExit }: CameraArFallbackProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [distance, setDistance] = useState(6);
  const distanceRef = useRef(6);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      })
      .catch(() => setError("Camera access was denied. Allow camera access to preview this shed in AR."));

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: true });
    if (!gl) {
      setError("Your browser doesn't support WebGL2, so the AR preview can't run here.");
      return;
    }

    const renderer = new Renderer(gl);
    renderer.setMesh(buildShedMesh(config));
    const controls = new OrbitControls(canvas, { distance: 6, elevation: 0.35, azimuth: 0, target: [0, 1, 0] });
    controls.minDistance = 2;
    controls.maxDistance = 25;

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
      controls.state.distance = distanceRef.current;
      const aspect = canvas.width / canvas.height || 1;
      const proj = mat4Perspective((55 * Math.PI) / 180, aspect, 0.05, 100);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      renderer.render({
        model: mat4Identity(),
        view: controls.getViewMatrix(),
        proj,
        cameraPos: controls.getCameraPos(),
        viewport: { x: 0, y: 0, width: canvas.width, height: canvas.height },
        clear: false,
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
    };
  }, [config]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4 text-white">
        <span className="text-sm">Simplified AR preview — drag to look around</span>
        <button onClick={onExit} className="rounded-full bg-black/50 px-3 py-1 text-sm">
          Close ✕
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
        <label className="block text-center text-xs text-white/80">Move closer / farther</label>
        <input
          type="range"
          min={2}
          max={20}
          step={0.5}
          value={distance}
          onChange={(e) => {
            const value = Number(e.target.value);
            setDistance(value);
            distanceRef.current = value;
          }}
          className="w-full accent-emerald-500"
        />
      </div>

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center text-white">
          {error}
        </div>
      )}
    </div>
  );
}
