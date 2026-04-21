class Sierpinski {
  static R       = 4.0;
  static DEPTH   = 3;
  static T0      = 86.5;
  static ASPECT  = 612 / 439; // stork image width / height

  constructor(gl, aspect) {
    this.gl     = gl;
    this.aspect = aspect;
    this._ready = false;
    this._initProgram();
    this._initGeometry();
  }

  _initProgram() {
    const gl = this.gl;
    this._prog = createProgram(`
      attribute vec3 a_center;
      attribute vec2 a_local;
      attribute vec2 a_uv;
      uniform mat4 u_view;
      uniform mat4 u_proj;
      uniform vec3 u_right;
      uniform vec3 u_up;
      varying vec2 v_uv;
      void main() {
        vec3 pos = a_center + u_right * a_local.x + u_up * a_local.y;
        gl_Position = u_proj * u_view * vec4(pos, 1.0);
        v_uv = a_uv;
      }
    `, `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      void main() { gl_FragColor = texture2D(u_tex, v_uv); }
    `);
    this._uView  = gl.getUniformLocation(this._prog, 'u_view');
    this._uProj  = gl.getUniformLocation(this._prog, 'u_proj');
    this._uRight = gl.getUniformLocation(this._prog, 'u_right');
    this._uUp    = gl.getUniformLocation(this._prog, 'u_up');
    this._uTex   = gl.getUniformLocation(this._prog, 'u_tex');
    this._aCenter = gl.getAttribLocation(this._prog, 'a_center');
    this._aLocal  = gl.getAttribLocation(this._prog, 'a_local');
    this._aUV     = gl.getAttribLocation(this._prog, 'a_uv');
  }

  _initGeometry() {
    const gl = this.gl;
    const { R, DEPTH, ASPECT } = Sierpinski;

    // Recursive Sierpinski leaf positions (2D midpoint subdivision)
    function leaves(v0, v1, v2, depth) {
      if (depth === 0) {
        const cx = (v0[0]+v1[0]+v2[0])/3, cy = (v0[1]+v1[1]+v2[1])/3;
        return [{ c: [cx, cy, 0], hs: Math.hypot(v1[0]-v0[0], v1[1]-v0[1]) * 0.84 }];
      }
      const mid = (a, b) => [(a[0]+b[0])/2, (a[1]+b[1])/2];
      const m01=mid(v0,v1), m12=mid(v1,v2), m02=mid(v0,v2);
      return [...leaves(v0,m01,m02,depth-1), ...leaves(m01,v1,m12,depth-1), ...leaves(m02,m12,v2,depth-1)];
    }

    // Triangle in XZ plane, 15° Y rotation: apex far, base close
    const s15 = 15*Math.PI/180, c15 = Math.cos(s15), sn15 = Math.sin(s15);
    this._leaves = leaves(
      [0, -R*1.5], [-R*Math.sqrt(3)/2, 0], [R*Math.sqrt(3)/2, 0], DEPTH
    ).map(({ c, hs }) => {
      const x = c[0], z = c[1];
      return { c: [x*c15 - z*sn15, -1, x*sn15 + z*c15], hs };
    });

    // Per-leaf lag/damp relative to apex (most negative Z)
    const apexC = this._leaves.reduce((a, l) => l.c[2] < a[2] ? l.c : a, this._leaves[0].c);
    const maxD  = Math.max(...this._leaves.map(l =>
      Math.hypot(l.c[0]-apexC[0], l.c[1]-apexC[1], l.c[2]-apexC[2])));
    this._params  = this._leaves.map(l => {
      const t = Math.hypot(l.c[0]-apexC[0], l.c[1]-apexC[1], l.c[2]-apexC[2]) / (maxD || 1);
      return { lag: t*1.8, damp: 1-t*0.72 };
    });
    this._apexC = apexC;

    this._corners = [[-1,-1,0,0],[1,-1,1,0],[1,1,1,1],[-1,-1,0,0],[1,1,1,1],[-1,1,0,1]];
    this._vboData = new Float32Array(this._leaves.length * 6 * 7);
    this._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this._vboData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this._tex = gl.createTexture();
  }

  init() {
    return new Promise((resolve) => {
      const gl  = this.gl;
      const img = new Image();
      img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, this._tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this._ready = true;
        resolve();
      };
      img.src = 'assets/stork_masked.png';
    });
  }

  draw(ts_s) {
    if (!this._ready) return;
    const gl = this.gl;
    const { T0, ASPECT } = Sierpinski;
    const st = Math.max(0, ts_s - T0);

    const ZOOM_DELAY = 3.0, ZOOM_DUR = 24.0;
    const tZ   = Math.min(Math.max(st - ZOOM_DELAY, 0) / ZOOM_DUR, 1.0);
    const ease = tZ * tZ * (3 - 2 * tZ);

    const TAU = 2 * Math.PI;
    const oscAt = (t) => [
      0.0583*Math.sin(TAU*t/4.7) + 0.0233*Math.sin(TAU*t/2.1) + 0.00833*Math.sin(TAU*t/1.05),
      0.2625*Math.sin(TAU*t/5.3) + 0.1125*Math.sin(TAU*t/2.6) + 0.045*Math.sin(TAU*t/1.3),
      0.125*Math.sin(TAU*t/6.1) + 0.05*Math.sin(TAU*t/3.0) + 0.02*Math.sin(TAU*t/1.4),
    ];

    let vi = 0;
    for (let i = 0; i < this._leaves.length; i++) {
      const { c, hs } = this._leaves[i];
      const { lag, damp } = this._params[i];
      const [ox, oy, oz] = oscAt(ts_s - lag).map(v => v * damp);
      for (const [lx, ly, u, v] of this._corners) {
        this._vboData[vi++] = c[0]+ox; this._vboData[vi++] = c[1]+oy; this._vboData[vi++] = c[2]+oz;
        this._vboData[vi++] = lx*hs*ASPECT; this._vboData[vi++] = ly*hs;
        this._vboData[vi++] = u; this._vboData[vi++] = v;
      }
    }

    const ac = this._apexC;
    const dist = 2.0 + (16.0 - 2.0) * ease;
    const ey   = 0.5 + (2.0 - 0.5)  * ease;
    const tx   = ac[0] * (1-ease) + 0.78 * ease;
    const ty_t = ac[1] * (1-ease) + (-1)  * ease;
    const tz   = ac[2] * (1-ease) + (-2.9) * ease;
    const ex   = 0, ez = dist;
    const proj = mat4pers(42 * Math.PI/180, this.aspect, 0.1, 100);
    const view = mat4look(ex, ey, ez, tx, ty_t, tz, 0, 1, 0);
    const fwd  = [tx-ex, ty_t-ey, tz-ez], fl = Math.hypot(...fwd);
    const fn   = fwd.map(v => v/fl);
    const rn   = [-fn[2], 0, fn[0]];
    const rl   = Math.hypot(...rn);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this._prog);
    gl.uniformMatrix4fv(this._uProj, false, proj);
    gl.uniformMatrix4fv(this._uView, false, view);
    gl.uniform3fv(this._uRight, rn.map(v => v/rl));
    gl.uniform3fv(this._uUp,    [0, 1, 0]);
    gl.uniform1i(this._uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._vboData);
    const stride = 28;
    gl.enableVertexAttribArray(this._aCenter);
    gl.enableVertexAttribArray(this._aLocal);
    gl.enableVertexAttribArray(this._aUV);
    gl.vertexAttribPointer(this._aCenter, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(this._aLocal,  2, gl.FLOAT, false, stride, 12);
    gl.vertexAttribPointer(this._aUV,     2, gl.FLOAT, false, stride, 20);
    gl.drawArrays(gl.TRIANGLES, 0, this._leaves.length * 6);
    gl.disableVertexAttribArray(this._aCenter);
    gl.disableVertexAttribArray(this._aLocal);
    gl.disableVertexAttribArray(this._aUV);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }
}
