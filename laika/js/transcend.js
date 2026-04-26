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
    this._initWhiteProgram();
    this._initStarProgram();
    this._initFadeProgram();
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
    this._vbo       = gl.createBuffer();
    this._vboColour = gl.createBuffer();
  }

  _initWhiteProgram() {
    const gl = this.gl;
    this._whiteProg = createProgram(`
      attribute vec3 a_pos;
      attribute vec3 a_col;
      attribute float a_scale;
      attribute float a_opacity;
      attribute vec3 a_dir;
      attribute float a_delay;
      uniform mat4 u_mvp;
      uniform float u_focal;
      uniform float u_anim_t;
      varying float v_lum;
      varying float v_opacity;
      void main() {
        v_lum      = dot(a_col, vec3(0.299, 0.587, 0.114));
        float t    = max(0.0, u_anim_t - a_delay);
        float fade = 1.0 - clamp((t - 3.0) / 2.0, 0.0, 1.0);
        v_opacity  = a_opacity * fade;
        vec3 pos   = a_pos + a_dir * t * t * 0.08;
        gl_Position  = u_mvp * vec4(pos, 1.0);
        gl_PointSize = max(1.0, u_focal * a_scale / gl_Position.w);
      }
    `, `
      precision mediump float;
      uniform float u_alpha;
      varying float v_lum;
      varying float v_opacity;
      void main() { gl_FragColor = vec4(v_lum, v_lum, v_lum, v_opacity * u_alpha); }
    `);
    this._wUMVP    = gl.getUniformLocation(this._whiteProg, 'u_mvp');
    this._wUFocal  = gl.getUniformLocation(this._whiteProg, 'u_focal');
    this._wUAlpha  = gl.getUniformLocation(this._whiteProg, 'u_alpha');
    this._wUAnimT  = gl.getUniformLocation(this._whiteProg, 'u_anim_t');
    this._wAPos    = gl.getAttribLocation(this._whiteProg, 'a_pos');
    this._wACol    = gl.getAttribLocation(this._whiteProg, 'a_col');
    this._wAScale  = gl.getAttribLocation(this._whiteProg, 'a_scale');
    this._wAOpacity = gl.getAttribLocation(this._whiteProg, 'a_opacity');
    this._wADir    = gl.getAttribLocation(this._whiteProg, 'a_dir');
    this._wADelay  = gl.getAttribLocation(this._whiteProg, 'a_delay');
    this._animVbo  = gl.createBuffer();
  }

  _initFadeProgram() {
    const gl = this.gl;
    this._fadeProg = createProgram(`
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `, `
      precision mediump float;
      uniform float u_alpha;
      void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, u_alpha); }
    `);
    this._fadeUAlpha = gl.getUniformLocation(this._fadeProg, 'u_alpha');
    this._fadeAPos   = gl.getAttribLocation(this._fadeProg, 'a_pos');
    this._fadeVbo    = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fadeVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
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

    // Separate into white (seeds) and coloured (stem/structure) by RGB saturation.
    // White points have max-min ≈ 0; coloured points have spread > threshold.
    const SAT_THRESHOLD = 0.11;
    const white = [], colour = [];
    for (let i = 0; i < vertexCount; i++) {
      const base = i * 8;
      const r = data[base+3], g = data[base+4], b = data[base+5];
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      const dst = (hi - lo) < SAT_THRESHOLD ? white : colour;
      for (let k = 0; k < 8; k++) dst.push(data[base + k]);
    }

    const nWhite = white.length / 8;

    // Build per-point animation data for white points: dir(xyz) + delay
    const PIVOT = Transcend.PIVOT;
    const MAX_DELAY = 8.0;
    let Ymin = Infinity, Ymax = -Infinity;
    for (let i = 0; i < nWhite; i++) {
      const y = white[i*8 + 1];
      if (y < Ymin) Ymin = y;
      if (y > Ymax) Ymax = y;
    }
    const Yrange = Math.max(Ymax - Ymin, 1e-6);
    const animData = new Float32Array(nWhite * 4);
    for (let i = 0; i < nWhite; i++) {
      const x = white[i*8], y = white[i*8+1], z = white[i*8+2];
      let dx = x - PIVOT[0] + (Math.random() - 0.5) * 0.4;
      let dy = y - PIVOT[1] + (Math.random() - 0.5) * 0.4;
      let dz = z - PIVOT[2] + (Math.random() - 0.5) * 0.4;
      const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
      animData[i*4]   = dx / len;
      animData[i*4+1] = dy / len;
      animData[i*4+2] = dz / len;
      animData[i*4+3] = ((Ymax - y) / Yrange) * MAX_DELAY;
    }

    const upload = (vbo, arr) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    };
    upload(this._vbo, white);
    upload(this._vboColour, colour);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._animVbo);
    gl.bufferData(gl.ARRAY_BUFFER, animData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this._nWhite  = nWhite;
    this._nColour = colour.length / 8;
    this._ready   = true;
  }

  draw(ts_s) {
    const gl  = this.gl;
    const st  = Math.max(0, ts_s - this.t0);
    const { PIVOT, ROT_SPEED, FOV, N_STARS } = Transcend;

    this._grid.draw();

    const zoomTime = 400;
    const initialZoom = 1/80; // 1/500
    const zoom = initialZoom + (1 - initialZoom) * Math.min(st / zoomTime, 1.0);
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

    // Cycle render mode every second: 0=full, 1=white only, 2=colour only
    const mode = 0;//Math.floor(st) % 3;

    gl.enable(gl.BLEND);
    // ajc: can change to gl.ONE to get additive to intensify white
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    // White (seed) points — animated shader with two parallel VBOs
    if (mode !== 2) {
      gl.useProgram(this._whiteProg);
      gl.uniformMatrix4fv(this._wUMVP,  false, mvp);
      gl.uniform1f(this._wUFocal, focal);
      // AJC -  tweak for dandelion intensity - originally 0.15, increased to 0.4 to get more white
      gl.uniform1f(this._wUAlpha, 0.5);
      gl.uniform1f(this._wUAnimT, Math.max(0, st - 15));
      gl.enableVertexAttribArray(this._wAPos);
      gl.enableVertexAttribArray(this._wACol);
      gl.enableVertexAttribArray(this._wAScale);
      gl.enableVertexAttribArray(this._wAOpacity);
      gl.enableVertexAttribArray(this._wADir);
      gl.enableVertexAttribArray(this._wADelay);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
      gl.vertexAttribPointer(this._wAPos,     3, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(this._wACol,     3, gl.FLOAT, false, 32, 12);
      gl.vertexAttribPointer(this._wAScale,   1, gl.FLOAT, false, 32, 24);
      gl.vertexAttribPointer(this._wAOpacity, 1, gl.FLOAT, false, 32, 28);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._animVbo);
      gl.vertexAttribPointer(this._wADir,   3, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(this._wADelay, 1, gl.FLOAT, false, 16, 12);
      gl.drawArrays(gl.POINTS, 0, this._nWhite);
      gl.disableVertexAttribArray(this._wAPos);
      gl.disableVertexAttribArray(this._wACol);
      gl.disableVertexAttribArray(this._wAScale);
      gl.disableVertexAttribArray(this._wAOpacity);
      gl.disableVertexAttribArray(this._wADir);
      gl.disableVertexAttribArray(this._wADelay);
    }

    // Coloured (stem/structure) points — static shader
    if (mode !== 1) {
      gl.useProgram(this._ptProg);
      gl.uniformMatrix4fv(this._ptUMVP,   false, mvp);
      gl.uniform1f(this._ptUFocal, focal);

      // ajc: should fade this up during the blow away effect
      gl.uniform1f(this._ptUAlpha, 0.15);
      gl.enableVertexAttribArray(this._ptAPos);
      gl.enableVertexAttribArray(this._ptACol);
      gl.enableVertexAttribArray(this._ptAScale);
      gl.enableVertexAttribArray(this._ptAOpacity);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vboColour);
      gl.vertexAttribPointer(this._ptAPos,     3, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(this._ptACol,     3, gl.FLOAT, false, 32, 12);
      gl.vertexAttribPointer(this._ptAScale,   1, gl.FLOAT, false, 32, 24);
      gl.vertexAttribPointer(this._ptAOpacity, 1, gl.FLOAT, false, 32, 28);
      gl.drawArrays(gl.POINTS, 0, this._nColour);
      gl.disableVertexAttribArray(this._ptAPos);
      gl.disableVertexAttribArray(this._ptACol);
      gl.disableVertexAttribArray(this._ptAScale);
      gl.disableVertexAttribArray(this._ptAOpacity);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // Fade to black after 30s
    const fadeAlpha = Math.min(Math.max((st - 30) / 5, 0), 1);
    if (fadeAlpha > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(this._fadeProg);
      gl.uniform1f(this._fadeUAlpha, fadeAlpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._fadeVbo);
      gl.enableVertexAttribArray(this._fadeAPos);
      gl.vertexAttribPointer(this._fadeAPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(this._fadeAPos);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.BLEND);
    }
  }
}
