class SolarSystem2 {
  // Replicate camera constants from laika.html exactly
  static T0             = 26.29;
  static TIME_SCALE     = 0.1;
  static CAM_INTRO      = 12.0;
  static CAM_PERIOD     = 20.0;
  static CAM_AMP        = 20 * Math.PI / 180;
  static CAM_END        = Math.PI / 2 + 20 * Math.PI / 180;
  static CAM_AZ_PERIOD  = 60.0;
  static CAM_ZOOM_PERIOD = 60.0;
  static ORBIT_N        = 256;
  static GAP            = 0.15;
  static SUN_R          = 0.36;
  static SUN_N          = 32;

  constructor(gl, FW, FH, t0 = 0) {
    this.gl            = gl;
    this.t0            = t0;
    this._activationTs = t0;
    this._timeOffset   = 0;
    const PLUTO = SolarSystem.PLANETS[8];
    const MAX_D = Math.sqrt(PLUTO.a) * (1 + PLUTO.e);
    this._SY = 0.9 / MAX_D;
    this._SX = this._SY * (FH / FW);
    this._initOrbitProgram();
    this._initSunProgram();
    this._grid = new CrtGrid(gl);
    this._initGeometry();
  }

  _initOrbitProgram() {
    const gl = this.gl;
    this._orbitProg = createProgram(`
      attribute vec3 a_pos;
      uniform mat4 u_mvp;
      void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }
    `, `
      precision mediump float;
      uniform vec4 u_color;
      void main() { gl_FragColor = u_color; }
    `);
    this._orbitUMVP  = gl.getUniformLocation(this._orbitProg, 'u_mvp');
    this._orbitUColor = gl.getUniformLocation(this._orbitProg, 'u_color');
    this._orbitAPos  = gl.getAttribLocation(this._orbitProg, 'a_pos');
    this._orbitVbo   = gl.createBuffer();
  }

  _initSunProgram() {
    const gl = this.gl;
    // Sun is a 2D billboard: offsets in display units, scaled to clip space,
    // always circular regardless of camera tilt. Writes clip_z = 0 (depth 0.5).
    this._sunProg = createProgram(`
      attribute vec2 a_offset;
      uniform vec2 u_scale;
      void main() {
        gl_Position = vec4(a_offset.x * u_scale.x, a_offset.y * u_scale.y, 0.0, 1.0);
      }
    `, `
      precision mediump float;
      void main() { gl_FragColor = vec4(1.0, 1.0, 0.5, 1.0); }
    `);
    this._sunUScale  = gl.getUniformLocation(this._sunProg, 'u_scale');
    this._sunAOffset = gl.getAttribLocation(this._sunProg, 'a_offset');
    this._sunVbo     = gl.createBuffer();
  }

