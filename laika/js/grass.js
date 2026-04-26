class Grass {
  static N_ROWS        = 100;
  static N_COLS        = 100;
  static N_LEVELS      = 5;
  static N_SPARKS      = 400;
  static METEOR_T0     = 4.0;          // seconds into scene before meteor appears
  static METEOR_VX     = 0.5 / 3;      // clip/s
  static METEOR_START_X = -1.1;
  static METEOR_START_Y = -0.2;
  static METEOR_PEAK_Y  = 0.52;        // peak y at x=0
  static SHATTER_X      = 1.0 / 3.0;  // 2/3 of the way across (-1..+1)
  static SPARK_GRAVITY  = 0.03;        // clip/s² downward
  static TRAIL_SPARK_MAX  = 80;
  static SHOCKWAVE_T0     = 25.0;  // seconds into scene
  static SHOCKWAVE_SPEED  = 0.38;  // units/s
  static SHOCKWAVE_Y      = 0.042; // just above grass
  static SHOCKWAVE_HW     = 0.015; // half-width of ring
  static SHOCKWAVE_N      = 96;    // ring segments

  constructor(gl, aspect, t0) {
    this.gl       = gl;
    this.aspect   = aspect;
    this.t0       = t0;
    this._initProgram();
    this._initGeometry();
    this._initMeteorProgram();
    this._shockBuf  = gl.createBuffer();
    this._shockData = new Float32Array((Grass.SHOCKWAVE_N + 1) * 2 * 4);
    this._shattered      = false;
    this._shatterT       = 0;
    this._sparks         = null;
    this._trailSparks    = [];
    this._nextTrailEmit  = 0;
  }

  _initProgram() {
    const gl = this.gl;
    this._prog = createProgram(`
      attribute vec3 a_pos;
      attribute float a_bright;
      uniform mat4 u_mvp;
      varying float v_bright;
      void main() { v_bright = a_bright; gl_Position = u_mvp * vec4(a_pos, 1.0); }
    `, `
      precision mediump float;
      varying float v_bright;
      void main() { gl_FragColor = vec4(v_bright, v_bright, v_bright, 1.0); }
    `);
    this._uMVP    = gl.getUniformLocation(this._prog, 'u_mvp');
    this._aPos    = gl.getAttribLocation(this._prog, 'a_pos');
    this._aBright = gl.getAttribLocation(this._prog, 'a_bright');
  }

  _initMeteorProgram() {
    const gl = this.gl;
    this._meteorProg = createProgram(`
      attribute vec2 a_pos;
      attribute float a_bright;
      uniform float u_size;
      varying float v_bright;
      void main() {
        v_bright = a_bright;
        gl_PointSize = u_size;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `, `
      precision mediump float;
      varying float v_bright;
      void main() { gl_FragColor = vec4(v_bright, v_bright, v_bright, 1.0); }
    `);
    this._mUSize   = gl.getUniformLocation(this._meteorProg, 'u_size');
    this._mAPos    = gl.getAttribLocation(this._meteorProg, 'a_pos');
    this._mABright = gl.getAttribLocation(this._meteorProg, 'a_bright');
    this._meteorBuf  = gl.createBuffer();
    this._meteorData = new Float32Array((Grass.N_SPARKS + Grass.TRAIL_SPARK_MAX + 1) * 3);
  }

  _initGeometry() {
    const gl = this.gl;
    const { N_ROWS, N_COLS, N_LEVELS } = Grass;
    const N_STALKS        = N_ROWS * N_COLS;
    const VERTS_PER_STALK = N_LEVELS * 2;
    const totalVerts = N_STALKS * VERTS_PER_STALK + (N_STALKS - 1) * 2;
    const verts = new Float32Array(totalVerts * 4); // x,y,z,bright interleaved

    let vi = 0;
    const push = (x, y, z, b) => { verts[vi++]=x; verts[vi++]=y; verts[vi++]=z; verts[vi++]=b; };

    const cellSize = 1.0 / N_ROWS;
    let prevLastX=0, prevLastY=0, prevLastZ=0, prevLastB=0;

    for (let row = 0; row < N_ROWS; row++) {
      for (let col = 0; col < N_COLS; col++) {
        const stalkIdx = row * N_COLS + col;
        const cx = (col + Math.random()) * cellSize - 0.5;
        const cz = (row + Math.random()) * cellSize - 0.5;

        const height    = 0.02 + 0.02 * Math.random();
        const azimuth   = Math.random() * 2 * Math.PI;
        const curvature = 0.005 + 0.015 * Math.random();
        const baseHalfW = 0.001 + 0.001 * Math.random();
        const bright    = 0.2 + 0.6 * Math.random();

        const lx =  Math.sin(azimuth);
        const lz =  Math.cos(azimuth);
        const bx =  Math.cos(azimuth);
        const bz = -Math.sin(azimuth);

        const firstX = cx + baseHalfW * bx;
        const firstZ = cz + baseHalfW * bz;

        if (stalkIdx > 0) {
          push(prevLastX, prevLastY, prevLastZ, prevLastB);
          push(firstX, 0, firstZ, bright);
        }

        for (let lvl = 0; lvl < N_LEVELS; lvl++) {
          const t    = lvl / (N_LEVELS - 1);
          const y    = t * height;
          const lean = curvature * t * t;
          const hw   = baseHalfW * (1.0 - t);
          const px   = cx + lean * lx;
          const pz   = cz + lean * lz;
          push(px + hw * bx, y, pz + hw * bz, bright);
          push(px - hw * bx, y, pz - hw * bz, bright);
        }

        const tipX = cx + curvature * lx;
        const tipY = height;
        const tipZ = cz + curvature * lz;
        prevLastX=tipX; prevLastY=tipY; prevLastZ=tipZ; prevLastB=bright;
      }
    }

    this._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this._vertCount = totalVerts;
  }

  _spawnSparks(x, y) {
    const n = Grass.N_SPARKS;
    this._sparks = new Array(n);
    // Ring oriented upright in 3D, ~22.5° from edge-on.
    // cos(67.5°) ≈ 0.383 foreshortens the horizontal axis.
    const TILT = Math.cos(67.5 * Math.PI / 180);
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * 2 * Math.PI + (Math.random() - 0.5) * (2 * Math.PI / n);
      const speed = (0.7 + 0.3 * Math.random()) / 8;
      this._sparks[i] = {
        x, y,
        vx: Math.cos(theta) * TILT * speed,
        vy: Math.sin(theta) * speed,
        decay: 0.5 + 1.5 * Math.random(),
      };
    }
  }

  _drawMeteor(st) {
    const gl = this.gl;
    const { METEOR_T0, METEOR_VX, METEOR_START_X, METEOR_START_Y, METEOR_PEAK_Y,
            SHATTER_X, SPARK_GRAVITY, N_SPARKS, TRAIL_SPARK_MAX } = Grass;

    const mt = st - METEOR_T0;
    if (mt < 0) {
      if (this._shattered) { this._shattered = false; this._sparks = null; }
      this._trailSparks = []; this._nextTrailEmit = 0;
      return;
    }

    // Derive arc parameters
    const t_peak    = -METEOR_START_X / METEOR_VX;
    const g_arc     = (METEOR_PEAK_Y - METEOR_START_Y) / (t_peak * t_peak);
    const vy0       = 2 * g_arc * t_peak;
    const t_shatter = (SHATTER_X - METEOR_START_X) / METEOR_VX;

    // Emit a downward trail spark from the meteor's current position ~every 0.25 s
    if (!this._shattered && mt >= this._nextTrailEmit && this._trailSparks.length < TRAIL_SPARK_MAX) {
      const mx = METEOR_START_X + METEOR_VX * mt;
      const my = METEOR_START_Y + vy0 * mt - g_arc * mt * mt;
      this._trailSparks.push({ x: mx, y: my, t0: mt,
        vx: (Math.random() - 0.5) * 0.04,
        vy: -(0.04 + 0.08 * Math.random()) });
      this._nextTrailEmit = mt + 0.1 + Math.random() * 0.3;
    }

    const d = this._meteorData;
    let nPoints = 0;

    if (!this._shattered) {
      if (mt >= t_shatter) {
        const sx = METEOR_START_X + METEOR_VX * t_shatter;
        const sy = METEOR_START_Y + vy0 * t_shatter - g_arc * t_shatter * t_shatter;
        this._shattered = true;
        this._shatterT  = mt;
        this._spawnSparks(sx, sy);
      } else {
        const mx = METEOR_START_X + METEOR_VX * mt;
        const my = METEOR_START_Y + vy0 * mt - g_arc * mt * mt;
        d[0]=mx; d[1]=my; d[2]=1.0;
        nPoints = 1;
      }
    }

    if (this._shattered) {
      const dt = mt - this._shatterT;
      for (let i = 0; i < N_SPARKS; i++) {
        const sp = this._sparks[i];
        const lt = dt / sp.decay;
        if (lt >= 1.0) continue;
        const base = nPoints * 3;
        d[base]   = sp.x + sp.vx * dt;
        d[base+1] = sp.y + sp.vy * dt - 0.5 * SPARK_GRAVITY * dt * dt;
        d[base+2] = 1.0 - lt;
        nPoints++;
      }
    }

    // Draw trail sparks (fade out over ~0.4 s, dimmer than explosion)
    for (const ts of this._trailSparks) {
      const dt  = mt - ts.t0;
      const lt  = dt / 0.4;
      if (lt >= 1.0) continue;
      const base = nPoints * 3;
      d[base]   = ts.x + ts.vx * dt;
      d[base+1] = ts.y + ts.vy * dt - 0.5 * SPARK_GRAVITY * dt * dt;
      d[base+2] = (1.0 - lt) * 0.6;
      nPoints++;
    }

    if (nPoints === 0) return;

    gl.useProgram(this._meteorProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._meteorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, nPoints * 3), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this._mAPos);
    gl.enableVertexAttribArray(this._mABright);
    gl.vertexAttribPointer(this._mAPos,    2, gl.FLOAT, false, 12, 0);
    gl.vertexAttribPointer(this._mABright, 1, gl.FLOAT, false, 12, 8);
    gl.uniform1f(this._mUSize, this._shattered ? 2.0 : 1.0);
    gl.drawArrays(gl.POINTS, 0, nPoints);
    gl.disableVertexAttribArray(this._mAPos);
    gl.disableVertexAttribArray(this._mABright);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _drawShockwave(st, mvp) {
    const { SHOCKWAVE_T0, SHOCKWAVE_SPEED, SHOCKWAVE_Y, SHOCKWAVE_HW, SHOCKWAVE_N } = Grass;
    const age = st - SHOCKWAVE_T0;
    if (age < 0) return;
    const R = age * SHOCKWAVE_SPEED;
    const bright = Math.max(0, 1.0 - R / 0.85);
    if (bright <= 0 || R <= SHOCKWAVE_HW) return;

    const d = this._shockData;
    for (let k = 0; k <= SHOCKWAVE_N; k++) {
      const a  = k / SHOCKWAVE_N * 2 * Math.PI;
      const cx = Math.cos(a), cz = Math.sin(a);
      const base = k * 8;
      d[base]   = cx * (R + SHOCKWAVE_HW); d[base+1] = SHOCKWAVE_Y; d[base+2] = cz * (R + SHOCKWAVE_HW); d[base+3] = bright;
      d[base+4] = cx * (R - SHOCKWAVE_HW); d[base+5] = SHOCKWAVE_Y; d[base+6] = cz * (R - SHOCKWAVE_HW); d[base+7] = bright;
    }

    const gl = this.gl;
    gl.useProgram(this._prog);
    gl.uniformMatrix4fv(this._uMVP, false, mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._shockBuf);
    gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this._aPos);
    gl.enableVertexAttribArray(this._aBright);
    gl.vertexAttribPointer(this._aPos,    3, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(this._aBright, 1, gl.FLOAT, false, 16, 12);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, (SHOCKWAVE_N + 1) * 2);
    gl.disableVertexAttribArray(this._aPos);
    gl.disableVertexAttribArray(this._aBright);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  draw(ts_s) {
    const gl  = this.gl;
    const st  = Math.max(0, ts_s - this.t0);
    const angle = st * (2 * Math.PI / 400);
    const camR  = 0.55;
    const camY  = 0.04;
    const ex = Math.sin(angle) * camR;
    const ez = Math.cos(angle) * camR;
    const proj = mat4pers(52 * Math.PI / 180, this.aspect, 0.001, 5);
    const view = mat4look(ex, camY, ez,  0, 0.025, 0,  0, 1, 0);
    const mvp  = mat4mul(proj, view);

    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this._prog);
    gl.uniformMatrix4fv(this._uMVP, false, mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.enableVertexAttribArray(this._aPos);
    gl.enableVertexAttribArray(this._aBright);
    gl.vertexAttribPointer(this._aPos,    3, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(this._aBright, 1, gl.FLOAT, false, 16, 12);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this._vertCount);
    gl.disableVertexAttribArray(this._aPos);
    gl.disableVertexAttribArray(this._aBright);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this._drawShockwave(st, mvp);
    gl.disable(gl.DEPTH_TEST);

    this._drawMeteor(st);
  }
}
