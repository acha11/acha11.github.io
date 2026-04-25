class HvNet {
  static N         = 8;
  static CAM_SPEED = 160;
  static SPACING   = 64;
  static CLUTTER_N = 400;

  constructor(gl, aspect, t0) {
    this.gl     = gl;
    this.aspect = aspect;
    this.t0     = t0;
    this._initPrograms();
    this._initGeometry();
    this._grid = new CrtGrid(gl);
  }

  _initPrograms() {
    const gl = this.gl;
    this._prog = createProgram(`
      attribute vec3 a_pos;
      uniform mat4 u_mvp;
      void main() { gl_PointSize = 1.0; gl_Position = u_mvp * vec4(a_pos, 1.0); }
    `, `
      precision mediump float;
      void main() { gl_FragColor = vec4(0.72, 0.72, 0.72, 1.0); }
    `);
    this._uMVP = gl.getUniformLocation(this._prog, 'u_mvp');
    this._aPos = gl.getAttribLocation(this._prog, 'a_pos');

    this._clutterProg = createProgram(`
      attribute vec3 a_pos;
      uniform mat4 u_mvp;
      uniform float u_tile_z;
      uniform vec3 u_cam;
      varying float v_bright;
      void main() {
        vec3 world = a_pos + vec3(0.0, 0.0, u_tile_z);
        float dist = distance(world, u_cam);
        float t = clamp((dist - 128.0) / (600.0 - 128.0), 0.0, 1.0);
        v_bright = pow(1.0 - t, 3.0);
        gl_PointSize = 1.0;
        gl_Position = u_mvp * vec4(a_pos, 1.0);
      }
    `, `
      precision mediump float;
      varying float v_bright;
      void main() { gl_FragColor = vec4(v_bright, v_bright, v_bright, 1.0); }
    `);
    this._cUMVP   = gl.getUniformLocation(this._clutterProg, 'u_mvp');
    this._cUTileZ = gl.getUniformLocation(this._clutterProg, 'u_tile_z');
    this._cUCam   = gl.getUniformLocation(this._clutterProg, 'u_cam');
    this._cAPos   = gl.getAttribLocation(this._clutterProg, 'a_pos');
  }

  _initGeometry() {
    const gl = this.gl;
    const { SPACING, CLUTTER_N } = HvNet;

    // Delta-mast tower line geometry (Y-up, origin at base centre)
    const tv = [];
    const L = (x1,y1,z1, x2,y2,z2) => tv.push(x1,y1,z1, x2,y2,z2);
    const lvl = [
      [0.0, 1.30, 0.90], [2.0, 0.90, 0.62], [4.0, 0.60, 0.42],
      [6.0, 0.38, 0.27], [7.5, 0.26, 0.18],
    ];
    for (let i = 0; i < lvl.length - 1; i++) {
      const [y0,wx0,wz0] = lvl[i], [y1,wx1,wz1] = lvl[i+1];
      const b = [[-wx0,y0,-wz0],[wx0,y0,-wz0],[wx0,y0,wz0],[-wx0,y0,wz0]];
      const t = [[-wx1,y1,-wz1],[wx1,y1,-wz1],[wx1,y1,wz1],[-wx1,y1,wz1]];
      for (let j = 0; j < 4; j++) {
        L(...b[j], ...b[(j+1)%4]);
        L(...b[j], ...t[j]);
        L(...b[j], ...t[(j+1)%4]);
        L(...b[(j+1)%4], ...t[j]);
      }
    }
    const [y4,wx4,wz4] = lvl[4];
    const tr = [[-wx4,y4,-wz4],[wx4,y4,-wz4],[wx4,y4,wz4],[-wx4,y4,wz4]];
    for (let j = 0; j < 4; j++) L(...tr[j], ...tr[(j+1)%4]);
    const yA = 7.5, armX = 3.8, armY = 8.15;
    L(-wx4, yA, 0, -armX, armY, 0);  L(wx4, yA, 0, armX, armY, 0);
    L(-armX, armY, 0, -0.55, 6.1, 0); L(armX, armY, 0, 0.55, 6.1, 0);
    for (const sx of [-armX, armX]) {
      L(sx, armY, -0.20, sx, armY, 0.20);
      L(sx, armY-0.5, -0.12, sx, armY-0.5, 0.12);
    }
    const ySpk = 9.9;
    L(0, yA, 0, 0, ySpk, 0);
    L(-wx4*0.8, yA+0.15, 0, 0, ySpk, 0); L(wx4*0.8, yA+0.15, 0, 0, ySpk, 0);
    const ins = 0.48;
    L(-armX, armY, 0, -armX, armY-ins, 0);
    L(armX, armY, 0, armX, armY-ins, 0);
    L(0, ySpk, 0, 0, ySpk-ins, 0);
    this._towerVerts = new Float32Array(tv);
    this._towerVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._towerVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this._towerVerts, gl.STATIC_DRAW);

    // Catenary cables
    const attach = [[-3.8, 8.15-0.48, 0], [3.8, 8.15-0.48, 0], [0, 9.9-0.48, 0]];
    const sag = 1.5, nsegs = 16;
    const cv = [];
    for (const [ax, ay] of attach) {
      for (let i = 0; i < nsegs; i++) {
        const t0 = i/nsegs, t1 = (i+1)/nsegs;
        cv.push(ax, ay - sag*4*t0*(1-t0), t0*SPACING,
                ax, ay - sag*4*t1*(1-t1), t1*SPACING);
      }
    }
    this._catVerts = new Float32Array(cv);
    this._catVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._catVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this._catVerts, gl.STATIC_DRAW);

    // Ground clutter
    const gv = [];
    for (let i = 0; i < CLUTTER_N; i++)
      gv.push((Math.random()-0.5)*240, 0, Math.random()*SPACING);
    this._clutterVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._clutterVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gv), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  draw(ts_s) {
    const gl = this.gl;
    this._grid.draw();
    const { N, CAM_SPEED, SPACING, CLUTTER_N } = HvNet;
    const st     = Math.max(0, ts_s - this.t0);
    // Speed ramps from 20% → 100% of CAM_SPEED over 5 s; integrate for position
    const travelZ = st <= 5
      ? CAM_SPEED * (0.2 * st + 0.08 * st * st)
      : CAM_SPEED * (st - 2.0);
    const camZ    = travelZ % SPACING;
    const oscFade = Math.min(st / 2.0, 1.0);
    const proj = mat4pers(52 * Math.PI / 180, this.aspect, 0.3, 600);
    const camY = 2.775 + oscFade * (
        1.2375 * Math.sin(2*Math.PI*st/5.0)
      + 0.3125 * Math.sin(2*Math.PI*st/2.3)
      + 0.125  * Math.sin(2*Math.PI*st/1.1));
    const camX = -14 + oscFade * (
        5.0 * Math.sin(2*Math.PI*st/14.0)
      + 1.5 * Math.sin(2*Math.PI*st/6.2)
      + 0.5 * Math.sin(2*Math.PI*st/2.8));
    const view = mat4look(camX, camY, camZ,  camX+12.5, camY-8.24, camZ+35,  0, 1, 0);

    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this._prog);
    gl.enableVertexAttribArray(this._aPos);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._towerVBO);
    gl.vertexAttribPointer(this._aPos, 3, gl.FLOAT, false, 0, 0);
    for (let i = 0; i < N; i++) {
      gl.uniformMatrix4fv(this._uMVP, false, mat4mul(proj, mat4mul(view, mat4trans(0, 0, i*SPACING))));
      gl.drawArrays(gl.LINES, 0, this._towerVerts.length / 3);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this._catVBO);
    gl.vertexAttribPointer(this._aPos, 3, gl.FLOAT, false, 0, 0);
    for (let i = 0; i < N - 1; i++) {
      gl.uniformMatrix4fv(this._uMVP, false, mat4mul(proj, mat4mul(view, mat4trans(0, 0, i*SPACING))));
      gl.drawArrays(gl.LINES, 0, this._catVerts.length / 3);
    }

    gl.disableVertexAttribArray(this._aPos);
    gl.useProgram(this._clutterProg);
    gl.uniform3f(this._cUCam, camX, camY, camZ);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._clutterVBO);
    gl.enableVertexAttribArray(this._cAPos);
    gl.vertexAttribPointer(this._cAPos, 3, gl.FLOAT, false, 0, 0);
    for (let i = 0; i < N; i++) {
      gl.uniform1f(this._cUTileZ, i * SPACING);
      gl.uniformMatrix4fv(this._cUMVP, false, mat4mul(proj, mat4mul(view, mat4trans(0, 0, i*SPACING))));
      gl.drawArrays(gl.POINTS, 0, CLUTTER_N);
    }
    gl.disableVertexAttribArray(this._cAPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.disable(gl.DEPTH_TEST);
  }
}
