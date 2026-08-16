import { degToRad, Mat4, mat4LookAt, Vec3 } from "./math";

export interface OrbitState {
  azimuth: number; // radians, around Y axis
  elevation: number; // radians, clamped
  distance: number;
  target: Vec3;
}

/** Mouse + touch orbit/zoom controls for the configurator preview canvas. No external deps. */
export class OrbitControls {
  private el: HTMLElement;
  state: OrbitState;
  minDistance = 3;
  maxDistance = 40;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pinchStartDist = 0;
  private pinchStartZoom = 0;

  constructor(el: HTMLElement, initial?: Partial<OrbitState>) {
    this.el = el;
    this.state = {
      azimuth: initial?.azimuth ?? degToRad(35),
      elevation: initial?.elevation ?? degToRad(22),
      distance: initial?.distance ?? 14,
      target: initial?.target ?? [0, 1.2, 0],
    };

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);

    el.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("touchstart", this.onTouchStart, { passive: false });
    el.addEventListener("touchmove", this.onTouchMove, { passive: false });
  }

  private onPointerDown(e: PointerEvent) {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.state.azimuth -= dx * 0.008;
    this.state.elevation = clamp(this.state.elevation - dy * 0.008, degToRad(4), degToRad(85));
  }

  private onPointerUp() {
    this.dragging = false;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.state.distance = clamp(this.state.distance * (1 + e.deltaY * 0.001), this.minDistance, this.maxDistance);
  }

  private onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      this.pinchStartDist = touchDistance(e.touches);
      this.pinchStartZoom = this.state.distance;
    } else if (e.touches.length === 1) {
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
      this.dragging = true;
    }
  }

  private onTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 2) {
      const d = touchDistance(e.touches);
      const ratio = this.pinchStartDist / Math.max(1, d);
      this.state.distance = clamp(this.pinchStartZoom * ratio, this.minDistance, this.maxDistance);
    } else if (e.touches.length === 1 && this.dragging) {
      const dx = e.touches[0].clientX - this.lastX;
      const dy = e.touches[0].clientY - this.lastY;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
      this.state.azimuth -= dx * 0.008;
      this.state.elevation = clamp(this.state.elevation - dy * 0.008, degToRad(4), degToRad(85));
    }
  }

  getCameraPos(): Vec3 {
    const { azimuth, elevation, distance, target } = this.state;
    const x = target[0] + distance * Math.cos(elevation) * Math.sin(azimuth);
    const y = target[1] + distance * Math.sin(elevation);
    const z = target[2] + distance * Math.cos(elevation) * Math.cos(azimuth);
    return [x, y, z];
  }

  getViewMatrix(): Mat4 {
    return mat4LookAt(this.getCameraPos(), this.state.target, [0, 1, 0]);
  }

  dispose() {
    this.el.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.el.removeEventListener("wheel", this.onWheel);
    this.el.removeEventListener("touchstart", this.onTouchStart);
    this.el.removeEventListener("touchmove", this.onTouchMove);
  }
}

function touchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
