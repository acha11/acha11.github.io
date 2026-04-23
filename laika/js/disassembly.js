class Disassembly {
  static N_SLICES     = 32;
  static N_LONG       = 12;
  static ROT_SPEED    = 0.5;
  static ELONGATE_AMP = 0.7;
  static N_STARS      = 800;

  constructor(gl, FW, FH, t0) {
    this.gl     = gl;
    this.aspect = FW / FH;
    this._FW    = FW;
    this._FH    = FH;
    this.t0     = t0;
    this._initProgram();
    this._initCircleProgram();
    this._initStarProgram();
    this._initGeometry();
    this._initSliceState();
    this._initCamState();
    this._grid = new CrtGrid(gl);
  }

  _initProgram() {
    const gl = this.gl;
    this._prog = createProgram(`
      attribute vec3 a_pos;
      attribute vec3 a_normal;
      uniform mat4 u_mvp;
      uniform float u_rot;
      uniform float u_y_offset;
      varying vec3 v_normal;
      void main() {
        float c = cos(u_rot), s = sin(u_rot);
        vec3 rp = vec3(a_pos.x*c - a_pos.z*s, a_pos.y, a_pos.x*s + a_pos.z*c);
        vec3 rn = vec3(a_normal.x*c - a_normal.z*s, a_normal.y, a_normal.x*s + a_normal.z*c);
        v_normal = rn;
        gl_Position = u_mvp * vec4(rp.x, rp.y + u_y_offset, rp.z, 1.0);
      }
    `, `
      precision mediump float;
      varying vec3 v_normal;
      uniform vec3 u_light;
      void main() {
        float d = max(dot(normalize(v_normal), u_light), 0.0);
        float b = 0.12 + 0.88 * d;
        gl_FragColor = vec4(b, b, b, 1.0);
      }
    `);
    this._uMVP     = gl.getUniformLocation(this._prog, 'u_mvp');
    this._uRot     = gl.getUniformLocation(this._prog, 'u_rot');
    this._uYOffset = gl.getUniformLocation(this._prog, 'u_y_offset');
    this._uLight   = gl.getUniformLocation(this._prog, 'u_light');
    this._aPos    = gl.getAttribLocation(this._prog, 'a_pos');
    this._aNormal = gl.getAttribLocation(this._prog, 'a_normal');
  }

  _initCircleProgram() {
    const gl = this.gl;
    this._circleProg = createProgram(`
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `, `
      precision mediump float;
      uniform vec2  u_center;
      uniform float u_radius;
      void main() {
        if (length(gl_FragCoord.xy - u_center) > u_radius) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      }
    `);
    this._circleUCenter = gl.getUniformLocation(this._circleProg, 'u_center');
    this._circleURadius = gl.getUniformLocation(this._circleProg, 'u_radius');
    this._circleAPos    = gl.getAttribLocation(this._circleProg, 'a_pos');
    this._circleQuad    = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._circleQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _initStarProgram() {
    const gl = this.gl;
    const { N_STARS } = Disassembly;
    this._starProg = createProgram(`
      attribute vec4 a_star; // xyz = direction, w = brightness
      uniform mat4 u_mvp;
      varying float v_b;
      void main() {
        v_b = a_star.w;
        gl_PointSize = 1.0;
        gl_Position = u_mvp * vec4(a_star.xyz, 1.0);
      }
    `, `
      precision mediump float;
      varying float v_b;
      void main() { gl_FragColor = vec4(v_b, v_b, v_b, 1.0); }
    `);
    this._starUMVP = gl.getUniformLocation(this._starProg, 'u_mvp');
    this._starAStar = gl.getAttribLocation(this._starProg, 'a_star');

    // Generate random unit directions with brightness, placed at radius 100
    const data = new Float32Array(N_STARS * 4);
    for (let i = 0; i < N_STARS; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * 2 * Math.PI;
      const r = Math.sqrt(1 - u * u);
      data[i*4]   = r * Math.cos(t) * 100;
      data[i*4+1] = u * 100;
      data[i*4+2] = r * Math.sin(t) * 100;
      data[i*4+3] = 0.3 + 0.7 * Math.random();
    }
    this._starVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._starVbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _initGeometry() {
    const gl = this.gl;
    const { N_SLICES, N_LONG } = Disassembly;

    const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const sub   = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
    const norm  = v => { const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); return [v[0]/l, v[1]/l, v[2]/l]; };

    // Random slice heights: generate weights, normalise to cover full PI range
    const weights = Array.from({ length: N_SLICES }, () => 0.2 + Math.random());
    const wSum = weights.reduce((a, b) => a + b, 0);
    this._phiBounds = [- Math.PI / 2];
    const phiBounds = this._phiBounds;
    for (let s = 0; s < N_SLICES; s++)
      phiBounds.push(phiBounds[s] + weights[s] / wSum * Math.PI);

    this._sliceVbos    = [];
    this._sliceVcounts = [];

    for (let s = 0; s < N_SLICES; s++) {
      const phi1 = phiBounds[s];
      const phi2 = phiBounds[s + 1];
      const pt = (phi, theta) => [
        Math.cos(phi) * Math.cos(theta),
        Math.sin(phi),
        Math.cos(phi) * Math.sin(theta),
      ];

      const verts = [];
      const addTri = (p0, p1, p2) => {
        const n = norm(cross(sub(p1, p0), sub(p2, p0)));
        for (const p of [p0, p1, p2]) verts.push(...p, ...n);
      };
      const addFlatTri = (p0, p1, p2, n) => {
        for (const p of [p0, p1, p2]) verts.push(...p, ...n);
      };

      for (let j = 0; j < N_LONG; j++) {
        const t1 = 2 * Math.PI * j / N_LONG;
        const t2 = 2 * Math.PI * (j + 1) / N_LONG;
        const p00 = pt(phi1, t1), p01 = pt(phi1, t2);
        const p10 = pt(phi2, t1), p11 = pt(phi2, t2);
        addTri(p00, p10, p01);
        addTri(p10, p11, p01);

        // Top cap at phi2, normal up
        const yT = Math.sin(phi2), rT = Math.cos(phi2);
        const cT = [0, yT, 0];
        addFlatTri(cT, [rT*Math.cos(t2), yT, rT*Math.sin(t2)], [rT*Math.cos(t1), yT, rT*Math.sin(t1)], [0, 1, 0]);

        // Bottom cap at phi1, normal down
        const yB = Math.sin(phi1), rB = Math.cos(phi1);
        const cB = [0, yB, 0];
        addFlatTri(cB, [rB*Math.cos(t1), yB, rB*Math.sin(t1)], [rB*Math.cos(t2), yB, rB*Math.sin(t2)], [0, -1, 0]);
      }

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this._sliceVbos.push(vbo);
      this._sliceVcounts.push(verts.length / 6);
    }
  }

  _initCamState() {
    this._camPos      = [0, 0.3, 3.5];
    this._camFrom     = [0, 0.3, 3.5];
    this._camTo       = [0, 0.3, 3.5];
    this._camLerpT    = -1;
    this._nextCamMove = 20;
  }

  _randomCamPos(st) {
    const r  = st >= 40 ? 3.3 : 3.5 + 6.5 * Math.random();
    const az = (Math.random() - 0.5) * Math.PI;
    const el = (Math.random() - 0.5) * (2 * Math.PI / 3); // ±60°
    return [r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az)];
  }

  _updateCam(st) {
    if (st < 20) return this._camPos;
    if (st >= this._nextCamMove) {
      this._camFrom     = [...this._camPos];
      this._camTo       = this._randomCamPos(st);
      this._camLerpT    = st;
      this._nextCamMove = st + 0.2 + 0.3 + Math.random() * 1;
    }
    const p = Math.min((st - this._camLerpT) / 0.2, 1.0);
    this._camPos = [
      this._camFrom[0] + (this._camTo[0] - this._camFrom[0]) * p,
      this._camFrom[1] + (this._camTo[1] - this._camFrom[1]) * p,
      this._camFrom[2] + (this._camTo[2] - this._camFrom[2]) * p,
    ];
    return this._camPos;
  }

  _initSliceState() {
    const { N_SLICES, ROT_SPEED } = Disassembly;
    this._slices = Array.from({ length: N_SLICES }, () => ({
      angle:        0,
      speed:        ROT_SPEED,
      nextFlipT:    2.75 + Math.random() * 1.5,
      jitterOffset: 0,
      jitterEndT:   0,
      nextJitterT:  7 + Math.random() * 2,
      hideEndT:     0,
      nextHideT:    5 + Math.random() * 8,
    }));
    this._prevSt    = 0;
    this._elongState = 'idle';
    this._elongStateT = 0;
    this._nextElongT  = 8 + Math.random() * 4;
  }

  _updateElong(st) {
    switch (this._elongState) {
      case 'idle':
        if (st >= this._nextElongT) { this._elongState = 'in'; this._elongStateT = st; }
        return 0;
      case 'in': {
        const p = (st - this._elongStateT) / 0.05;
        if (p >= 1) { this._elongState = 'hold'; this._elongStateT = st; return 1; }
        return p;
      }
      case 'hold':
        if (st - this._elongStateT >= 0.18) { this._elongState = 'out'; this._elongStateT = st; }
        return 1;
      case 'out': {
        const p = (st - this._elongStateT) / 0.05;
        if (p >= 1) { this._elongState = 'idle'; this._nextElongT = st + 2 + Math.random() * 5; return 0; }
        return 1 - p;
      }
    }
    return 0;
  }

  _updateSlices(st) {
    if (st < this._prevSt - 0.5) { this._initSliceState(); this._initCamState(); }
    const dt = Math.min(Math.abs(st - this._prevSt), 0.1) * Math.sign(st - this._prevSt);
    this._prevSt = st;
    const p = Math.min(st / 10.0, 1.0);
    const speedMult = 1.0 + 3.0 * p * p * (3 - 2 * p); // smoothstep 1→4 over 10s
    for (const sl of this._slices) {
      if (st >= sl.nextFlipT) {
        sl.speed     = -sl.speed;
        sl.nextFlipT = st + 0.5 + Math.random() * 2;
      }
      sl.angle += sl.speed * speedMult * dt;

      if (st >= 5) {
        if (sl.hideEndT > 0 && st >= sl.hideEndT) {
          sl.hideEndT  = 0;
          sl.nextHideT = st + 1 + Math.random() * 4;
        }
        if (sl.hideEndT === 0 && st >= sl.nextHideT) {
          sl.hideEndT = st + 0.25;
        }
      }

      if (st >= 7) {
        const jitterScale = Math.max(0.05, 1.0 - 0.95 * Math.min((st - 7) / 10, 1.0));
        if (sl.jitterOffset !== 0 && st >= sl.jitterEndT) {
          sl.jitterOffset = 0;
          sl.nextJitterT  = st + (0.3 + Math.random() * 2) * jitterScale;
        }
        if (sl.jitterOffset === 0 && st >= sl.nextJitterT) {
          sl.jitterOffset = (Math.random() - 0.5) * 0.3;
          sl.jitterEndT   = st + 0.04 + Math.random() * 0.12;
        }
      }
    }
  }

  draw(ts_s) {
    const gl = this.gl;
    const st = Math.max(0, ts_s - this.t0);
    const { N_SLICES } = Disassembly;

    this._grid.draw();
    this._updateSlices(st);

    const [ex, ey, ez] = this._updateCam(st);
    const proj = mat4pers(40 * Math.PI / 180, this.aspect, 0.1, 200);
    const view = mat4look(ex, ey, ez,  0, 0, 0,  0, 1, 0);
    const mvp  = mat4mul(proj, view);

    // Stars — use rotation-only view (camera at origin facing same direction)
    const starView = mat4look(0, 0, 0,  -ex, -ey, -ez,  0, 1, 0);
    const starMVP  = mat4mul(proj, starView);
    gl.useProgram(this._starProg);
    gl.uniformMatrix4fv(this._starUMVP, false, starMVP);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._starVbo);
    gl.enableVertexAttribArray(this._starAStar);
    gl.vertexAttribPointer(this._starAStar, 4, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, Disassembly.N_STARS);
    gl.disableVertexAttribArray(this._starAStar);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const lx = 0.6, ly = 0.8, lz = 0.4;
    const ll = Math.sqrt(lx*lx + ly*ly + lz*lz);

    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this._prog);
    gl.uniformMatrix4fv(this._uMVP, false, mvp);
    gl.uniform3f(this._uLight, lx/ll, ly/ll, lz/ll);

    const spread = Disassembly.ELONGATE_AMP * this._updateElong(st);

    for (let s = 0; s < N_SLICES; s++) {
      if (st < this._slices[s].hideEndT) continue;
      const phiMid = (this._phiBounds[s] + this._phiBounds[s + 1]) / 2;
      gl.uniform1f(this._uYOffset, spread * Math.sin(phiMid) + this._slices[s].jitterOffset);
      gl.uniform1f(this._uRot, this._slices[s].angle);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._sliceVbos[s]);
      gl.enableVertexAttribArray(this._aPos);
      gl.enableVertexAttribArray(this._aNormal);
      gl.vertexAttribPointer(this._aPos,    3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(this._aNormal, 3, gl.FLOAT, false, 24, 12);
      gl.drawArrays(gl.TRIANGLES, 0, this._sliceVcounts[s]);
    }
    gl.disableVertexAttribArray(this._aPos);
    gl.disableVertexAttribArray(this._aNormal);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.disable(gl.DEPTH_TEST);

    if (st >= 35) {
      const p      = Math.min((st - 35) / 30, 1.0);
      const maxR   = Math.sqrt(this._FW * this._FW + this._FH * this._FH) / 2;
      const radius = p * maxR;
      gl.useProgram(this._circleProg);
      gl.uniform2f(this._circleUCenter, this._FW / 2, this._FH / 2);
      gl.uniform1f(this._circleURadius, radius);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._circleQuad);
      gl.enableVertexAttribArray(this._circleAPos);
      gl.vertexAttribPointer(this._circleAPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(this._circleAPos);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }
}
