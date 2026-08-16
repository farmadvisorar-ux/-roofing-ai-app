"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { DEFAULT_SHED_CONFIG, ShedConfigInput, calculateShedPrice, shedConfigFromQuery } from "@/lib/shed";
import { buildShedMesh, XrArController } from "@/engine";
import CameraArFallback from "./CameraArFallback";

type Support = "checking" | "webxr" | "fallback";

export default function ArViewer() {
  const searchParams = useSearchParams();
  const leadId = searchParams.get("leadId");

  const [fetchedConfig, setFetchedConfig] = useState<ShedConfigInput | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [support, setSupport] = useState<Support>("checking");
  const [sessionActive, setSessionActive] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [reticleVisible, setReticleVisible] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<XrArController | null>(null);

  const queryConfig = useMemo(() => shedConfigFromQuery(searchParams), [searchParams]);

  useEffect(() => {
    if (!leadId) return;
    fetch(`/api/leads/${leadId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.lead?.shedConfig) {
          setFetchedConfig(data.lead.shedConfig as ShedConfigInput);
        } else {
          setLoadError("This quote no longer has a saved shed configuration.");
        }
      })
      .catch(() => setLoadError("Couldn't load this saved quote. Showing the default shed instead."));
  }, [leadId]);

  const config = leadId ? (fetchedConfig ?? (loadError ? DEFAULT_SHED_CONFIG : null)) : queryConfig;

  useEffect(() => {
    XrArController.isSupported().then((ok) => setSupport(ok ? "webxr" : "fallback"));
  }, []);

  async function startWebXr() {
    if (!config) return;
    const controller = new XrArController();
    controllerRef.current = controller;
    setSessionActive(true);
    try {
      await controller.start(buildShedMesh(config), {
        domOverlay: overlayRef.current ?? undefined,
        onReticleVisible: setReticleVisible,
        onPlaced: () => setPlaced(true),
        onEnded: () => {
          setSessionActive(false);
          setPlaced(false);
        },
      });
    } catch (err) {
      setSessionActive(false);
      setLoadError(err instanceof Error ? err.message : "Couldn't start the AR session.");
    }
  }

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-300">
        Loading your shed…
      </div>
    );
  }

  if (showFallback) {
    return <CameraArFallback config={config} onExit={() => setShowFallback(false)} />;
  }

  const price = calculateShedPrice(config);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {!sessionActive && (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
          <h1 className="text-2xl font-semibold">Preview this shed in your yard</h1>
          <p className="text-neutral-400">
            {config.widthFt}&apos; × {config.lengthFt}&apos; shed · estimated ${price.toLocaleString()}
          </p>

          {loadError && <p className="text-sm text-amber-400">{loadError}</p>}

          {support === "checking" && <p className="text-sm text-neutral-500">Checking AR support…</p>}

          {support === "webxr" && (
            <button
              onClick={startWebXr}
              className="rounded-md bg-emerald-600 px-6 py-3 text-base font-medium hover:bg-emerald-500"
            >
              Start AR
            </button>
          )}

          {support === "fallback" && (
            <>
              <p className="text-sm text-neutral-500">
                Full world-tracked AR isn&apos;t available in this browser. We&apos;ll show a simplified
                camera preview instead — for placed, world-anchored AR, open this link in Chrome on
                Android.
              </p>
              <button
                onClick={() => setShowFallback(true)}
                className="rounded-md bg-emerald-600 px-6 py-3 text-base font-medium hover:bg-emerald-500"
              >
                Start camera preview
              </button>
            </>
          )}

          <Link href="/configurator" className="text-sm text-neutral-500 underline">
            ← Back to configurator
          </Link>
        </div>
      )}

      {/* WebXR dom-overlay UI */}
      <div ref={overlayRef} className={sessionActive ? "pointer-events-none fixed inset-0 z-50" : "hidden"}>
        {sessionActive && !placed && (
          <div className="absolute inset-x-0 top-8 flex justify-center">
            <span className="rounded-full bg-black/60 px-4 py-2 text-sm text-white">
              {reticleVisible ? "Tap to place the shed" : "Move your phone to find the ground"}
            </span>
          </div>
        )}
        {sessionActive && placed && (
          <div className="pointer-events-auto absolute inset-x-0 bottom-8 flex justify-center gap-3">
            <button
              onClick={() => controllerRef.current?.rotateBy(-Math.PI / 8)}
              className="rounded-full bg-black/60 px-4 py-3 text-white"
            >
              ↺
            </button>
            <button
              onClick={() => {
                controllerRef.current?.reset();
                setPlaced(false);
              }}
              className="rounded-full bg-black/60 px-4 py-2 text-sm text-white"
            >
              Re-place
            </button>
            <button
              onClick={() => controllerRef.current?.rotateBy(Math.PI / 8)}
              className="rounded-full bg-black/60 px-4 py-3 text-white"
            >
              ↻
            </button>
          </div>
        )}
        {sessionActive && (
          <div className="pointer-events-auto absolute right-4 top-8">
            <button
              onClick={() => controllerRef.current?.stop()}
              className="rounded-full bg-black/60 px-3 py-1 text-sm text-white"
            >
              Exit ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
