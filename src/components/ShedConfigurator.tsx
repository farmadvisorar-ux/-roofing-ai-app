"use client";

import { useMemo, useState } from "react";
import ShedViewer3D from "./ShedViewer3D";
import {
  DEFAULT_SHED_CONFIG,
  ROOF_STYLE_LABELS,
  RoofStyle,
  ShedConfigInput,
  calculateShedPrice,
  clampShedConfig,
  shedConfigToQuery,
} from "@/lib/shed";
import LeadCaptureForm from "./LeadCaptureForm";

const SIDING_SWATCHES = ["#c9c2b4", "#8a8f98", "#5b4636", "#3f5e4f", "#a33b2b", "#e8e3d8"];
const ROOF_SWATCHES = ["#3a3f44", "#5c1f1f", "#2c3e50", "#6b6b6b", "#8b3a1d"];

export default function ShedConfigurator() {
  const [config, setConfig] = useState<ShedConfigInput>(DEFAULT_SHED_CONFIG);

  const price = useMemo(() => calculateShedPrice(config), [config]);
  const arUrl = useMemo(() => {
    const params = shedConfigToQuery(config);
    return `/ar?${params.toString()}`;
  }, [config]);

  function update<K extends keyof ShedConfigInput>(key: K, value: ShedConfigInput[K]) {
    setConfig((prev) => clampShedConfig({ ...prev, [key]: value }));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <ShedViewer3D config={config} className="aspect-[4/3] w-full bg-neutral-800" />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-400">Estimated price</div>
            <div className="text-2xl font-semibold text-white">${price.toLocaleString()}</div>
          </div>
          <a
            href={arUrl}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            View in your yard (AR) →
          </a>
        </div>
        <p className="text-xs text-neutral-500">
          Drag to orbit, scroll or pinch to zoom. Open &ldquo;View in your yard&rdquo; on your phone to place this shed in AR.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Dimensions
          </h2>
          <SliderRow label="Width" value={config.widthFt} unit="ft" min={6} max={40} step={1}
            onChange={(v) => update("widthFt", v)} />
          <SliderRow label="Length" value={config.lengthFt} unit="ft" min={6} max={60} step={1}
            onChange={(v) => update("lengthFt", v)} />
          <SliderRow label="Wall height" value={config.wallHeightFt} unit="ft" min={6} max={14} step={0.5}
            onChange={(v) => update("wallHeightFt", v)} />
          <SliderRow label="Roof pitch" value={config.roofPitch} unit="/12" min={2} max={12} step={1}
            onChange={(v) => update("roofPitch", v)} />
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Roof style
          </h2>
          <div className="flex gap-2">
            {(Object.keys(ROOF_STYLE_LABELS) as RoofStyle[]).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => update("roofStyle", style)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                  config.roofStyle === style
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                    : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                }`}
              >
                {ROOF_STYLE_LABELS[style]}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Colors
          </h2>
          <ColorRow label="Siding" value={config.sidingColor} swatches={SIDING_SWATCHES}
            onChange={(v) => update("sidingColor", v)} />
          <ColorRow label="Roof" value={config.roofColor} swatches={ROOF_SWATCHES}
            onChange={(v) => update("roofColor", v)} />
          <ColorRow label="Trim" value={config.trimColor} swatches={["#ffffff", "#1c1c1c", "#c9c2b4"]}
            onChange={(v) => update("trimColor", v)} />
        </section>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-300">
            Doors &amp; windows
          </h2>
          <SliderRow label="Doors" value={config.doorCount} unit="" min={0} max={4} step={1}
            onChange={(v) => update("doorCount", v)} />
          <SliderRow label="Door width" value={config.doorWidthFt} unit="ft" min={2} max={10} step={0.5}
            onChange={(v) => update("doorWidthFt", v)} />
          <SliderRow label="Windows" value={config.windowCount} unit="" min={0} max={12} step={1}
            onChange={(v) => update("windowCount", v)} />
        </section>

        <LeadCaptureForm config={config} price={price} />
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-3 block last:mb-0">
      <div className="mb-1 flex justify-between text-sm text-neutral-300">
        <span>{label}</span>
        <span className="tabular-nums text-neutral-400">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </label>
  );
}

function ColorRow({
  label,
  value,
  swatches,
  onChange,
}: {
  label: string;
  value: string;
  swatches: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-3 flex items-center justify-between last:mb-0">
      <span className="text-sm text-neutral-300">{label}</span>
      <div className="flex items-center gap-2">
        {swatches.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`${label} ${s}`}
            onClick={() => onChange(s)}
            className={`h-6 w-6 rounded-full border-2 ${
              value.toLowerCase() === s.toLowerCase() ? "border-emerald-400" : "border-transparent"
            }`}
            style={{ backgroundColor: s }}
          />
        ))}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border border-neutral-700 bg-transparent"
        />
      </div>
    </div>
  );
}
