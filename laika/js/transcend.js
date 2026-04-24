class Transcend {
  static PIVOT     = [-0.940, 0.082, 0.165];
  static ROT_SPEED = 0.12;  // rad/s
  static N_STARS   = 800;
  static FOV       = 45 * Math.PI / 180;

  constructor(gl, FW, FH, t0) {
    this.gl     = gl;
    this.aspect = FW / FH;
    this._FH    = FH;
    this.t0     = t0;
    this._nPoints = 0;
    this._ready   = false;
    this._initPointProgram();
    this._initStarProgram();
    this._grid = new CrtGrid(gl);
    this._load();
  }

  _initPointProgram() {
    const gl = this.gl;
    this._ptProg = createProgram(`
      attribute vec3 a_pos;
      attribute vec3 a_col;
      attribute float a_scale;
      attribute float a_opacity;
      uniform mat4 u_mvp;
      uniform float u_focal;
      varying float v_lum;
      varying float v_opacity;
      void main() {
        v_lum     = dot(a_col, vec3(0.299, 0.587, 0.114));
        v_opacity = a_opacity;
        gl_Position  = u_mvp * vec4(a_pos, 1.0);
        gl_PointSize = max(1.0, u_focal * a_scale / gl_Position.w);
      }
    `, `
      precision mediump float;
      uniform float u_alpha;
      varying float v_lum;
      varying float v_opacity;
      void main() { gl_FragColor = vec4(v_lum, v_lum, v_lum, v_opacity * u_alpha); }
    `);
    this._ptUMVP   = gl.getUniformLocation(this._ptProg, 'u_mvp');
    this._ptUFocal = gl.getUniformLocation(this._ptProg, 'u_focal');
    this._ptUAlpha = gl.getUniformLocation(this._ptProg, 'u_alpha');
    this._ptAPos    = gl.getAttribLocation(this._ptProg, 'a_pos');
    this._ptACol    = gl.getAttribLocation(this._ptProg, 'a_col');
    this._ptAScale  = gl.getAttribLocation(this._ptProg, 'a_scale');
    this._ptAOpacity = gl.getAttribLocation(this._ptProg, 'a_opacity');
    this._vbo = gl.createBuffer();
  }

  _initStarProgram() {
    const gl = this.gl;
    const { N_STARS } = Transcend;
    this._starProg = createProgram(`
      attribute vec4 a_star;
      uniform mat4 u_mvp;
      varying float v_b;
      void main() {
        v_b = a_star.w;
        gl_PointSize = 1.0;
        gl_Position  = u_mvp * vec4(a_star.xyz, 1.0);
      }
    `, `
      precision mediump float;
      varying float v_b;
      void main() { gl_FragColor = vec4(v_b, v_b, v_b, 1.0); }
    `);
    this._starUMVP  = gl.getUniformLocation(this._starProg, 'u_mvp');
    this._starAStar = gl.getAttribLocation(this._starProg, 'a_star');

    const data = new Float32Array(N_STARS * 4);
    for (let i = 0; i < N_STARS; i++) {
      const u  = Math.random() * 2 - 1;
      const t  = Math.random() * 2 * Math.PI;
      const r  = Math.sqrt(1 - u * u);
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

  async _load() {
    const buf   = await fetch('assets/stripped.ply').then(r => r.arrayBuffer());
    const bytes = new Uint8Array(buf);

    const MARKER = 'end_header\n';
    let dataStart = -1;
    outer: for (let i = 0; i <= bytes.length - MARKER.length; i++) {
      for (let j = 0; j < MARKER.length; j++)
        if (bytes[i+j] !== MARKER.charCodeAt(j)) continue outer;
      dataStart = i + MARKER.length; break;
    }
    if (dataStart < 0) return;

    let vertexCount = 0;
    for (const line of new TextDecoder().decode(bytes.slice(0, dataStart)).split('\n')) {
      const p = line.trim().split(/\s+/);
      if (p[0] === 'element' && p[1] === 'vertex') { vertexCount = parseInt(p[2]); break; }
    }

    const gl   = this.gl;
    const data = new Float32Array(buf.slice(dataStart, dataStart + vertexCount * 32));
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this._nPoints = vertexCount;
    this._ready   = true;
  }

  draw(ts_s) {
    const gl  = this.gl;
    const st  = Math.max(0, ts_s - this.t0);
    const { PIVOT, ROT_SPEED, FOV, N_STARS } = Transcend;

    this._grid.draw();

    // Camera: start 20× zoomed in, slowly pull back over 40s
    const zoom = 1/50 + (1 - 1/50) * Math.min(st / 1000, 1.0);
    const camX = PIVOT[0];
    const camY = PIVOT[1] + 0.5 * zoom;
    const camZ = PIVOT[2] + 3.5 * zoom;
    const proj     = mat4pers(FOV, this.aspect, 0.01, 200);
    const view     = mat4look(camX, camY, camZ, PIVOT[0], PIVOT[1], PIVOT[2], 0, 1, 0);
    const starView = mat4look(0, 0, 0, -camX + PIVOT[0], -(camY - PIVOT[1]), -(camZ - PIVOT[2]), 0, 1, 0);

    // Stars — rotation-only view
    gl.useProgram(this._starProg);
    gl.uniformMatrix4fv(this._starUMVP, false, mat4mul(proj, starView));
    gl.bindBuffer(gl.ARRAY_BUFFER, this._starVbo);
    gl.enableVertexAttribArray(this._starAStar);
    gl.vertexAttribPointer(this._starAStar, 4, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, N_STARS);
    gl.disableVertexAttribArray(this._starAStar);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    if (!this._ready) return;

    // Object rotation around Y through PIVOT
    const angle = st * ROT_SPEED;
    const model = mat4mul(
      mat4trans( PIVOT[0],  PIVOT[1],  PIVOT[2]),
      mat4mul(mat4axisAngle(0, 1, 0, angle),
      mat4trans(-PIVOT[0], -PIVOT[1], -PIVOT[2]))
    );
    const mvp   = mat4mul(proj, mat4mul(view, model));
    const focal = (this._FH / 2) / Math.tan(FOV / 2);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    gl.useProgram(this._ptProg);
    gl.uniformMatrix4fv(this._ptUMVP,   false, mvp);
    gl.uniform1f(this._ptUFocal, focal);
    gl.uniform1f(this._ptUAlpha, 0.15);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.enableVertexAttribArray(this._ptAPos);
    gl.enableVertexAttribArray(this._ptACol);
    gl.enableVertexAttribArray(this._ptAScale);
    gl.enableVertexAttribArray(this._ptAOpacity);
    gl.vertexAttribPointer(this._ptAPos,     3, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(this._ptACol,     3, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(this._ptAScale,   1, gl.FLOAT, false, 32, 24);
    gl.vertexAttribPointer(this._ptAOpacity, 1, gl.FLOAT, false, 32, 28);
    gl.drawArrays(gl.POINTS, 0, this._nPoints);
    gl.disableVertexAttribArray(this._ptAPos);
    gl.disableVertexAttribArray(this._ptACol);
    gl.disableVertexAttribArray(this._ptAScale);
    gl.disableVertexAttribArray(this._ptAOpacity);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
