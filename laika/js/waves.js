class Waves {
  static N         = 80;
  static GRID_SIZE = 5.0;
  static FOV       = 40 * Math.PI / 180;

  // [kx, kz, omega, amplitude, phase]  — deep-water dispersion, 1 wu ≈ 40 m
  static WAVES = [
    [ 0.000,  1.122, 0.5245, 0.150, 0.00],
    [ 0.806,  1.396, 0.6287, 0.100, 1.73],
    [-0.859,  2.362, 0.7847, 0.080, 4.21],
    [ 0.350, -0.749, 0.4501, 0.120, 2.85],
    [ 3.887,  2.244, 1.0487, 0.040, 6.17],
  ];

  // Normal-only perturbation wavelets — per-fragment to avoid aliasing.
  // 10 waves at irrational-ish frequencies / irregular directions.
  // A×|k| ≈ 0.06 per wave to avoid "bubble wrap".
  static NORM_WAVES = [
    [  2.11,  17.17, 2.060, 0.0035, 0.91],
    [ 15.74,  16.91, 2.381, 0.0026, 3.47],
    [ 31.47,   3.89, 2.787, 0.0019, 1.88],
    [ 15.49, -11.68, 2.182, 0.0031, 5.23],
    [  8.16, -26.69, 2.614, 0.0021, 2.61],
    [ -6.53, -21.32, 2.338, 0.0027, 0.44],
    [-28.11, -21.19, 2.936, 0.0017, 4.12],
    [-18.79,   0.33, 2.146, 0.0032, 1.33],
    [-23.49,  17.70, 2.682, 0.0020, 6.01],
    [ -5.56,  24.07, 2.460, 0.0024, 3.82],
  ];

  constructor(gl, aspect) {
    this.gl     = gl;
    this.aspect = aspect;
    this._initProgram();
    this._initGeometry();
  }

  _initProgram() {
    const gl = this.gl;
    const W  = Waves.WAVES;
    const NW = Waves.NORM_WAVES;
    const f  = v => v.toFixed(5);
    const GS = Waves.GRID_SIZE.toFixed(2);

    const wH  = w => `${f(w[3])} * sin(${f(w[0])}*x + ${f(w[1])}*z + ${f(w[2])}*u_time + ${f(w[4])})`;
    const gDx = w => `${f(w[3]*w[0])} * cos(${f(w[0])}*x + ${f(w[1])}*z + ${f(w[2])}*u_time + ${f(w[4])})`;
    const gDz = w => `${f(w[3]*w[1])} * cos(${f(w[0])}*x + ${f(w[1])}*z + ${f(w[2])}*u_time + ${f(w[4])})`;
    const allDx = [...W, ...NW].map(gDx).join(' + ');
    const allDz = [...W, ...NW].map(gDz).join(' + ');

    this._prog = createProgram(`
      precision mediump float;
      attribute vec2 a_uv;
      uniform mat4 u_mvp;
      uniform float u_time;
      varying vec3 v_pos;
      void main() {
        float x = (a_uv.x - 0.5) * ${GS};
        float z = (a_uv.y - 0.5) * ${GS};
        float h = ${W.map(wH).join(' + ')};
        v_pos = vec3(x, h, z);
        gl_Position = u_mvp * vec4(x, h, z, 1.0);
      }
    `, `
      precision mediump float;
      uniform float u_time;
      uniform vec3 u_light;
      uniform vec3 u_cam;
      varying vec3 v_pos;
      void main() {
        float x = v_pos.x;
        float z = v_pos.z;
        float dhdx = ${allDx};
        float dhdz = ${allDz};
        vec3 N = normalize(vec3(-dhdx, 1.0, -dhdz));
        vec3 L = normalize(u_light - v_pos);
        vec3 V = normalize(u_cam   - v_pos);
        vec3 H = normalize(L + V);
        float NdotL = dot(N, L);
        float b = 0.02
                + 0.07 * (NdotL * 0.5 + 0.5)
                + 0.55 * pow(max(dot(N, H), 0.0), 192.0);
        gl_FragColor = vec4(b, b, b, 1.0);
      }
    `);
    this._uMVP   = gl.getUniformLocation(this._prog, 'u_mvp');
    this._uTime  = gl.getUniformLocation(this._prog, 'u_time');
    this._uLight = gl.getUniformLocation(this._prog, 'u_light');
    this._uCam   = gl.getUniformLocation(this._prog, 'u_cam');
    this._aUV    = gl.getAttribLocation(this._prog, 'a_uv');
  }

  _initGeometry() {
    const gl = this.gl;
    const N  = Waves.N;

    const uvs = new Float32Array(N * N * 2);
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        uvs[(r*N+c)*2]   = c / (N-1);
        uvs[(r*N+c)*2+1] = r / (N-1);
      }
    this._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const idx = new Uint16Array((N-1) * (N-1) * 6);
    let p = 0;
    for (let r = 0; r < N-1; r++)
      for (let c = 0; c < N-1; c++) {
        const a = r*N+c, b = r*N+c+1, d = (r+1)*N+c, e = (r+1)*N+c+1;
        idx[p++]=a; idx[p++]=d; idx[p++]=b;
        idx[p++]=b; idx[p++]=d; idx[p++]=e;
      }
    this._ibo      = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    this._idxCount = idx.length;
  }

  // Draw the wave surface. st = scene-local time. Camera and light in world space.
  draw(st, ex, ey, ez, lx, ly, lz) {
    const gl = this.gl;
    const proj = mat4pers(Waves.FOV, this.aspect, 0.01, 50);
    const view = mat4look(ex, ey, ez,  0, 0, 0,  0, 1, 0);
    const mvp  = mat4mul(proj, view);

    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this._prog);
    gl.uniformMatrix4fv(this._uMVP,   false, mvp);
    gl.uniform1f(this._uTime,  st);
    gl.uniform3f(this._uLight, lx, ly, lz);
    gl.uniform3f(this._uCam,   ex, ey, ez);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.enableVertexAttribArray(this._aUV);
    gl.vertexAttribPointer(this._aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ibo);
    gl.drawElements(gl.TRIANGLES, this._idxCount, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(this._aUV);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.disable(gl.DEPTH_TEST);
  }
}
