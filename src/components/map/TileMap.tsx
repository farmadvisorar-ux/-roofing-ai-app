"use client";

// A minimal slippy map over raster tiles — pan, zoom, and click-to-place — built
// from the Web Mercator formulas directly. In the same spirit as src/engine:
// this repo writes its own renderers rather than pulling in Leaflet/Mapbox.
//
// Zoom is kept integral so tiles are drawn 1:1 and stay crisp; there is no CSS
// scaling of the tile layer.
import { PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface MapApi {
  /** Container-pixel position of a coordinate, for absolutely positioning markers. */
  project(point: LatLng): { x: number; y: number };
  zoom: number;
}

const TILE_SIZE = 256;
const MIN_ZOOM = 3;
/** OpenStreetMap's raster tiles stop at z19. */
const MAX_ZOOM = 19;
/** Pointer travel below this still counts as a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;
/** Mercator is undefined at the poles. */
const MAX_LAT = 85.05112878;
const VIEWPORT_DEBOUNCE_MS = 250;

const TILE_URL_TEMPLATE =
  process.env.NEXT_PUBLIC_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ?? "© OpenStreetMap contributors";

// --- Web Mercator ---------------------------------------------------------

function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

export function lngToWorldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * worldSize(zoom);
}

export function latToWorldY(lat: number, zoom: number): number {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  return (0.5 - y / (2 * Math.PI)) * worldSize(zoom);
}

export function worldXToLng(x: number, zoom: number): number {
  return (x / worldSize(zoom)) * 360 - 180;
}

export function worldYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / worldSize(zoom);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

interface TileMapProps {
  center: LatLng;
  zoom: number;
  onCenterChange(center: LatLng): void;
  onZoomChange(zoom: number): void;
  /** Fired on a click/tap that wasn't a drag. */
  onMapClick?(point: LatLng): void;
  /** Debounced; use it to load only what's on screen. Must be referentially stable. */
  onBoundsChange?(bounds: MapBounds): void;
  children?: (api: MapApi) => ReactNode;
}

