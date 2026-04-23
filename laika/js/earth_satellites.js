class EarthSatellites {
  static N_SATS  = 20000;
  static RING_A  = 3.5; // shared circular orbit radius for equatorial and polar bands

  constructor(gl, aspect, t0) {
    this.gl     = gl;
    this.aspect = aspect;
    this.t0     = t0;
    this._stripLengths = [];
    this._initEarthProgram();
    this._initSatProgram();
    this._grid = new CrtGrid(gl);
    this._earthVbo = gl.createBuffer();
    this._satVbo   = gl.createBuffer();
    this._generateOrbits();
  }

  _initEarthProgram() {
    const gl = this.gl;
    this._earthProg = createProgram(`
      attribute vec3 a_pos;
      uniform mat4 u_mvp;
      void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }
    `, `
      precision mediump float;
      void main() { gl_FragColor = vec4(0.7, 0.7, 0.7, 1.0); }
    `);
    this._earthUMVP = gl.getUniformLocation(this._earthProg, 'u_mvp');
    this._earthAPos = gl.getAttribLocation(this._earthProg, 'a_pos');
  }

  _initSatProgram() {
    const gl = this.gl;
    this._satProg = createProgram(`
      attribute vec3 a_pos;
      uniform mat4 u_vp;
      void main() {
        gl_Position  = u_vp * vec4(a_pos, 1.0);
        gl_PointSize = 1.0;
      }
    `, `
      precision mediump float;
      uniform float u_brightness;
      void main() { gl_FragColor = vec4(u_brightness, u_brightness, u_brightness, 1.0); }
    `);
    this._satUVP        = gl.getUniformLocation(this._satProg, 'u_vp');
    this._satUBrightness = gl.getUniformLocation(this._satProg, 'u_brightness');
    this._satAPos       = gl.getAttribLocation(this._satProg, 'a_pos');
  }

  _generateOrbits() {
    const N   = EarthSatellites.N_SATS;
    const TAU = 2 * Math.PI;
    this._orbits = [];

    for (let i = 0; i < N; i++) {
      const incR = Math.random();
      const isRing = incR < 0.8;

      // Equatorial/polar bands: perfectly circular at shared apogee
      // General population: eccentricity bias toward circular with long tail to 8
      let e, a;
      if (isRing) {
        e = 0;
        a = EarthSatellites.RING_A;
      } else {
        e = Math.random() < 0.75
          ? Math.random() * 0.15
          : Math.min(8, -Math.log(1 - Math.random() * 0.9999) * 1.5);
        a = e < 1
          ? 1.5 + Math.random() * 6.5
          : 1.2 + Math.random() * 3.0;
      }

      const inc = incR < 0.4
        ? Math.abs((Math.random() - 0.5) * 0.15)           // equatorial cluster ±4°
        : incR < 0.8
          ? Math.PI / 2 + (Math.random() - 0.5) * 0.2     // polar cluster ±6°
          : Math.acos(1 - 2 * Math.random());              // isotropic
      const Ω   = Math.random() * TAU;
      const ω   = Math.random() * TAU;
      const M0  = Math.random() * TAU;

      const cosΩ = Math.cos(Ω), sinΩ = Math.sin(Ω);
      const cosI = Math.cos(inc), sinI = Math.sin(inc);
      const cosω = Math.cos(ω), sinω = Math.sin(ω);

      // Pre-compute orbital-plane basis vectors in world space
      // P: toward periapsis; Q: 90° prograde from periapsis
      const Px =  cosΩ*cosω - sinΩ*sinω*cosI;
      const Py =  sinΩ*cosω + cosΩ*sinω*cosI;
      const Pz =  sinI*sinω;
      const Qx = -cosΩ*sinω - sinΩ*cosω*cosI;
      const Qy = -sinΩ*sinω + cosΩ*cosω*cosI;
      const Qz =  sinI*cosω;

      this._orbits.push({ e, a, M0, Px, Py, Pz, Qx, Qy, Qz });
    }

    this._satVboData = new Float32Array(N * 3);
  }

  static _solveKepler(M, e) {
    let E = M;
    for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    return E;
  }

  _computePositions(ts_s) {
    const N = EarthSatellites.N_SATS;
    const t = ts_s * 0.3;

    for (let i = 0; i < N; i++) {
      const { e, a, M0, Px, Py, Pz, Qx, Qy, Qz } = this._orbits[i];
      let xOrb, yOrb;

      if (e < 1) {
        const n = Math.sqrt(1 / (a * a * a));
        const M = ((M0 + n * t) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const E = EarthSatellites._solveKepler(M, e);
        xOrb = a * (Math.cos(E) - e);
        yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);
      } else {
        // Animate true anomaly through periapsis; stay inside asymptotes
        const nuMax = Math.acos(-1 / e) * 0.9;
        const T_hyp = 20 + (i % 50);
        const nu    = nuMax * Math.sin(M0 + t * 2 * Math.PI / T_hyp);
        const p     = a * (1 + e); // semi-latus rectum (a = periapsis distance)
        const r     = p / (1 + e * Math.cos(nu));
        xOrb = r * Math.cos(nu);
        yOrb = r * Math.sin(nu);
      }

      // Remap ECI (Z-up) → scene (Y-up): world X=ECI X, world Y=ECI Z, world Z=ECI Y
      this._satVboData[i * 3]     = Px * xOrb + Qx * yOrb;
      this._satVboData[i * 3 + 1] = Pz * xOrb + Qz * yOrb;
      this._satVboData[i * 3 + 2] = Py * xOrb + Qy * yOrb;
    }
  }

  async init() {
    const gl = this.gl;
    const [abuf, lengths] = await Promise.all([
      fetch('assets/earth_verts.bin').then(r => r.arrayBuffer()),
      fetch('assets/earth_strip_lengths.json').then(r => r.json()),
    ]);
    this._stripLengths = lengths;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._earthVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(abuf), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._satVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this._satVboData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  draw(ts_s) {
    const gl   = this.gl;
    this._grid.draw();
    const TILT = 23.44 * Math.PI / 180;
    const R_spin = mat4axisAngle(0, 1, 0, ts_s * (2 * Math.PI / 120));
    const R_tilt = mat4axisAngle(0, 0, 1, -TILT);
    const model  = mat4mul(R_tilt, R_spin);
    model[0]=-model[0]; model[1]=-model[1]; model[2]=-model[2]; model[3]=-model[3];
    const st    = Math.max(0, ts_s - this.t0);
    const tZ    = Math.min(st / 8.0, 1.0);
    const ease  = tZ * tZ * (3 - 2 * tZ);
    const tB    = Math.max(0, Math.min((st - 4.0) / 4.0, 1.0));
    const brightness = 0.5 + 0.5 * tB * tB * (3 - 2 * tB);
    const camAngle = ts_s * 0.12;
    const camDist  = 520 + (5.2 - 520) * ease, camElev = 0.35;
    const ex = Math.cos(camAngle) * Math.cos(camElev) * camDist;
    const ey = Math.sin(camElev) * camDist;
    const ez = Math.sin(camAngle) * Math.cos(camElev) * camDist;
    const proj = mat4pers(42 * Math.PI / 180, this.aspect, 1.0, 1000);
    const view = mat4look(ex, ey, ez, 0, 0, 0, 0, 1, 0);
    const vp   = mat4mul(proj, view);
    const mvp  = mat4mul(proj, mat4mul(view, model));

    gl.useProgram(this._earthProg);
    gl.uniformMatrix4fv(this._earthUMVP, false, mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._earthVbo);
    gl.enableVertexAttribArray(this._earthAPos);
    let byteOff = 0;
    for (const count of this._stripLengths) {
      gl.vertexAttribPointer(this._earthAPos, 3, gl.FLOAT, false, 0, byteOff);
      gl.drawArrays(gl.LINE_STRIP, 0, count);
      byteOff += count * 12;
    }
    gl.disableVertexAttribArray(this._earthAPos);

    this._computePositions(ts_s);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._satVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._satVboData);
    gl.useProgram(this._satProg);
    gl.uniformMatrix4fv(this._satUVP, false, vp);
    gl.uniform1f(this._satUBrightness, brightness);
    gl.enableVertexAttribArray(this._satAPos);
    gl.vertexAttribPointer(this._satAPos, 3, gl.FLOAT, false, 0, 0);
    const tS = Math.min(st / 15.0, 1.0);
    const satCount = Math.round(100 + (EarthSatellites.N_SATS - 100) * tS * tS * tS * tS);
    gl.drawArrays(gl.POINTS, 0, satCount);
    gl.disableVertexAttribArray(this._satAPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
}