  _initGeometry() {
    const gl = this.gl;
    const { SUN_R, SUN_N, ORBIT_N } = SolarSystem2;

    const sunVerts = new Float32Array((SUN_N + 2) * 2);
    sunVerts[0] = 0; sunVerts[1] = 0;
    for (let k = 0; k <= SUN_N; k++) {
      const a = k / SUN_N * 2 * Math.PI;
      sunVerts[2 + k*2]     = Math.cos(a) * SUN_R;
      sunVerts[2 + k*2 + 1] = Math.sin(a) * SUN_R;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._sunVbo);
    gl.bufferData(gl.ARRAY_BUFFER, sunVerts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this._orbitVerts = new Float32Array((ORBIT_N + 1) * 3);
  }

  _camZoom(ts_s) {
    return 1.0 / (0.55 + 0.45 * Math.cos(2 * Math.PI * ts_s / SolarSystem2.CAM_ZOOM_PERIOD));
  }

  _camTheta(ts_s) {
    const { CAM_INTRO, CAM_AMP, CAM_END, CAM_PERIOD } = SolarSystem2;
    if (ts_s < CAM_INTRO) {
      const x = ts_s / CAM_INTRO;
      return CAM_END * x * x * (3 - 2 * x);
    }
    return Math.PI / 2 + CAM_AMP * Math.cos(2 * Math.PI * (ts_s - CAM_INTRO) / CAM_PERIOD);
  }

  // Build the orthographic MVP that exactly replicates the 2D camera transform:
  //   clip_x = (x·cPhi  - y·sPhi) · sx
  //   clip_y = (x·sPhi·cTh + y·cPhi·cTh + z·sTh) · sy
  //   clip_z = (x·sPhi·sTh + y·cPhi·sTh - z·cTh) · sz   ← real depth for z-test
  _buildMVP(cPhi, sPhi, cTh, sTh, sx, sy) {
    const sz = 0.1; // depth scale: Pluto aphelion (~7.85) maps to clip_z ≈ 0.785
    return new Float32Array([
      cPhi*sx,      sPhi*cTh*sy, sPhi*sTh*sz, 0,  // col 0
     -sPhi*sx,      cPhi*cTh*sy, cPhi*sTh*sz, 0,  // col 1
      0,            sTh*sy,     -cTh*sz,       0,  // col 2
      0,            0,           0,            1,  // col 3
    ]);
  }

  activate(ts_s, params = {}) {
    this._activationTs = ts_s;
    this._timeOffset   = params.timeOffset ?? 0;
  }

  getSt(ts_s) {
    return this._timeOffset + Math.max(0, ts_s - this._activationTs);
  }

  draw(ts_s) {
    const gl = this.gl;
    const { T0, TIME_SCALE, ORBIT_N, GAP, SUN_N } = SolarSystem2;

    const st   = this.getSt(ts_s);
    const t    = T0 + st * TIME_SCALE;
    const th   = this._camTheta(st);
    const cTh  = Math.cos(th), sTh = Math.sin(th);
    const phi  = st * (2 * Math.PI / SolarSystem2.CAM_AZ_PERIOD);
    const cPhi = Math.cos(phi), sPhi = Math.sin(phi);
    const zoom = this._camZoom(st);
    const sx   = this._SX * zoom;
    const sy   = this._SY * zoom;

    this._grid.draw();

    gl.enable(gl.DEPTH_TEST);

    // Orbits (3D, write depth) — orbit segments behind the sun will be
    // occluded when the sun is drawn over them at depth 0.5.
    const mvp = this._buildMVP(cPhi, sPhi, cTh, sTh, sx, sy);
    gl.useProgram(this._orbitProg);
    gl.uniformMatrix4fv(this._orbitUMVP, false, mvp);
    gl.uniform4f(this._orbitUColor, 0.5, 0.5, 0.5, 0.5);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._orbitVbo);
    gl.enableVertexAttribArray(this._orbitAPos);
    gl.vertexAttribPointer(this._orbitAPos, 3, gl.FLOAT, false, 0, 0);
    for (const p of SolarSystem.PLANETS) {
      const Ep = SolarSystem.eccAnomaly(p, t);
      const E0 = Ep + GAP, E1 = Ep + 2 * Math.PI - GAP;
      for (let k = 0; k <= ORBIT_N; k++) {
        const E = E0 + (E1 - E0) * k / ORBIT_N;
        const [x, y, z] = SolarSystem.orbitPoint(p, E);
        this._orbitVerts[k*3] = x; this._orbitVerts[k*3+1] = y; this._orbitVerts[k*3+2] = z;
      }
      gl.bufferData(gl.ARRAY_BUFFER, this._orbitVerts, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINE_STRIP, 0, ORBIT_N + 1);
    }
    gl.disableVertexAttribArray(this._orbitAPos);

    // Sun billboard (clip_z = 0 → depth 0.5). Orbit segments at depth > 0.5
    // (geometrically behind the origin from the camera) fail GL_LESS and are hidden.
    gl.useProgram(this._sunProg);
    gl.uniform2f(this._sunUScale, sx, sy);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._sunVbo);
    gl.enableVertexAttribArray(this._sunAOffset);
    gl.vertexAttribPointer(this._sunAOffset, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, SUN_N + 2);
    gl.disableVertexAttribArray(this._sunAOffset);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.disable(gl.DEPTH_TEST);
  }
}
