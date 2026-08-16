import { createFloatBuffer, createIndexBuffer, createProgram } from "./gl";
import { MeshData } from "./geometry";
import { Mat4, mat4NormalMatrix, Vec3 } from "./math";

const VERTEX_SRC = `#version 300 es
precision highp float;

in vec3 aPosition;
in vec3 aNormal;
in vec3 aColor;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uNormalMatrix;

out vec3 vNormal;
out vec3 vColor;
out vec3 vWorldPos;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = mat3(uNormalMatrix) * aNormal;
  vColor = aColor;
  gl_Position = uProj * uView * worldPos;
}
`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vColor;
in vec3 vWorldPos;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform vec3 uCameraPos;

out vec4 fragColor;

void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, normalize(-uLightDir)), 0.0);

  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  vec3 halfVec = normalize(viewDir + normalize(-uLightDir));
  float spec = pow(max(dot(normal, halfVec), 0.0), 24.0) * 0.15;

  vec3 lit = vColor * (uAmbientColor + uLightColor * diffuse) + vec3(spec);
  fragColor = vec4(lit, 1.0);
}
`;

export interface RenderParams {
  model: Mat4;
  view: Mat4;
  proj: Mat4;
  cameraPos: Vec3;
  lightDir?: Vec3;
  lightColor?: Vec3;
  ambientColor?: Vec3;
  viewport?: { x: number; y: number; width: number; height: number };
  clear?: boolean;
}

/** Thin, dependency-free WebGL2 renderer for a single colored+lit mesh. */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private indexCount = 0;
  private indexType: number;
  private uniforms: Record<string, WebGLUniformLocation | null>;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SRC, FRAGMENT_SRC);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO");
    this.vao = vao;
    this.indexType = gl.UNSIGNED_SHORT;

    this.uniforms = {
      uModel: gl.getUniformLocation(this.program, "uModel"),
      uView: gl.getUniformLocation(this.program, "uView"),
      uProj: gl.getUniformLocation(this.program, "uProj"),
      uNormalMatrix: gl.getUniformLocation(this.program, "uNormalMatrix"),
      uLightDir: gl.getUniformLocation(this.program, "uLightDir"),
      uLightColor: gl.getUniformLocation(this.program, "uLightColor"),
      uAmbientColor: gl.getUniformLocation(this.program, "uAmbientColor"),
      uCameraPos: gl.getUniformLocation(this.program, "uCameraPos"),
    };
  }

  setMesh(mesh: MeshData) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);

    const posBuf = createFloatBuffer(gl, mesh.positions);
    const posLoc = gl.getAttribLocation(this.program, "aPosition");
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    const normBuf = createFloatBuffer(gl, mesh.normals);
    const normLoc = gl.getAttribLocation(this.program, "aNormal");
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.enableVertexAttribArray(normLoc);
    gl.vertexAttribPointer(normLoc, 3, gl.FLOAT, false, 0, 0);

    const colorBuf = createFloatBuffer(gl, mesh.colors);
    const colorLoc = gl.getAttribLocation(this.program, "aColor");
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

    createIndexBuffer(gl, mesh.indices);
    this.indexCount = mesh.indices.length;
    this.indexType = mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

    gl.bindVertexArray(null);
  }

  render(params: RenderParams) {
    const gl = this.gl;
    if (params.viewport) {
      gl.viewport(params.viewport.x, params.viewport.y, params.viewport.width, params.viewport.height);
    }
    if (params.clear !== false) {
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0.72, 0.83, 0.92, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const normalMatrix = mat4NormalMatrix(params.model);
    gl.uniformMatrix4fv(this.uniforms.uModel, false, params.model);
    gl.uniformMatrix4fv(this.uniforms.uView, false, params.view);
    gl.uniformMatrix4fv(this.uniforms.uProj, false, params.proj);
    gl.uniformMatrix4fv(this.uniforms.uNormalMatrix, false, normalMatrix);

    const lightDir = params.lightDir ?? [-0.5, -1, -0.3];
    const lightColor = params.lightColor ?? [0.95, 0.93, 0.88];
    const ambientColor = params.ambientColor ?? [0.45, 0.47, 0.5];
    gl.uniform3fv(this.uniforms.uLightDir, lightDir);
    gl.uniform3fv(this.uniforms.uLightColor, lightColor);
    gl.uniform3fv(this.uniforms.uAmbientColor, ambientColor);
    gl.uniform3fv(this.uniforms.uCameraPos, params.cameraPos);

    gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);

    gl.bindVertexArray(null);
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }
}