export default function TileMap({
  center,
  zoom,
  onCenterChange,
  onZoomChange,
  onMapClick,
  onBoundsChange,
  children,
}: TileMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Live drag state; a ref so pointermove doesn't re-render per frame.
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startCenter: LatLng;
    moved: boolean;
  } | null>(null);
  // Active pointers, so two fingers can pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartDistance = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = 2 ** zoom;
  // World-pixel coordinate of the container's top-left corner.
  const originX = lngToWorldX(center.lng, zoom) - size.width / 2;
  const originY = latToWorldY(center.lat, zoom) - size.height / 2;

  const project = useCallback(
    (point: LatLng) => ({
      x: lngToWorldX(point.lng, zoom) - originX,
      y: latToWorldY(point.lat, zoom) - originY,
    }),
    [zoom, originX, originY],
  );

  /** Container-relative pixel -> coordinate. */
  const unproject = useCallback(
    (x: number, y: number): LatLng => ({
      lat: worldYToLat(originY + y, zoom),
      lng: worldXToLng(originX + x, zoom),
    }),
    [zoom, originX, originY],
  );

  // Report the visible bounds, debounced so a pan doesn't fire a request per frame.
  const lastBounds = useRef<string>("");
  useEffect(() => {
    if (!onBoundsChange || size.width === 0 || size.height === 0) return;
    const bounds: MapBounds = {
      minLat: worldYToLat(originY + size.height, zoom),
      maxLat: worldYToLat(originY, zoom),
      minLng: worldXToLng(originX, zoom),
      maxLng: worldXToLng(originX + size.width, zoom),
    };
    const key = JSON.stringify(bounds);
    if (key === lastBounds.current) return;

    const timer = setTimeout(() => {
      lastBounds.current = key;
      onBoundsChange(bounds);
    }, VIEWPORT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [onBoundsChange, originX, originY, zoom, size.width, size.height]);

  /** Zooms while keeping whatever is under (anchorX, anchorY) pinned there. */
  const zoomAround = useCallback(
    (nextZoom: number, anchorX: number, anchorY: number) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      if (clamped === zoom) return;

      const anchor = unproject(anchorX, anchorY);
      // After zooming, shift the center so the anchor lands back on the same pixel.
      const nextOriginX = lngToWorldX(anchor.lng, clamped) - anchorX;
      const nextOriginY = latToWorldY(anchor.lat, clamped) - anchorY;
      onCenterChange({
        lat: worldYToLat(nextOriginY + size.height / 2, clamped),
        lng: worldXToLng(nextOriginX + size.width / 2, clamped),
      });
      onZoomChange(clamped);
    },
    [zoom, unproject, onCenterChange, onZoomChange, size.width, size.height],
  );

  function localPoint(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStartDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
      drag.current = null;
      return;
    }
    drag.current = { pointerId: e.pointerId, startX: p.x, startY: p.y, startCenter: center, moved: false };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);

    // Two fingers: pinch. One whole doubling of distance is one zoom level.
    if (pointers.current.size === 2 && pinchStartDistance.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const steps = Math.round(Math.log2(distance / pinchStartDistance.current));
      if (steps !== 0) {
        pinchStartDistance.current = distance;
        zoomAround(zoom + steps, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      return;
    }

    const state = drag.current;
    if (!state || state.pointerId !== e.pointerId) return;

    const dx = p.x - state.startX;
    const dy = p.y - state.startY;
    if (!state.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) state.moved = true;
    if (!state.moved) return;

    // Pan by moving the center the opposite way, in world pixels.
    const startWorldX = lngToWorldX(state.startCenter.lng, zoom);
    const startWorldY = latToWorldY(state.startCenter.lat, zoom);
    onCenterChange({
      lat: worldYToLat(startWorldY - dy, zoom),
      lng: worldXToLng(startWorldX - dx, zoom),
    });
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStartDistance.current = null;

    if (state?.pointerId === e.pointerId) {
      drag.current = null;
      // A tap that never became a drag places a pin.
      if (!state.moved && onMapClick) {
        const p = localPoint(e);
        onMapClick(unproject(p.x, p.y));
      }
    }
  }

  // Non-passive wheel listener: React's onWheel is passive, so preventDefault there
  // is ignored and the page would scroll while zooming.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(zoom + (e.deltaY < 0 ? 1 : -1), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround, zoom]);

  const tiles: { key: string; url: string; left: number; top: number }[] = [];
  if (size.width > 0 && size.height > 0) {
    const minTileX = Math.floor(originX / TILE_SIZE);
    const maxTileX = Math.floor((originX + size.width) / TILE_SIZE);
    const minTileY = Math.max(0, Math.floor(originY / TILE_SIZE));
    const maxTileY = Math.min(scale - 1, Math.floor((originY + size.height) / TILE_SIZE));

    for (let tx = minTileX; tx <= maxTileX; tx++) {
      // The world wraps east-west, so a tile index outside [0, scale) is valid.
      const wrappedX = ((tx % scale) + scale) % scale;
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          url: TILE_URL_TEMPLATE.replace("{z}", String(zoom))
            .replace("{x}", String(wrappedX))
            .replace("{y}", String(ty)),
          left: tx * TILE_SIZE - originX,
          top: ty * TILE_SIZE - originY,
        });
      }
    }
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      // touch-none keeps the browser from claiming the gesture for scrolling.
      className="relative h-full w-full touch-none overflow-hidden bg-neutral-900 select-none"
      style={{ cursor: "crosshair" }}
      role="application"
      aria-label="Canvassing map"
    >
      {tiles.map((tile) => (
        // Map tiles are hundreds of ephemeral third-party URLs; next/image would proxy
        // and cache every one of them, so a plain <img> is the right call here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={tile.key}
          src={tile.url}
          alt=""
          aria-hidden
          draggable={false}
          width={TILE_SIZE}
          height={TILE_SIZE}
          // A tile can always fail — offline, a gap in coverage, a blocked CDN. Hide it
          // rather than letting the browser paint a broken-image icon over the map.
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
          onLoad={(e) => {
            e.currentTarget.style.visibility = "visible";
          }}
          className="pointer-events-none absolute"
          style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
        />
      ))}

      {size.width > 0 && children?.({ project, zoom })}

      <div className="absolute right-2 bottom-2 flex flex-col gap-1">
        <ZoomButton label="Zoom in" onClick={() => zoomAround(zoom + 1, size.width / 2, size.height / 2)}>
          +
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => zoomAround(zoom - 1, size.width / 2, size.height / 2)}>
          −
        </ZoomButton>
      </div>

      {/* Tile attribution is a condition of the OSM tile usage policy. */}
      <div className="absolute bottom-0 left-0 bg-neutral-950/70 px-2 py-0.5 text-[10px] text-neutral-300">
        {TILE_ATTRIBUTION}
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // The map treats any pointerdown as a potential pan; keep it off the buttons.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="h-8 w-8 rounded-md border border-neutral-700 bg-neutral-950/90 text-lg leading-none text-neutral-200 hover:bg-neutral-800"
    >
      {children}
    </button>
  );
}
