class Disassembly {
  static N_SLICES  = 32;
  static N_LONG    = 12;
  static ROT_SPEED    = 0.5;   // rad/s base rotation
  static ELONGATE_AMP = 0.7;   // max Y spread at peak

  constructor(gl, aspect, t0) {
    this.gl     = gl;
    this.aspect = aspect;
    this.t0     = t0;
    this._initProgram();
    this._initGeometry();
    this._initSliceState();
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

  _initSliceState() {
    const { N_SLICES, ROT_SPEED } = Disassembly;
    this._slices = Array.from({ length: N_SLICES }, () => ({
      angle:        0,
      speed:        ROT_SPEED,
      nextFlipT:    2.75 + Math.random() * 1.5,
      jitterOffset: 0,
      jitterEndT:   0,
      nextJitterT:  7 + Math.random() * 2,
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
    if (st < this._prevSt - 0.5) this._initSliceState();
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

    this._updateSlices(st);

    const proj = mat4pers(40 * Math.PI / 180, this.aspect, 0.1, 20);
    const view = mat4look(0, 0.3, 3.5,  0, 0, 0,  0, 1, 0);
    const mvp  = mat4mul(proj, view);

    const lx = 0.6, ly = 0.8, lz = 0.4;
    const ll = Math.sqrt(lx*lx + ly*ly + lz*lz);

    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this._prog);
    gl.uniformMatrix4fv(this._uMVP, false, mvp);
    gl.uniform3f(this._uLight, lx/ll, ly/ll, lz/ll);

    const spread = Disassembly.ELONGATE_AMP * this._updateElong(st);

    for (let s = 0; s < N_SLICES; s++) {
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
  }
}
