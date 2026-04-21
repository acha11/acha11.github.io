class WarpStars {
  static N       = 450;
  static VPX     = 1/3;   // vanishing point clip x (2/3 across → clip 1/3)
  static VPY     = 0.0;
  static ZMAX    = 1.0;
  static ZMIN    = 0.015;
  static SPEED   = 0.4;   // z units per second
  static SCALE   = 2.0;   // lateral spread at z=1
  static TRAIL_T = 0.18;  // seconds of trail shown

  constructor(gl) {
    this.gl      = gl;
    this._stars  = [];
    this._verts  = new Float32Array(WarpStars.N * 6); // [x,y,b] × 2
    this._lastTs = -1;
    this._initProgram();
    this._initBuffer();
    for (let i = 0; i < WarpStars.N; i++)
      this._stars.push(this._spawn(Math.random() * WarpStars.ZMAX));
  }

  _initProgram() {
    const gl = this.gl;
    this._prog = createProgram(`
      precision mediump float;
      attribute vec2 a_pos;
      attribute float a_brightness;
      varying float v_bright;
      void main() {
        v_bright = a_brightness;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `, `
      precision mediump float;
      varying float v_bright;
      void main() { gl_FragColor = vec4(v_bright, v_bright, v_bright, 1.0); }
    `);
    this._aPos   = gl.getAttribLocation(this._prog, 'a_pos');
    this._aBrite = gl.getAttribLocation(this._prog, 'a_brightness');
  }

  _initBuffer() {
    const gl = this.gl;
    this._buf = gl.createBuffer();
  }

  _spawn(z) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.02 + Math.random() * 0.95;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, z, lum: 0.5 + Math.random() * 0.5 };
  }

  draw(ts_s) {
    const gl = this.gl;
    const { N, VPX, VPY, ZMAX, ZMIN, SPEED, SCALE, TRAIL_T } = WarpStars;

    if (ts_s < this._lastTs - 0.1) {
      this._stars.length = 0;
      for (let i = 0; i < N; i++) this._stars.push(this._spawn(Math.random() * ZMAX));
    }
    const dt = this._lastTs < 0 ? 0 : Math.min(ts_s - this._lastTs, 0.05);
    this._lastTs = ts_s;

    let vi = 0;
    for (const s of this._stars) {
      s.z -= SPEED * dt;
      if (s.z < ZMIN) Object.assign(s, this._spawn(ZMAX));
      const tailZ  = s.z + SPEED * TRAIL_T;
      const headX  = VPX + s.x * SCALE / s.z;
      const headY  = VPY + s.y * SCALE / s.z;
      const tailX  = VPX + s.x * SCALE / tailZ;
      const tailY  = VPY + s.y * SCALE / tailZ;
      const bright = s.lum * Math.pow(1.0 - s.z / ZMAX, 2);
      this._verts[vi++] = headX; this._verts[vi++] = headY; this._verts[vi++] = bright;
      this._verts[vi++] = tailX; this._verts[vi++] = tailY; this._verts[vi++] = 0.0;
    }

    gl.useProgram(this._prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buf);
    gl.bufferData(gl.ARRAY_BUFFER, this._verts, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this._aPos);
    gl.enableVertexAttribArray(this._aBrite);
    gl.vertexAttribPointer(this._aPos,   2, gl.FLOAT, false, 12, 0);
    gl.vertexAttribPointer(this._aBrite, 1, gl.FLOAT, false, 12, 8);
    gl.drawArrays(gl.LINES, 0, N * 2);
    gl.disableVertexAttribArray(this._aPos);
    gl.disableVertexAttribArray(this._aBrite);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
}
