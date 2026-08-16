import { MeshData } from "./geometry";
import { buildDiskMesh } from "./markers";
import { Mat4, mat4Multiply, mat4RotateY, Vec3 } from "./math";
import { Renderer } from "./renderer";

export interface XrArControllerOptions {
  domOverlay?: HTMLElement;
  onReticleVisible?: (visible: boolean) => void;
  onPlaced?: () => void;
  onEnded?: () => void;
}

/** Drives a WebXR immersive-ar session: hit-test reticle, tap-to-place, and rendering the shed mesh. */
export class XrArController {
  private session: XRSession | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private renderer: Renderer | null = null;
  private reticleRenderer: Renderer | null = null;
  private localSpace: XRReferenceSpace | null = null;
  private hitTestSource: XRHitTestSource | null = null;

  private placementMatrix: Mat4 | null = null;
  private rotationRad = 0;
  private lastReticleMatrix: Mat4 | null = null;

  static async isSupported(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported("immersive-ar");
    } catch {
      return false;
    }
  }

  get isPlaced() {
    return this.placementMatrix !== null;
  }

  setRotation(rad: number) {
    this.rotationRad = rad;
  }

  rotateBy(rad: number) {
    this.rotationRad += rad;
  }

  reset() {
    this.placementMatrix = null;
  }

  async start(mesh: MeshData, options: XrArControllerOptions = {}) {
    if (!navigator.xr) throw new Error("WebXR is not available in this browser");

    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { xrCompatible: true });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;

    const sessionInit: XRSessionInit = {
      requiredFeatures: ["hit-test", "local"],
      optionalFeatures: options.domOverlay ? ["dom-overlay"] : [],
      ...(options.domOverlay ? { domOverlay: { root: options.domOverlay } } : {}),
    };

    const session = await navigator.xr.requestSession("immersive-ar", sessionInit);
    this.session = session;

    await gl.makeXRCompatible();
    await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

    this.renderer = new Renderer(gl);
    this.renderer.setMesh(mesh);

    this.reticleRenderer = new Renderer(gl);
    this.reticleRenderer.setMesh(buildDiskMesh(0.22, 32, [0.25, 0.9, 0.5]));

    this.localSpace = await session.requestReferenceSpace("local");
    const viewerSpace = await session.requestReferenceSpace("viewer");
    this.hitTestSource = await session.requestHitTestSource!({ space: viewerSpace }) ?? null;

    session.addEventListener("select", () => {
      if (!this.isPlaced && this.lastReticleMatrix) {
        this.placementMatrix = this.lastReticleMatrix;
        options.onPlaced?.();
      }
    });

    session.addEventListener("end", () => {
      this.cleanup();
      options.onEnded?.();
    });

    const onFrame = (time: number, frame: XRFrame) => {
      if (!this.session) return;
      this.session.requestAnimationFrame(onFrame);
      this.renderFrame(frame, options);
    };
    session.requestAnimationFrame(onFrame);
  }

  private renderFrame(frame: XRFrame, options: XrArControllerOptions) {
    const session = this.session!;
    const gl = this.gl!;
    const layer = session.renderState.baseLayer!;
    const pose = frame.getViewerPose(this.localSpace!);
    if (!pose) return;

    if (this.hitTestSource && !this.isPlaced) {
      const results = frame.getHitTestResults(this.hitTestSource);
      if (results.length > 0) {
        const hitPose = results[0].getPose(this.localSpace!);
        if (hitPose) {
          this.lastReticleMatrix = hitPose.transform.matrix as unknown as Mat4;
          options.onReticleVisible?.(true);
        }
      } else {
        options.onReticleVisible?.(false);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    for (const view of pose.views) {
      const viewport = layer.getViewport(view);
      if (!viewport) continue;
      const cameraPos: Vec3 = [view.transform.position.x, view.transform.position.y, view.transform.position.z];
      const viewParams = {
        view: view.transform.inverse.matrix as unknown as Mat4,
        proj: view.projectionMatrix as unknown as Mat4,
        cameraPos,
        viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
        clear: false,
      };

      if (this.isPlaced && this.renderer) {
        const model = mat4Multiply(this.placementMatrix!, mat4RotateY(this.rotationRad));
        this.renderer.render({ ...viewParams, model });
      } else if (this.lastReticleMatrix && this.reticleRenderer) {
        this.reticleRenderer.render({ ...viewParams, model: this.lastReticleMatrix });
      }
    }
  }

  async stop() {
    await this.session?.end();
  }

  private cleanup() {
    this.renderer?.dispose();
    this.reticleRenderer?.dispose();
    this.renderer = null;
    this.reticleRenderer = null;
    this.session = null;
    this.hitTestSource = null;
  }
}
