class Corona {
  static W = 80;
  static H = 60;

  constructor(gl) {
    this.gl    = gl;
    this._frame = 0;
    this._ejections = [];
    this._cells  = new Float32Array(Corona.W * Corona.H);
    this._pixels = new Uint8Array(Corona.W * Corona.H);
    this._initProgram();
    this._initTexture();
    this._initQuad();
  }

  _initProgram() {
    const gl = this.gl;
    this._prog = createProgram(`
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
    `, `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_fire;
      void main() {
        const float PI     = 3.14159265;
        const float RADIUS = 0.22;
        const float REACH  = 0.25;
        vec2 p = v_uv - 0.5;
        p.x *= (320.0 / 240.0);
        float dist  = length(p);
        float fireU = atan(p.y, p.x) / (2.0 * PI) + 0.5;
        float fireV = clamp((dist - RADIUS) / REACH, 0.0, 1.0) * (58.0 / 60.0) + (2.0 / 60.0);
        float raw   = clamp(texture2D(u_fire, vec2(fireU, fireV)).r * 1.5, 0.0, 1.0);
        float t     = mix(raw, floor(raw * 4.0 + 0.5) / 4.0, 0.1);
        vec4 fireCol = vec4(t, t, t, t);
        vec4 discCol = vec4(0.8, 0.8, 0.8, 1.0);
        float edge = smoothstep(RADIUS - 0.015, RADIUS + 0.015, dist);
        gl_FragColor = mix(discCol, fireCol, edge);
      }
    `);
    this._uFire = gl.getUniformLocation(this._prog, 'u_fire');
    this._aPos  = gl.getAttribLocation(this._prog, 'a_pos');
  }

  _initTexture() {
    const gl = this.gl;
    const { W, H } = Corona;
    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, W, H, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  _initQuad() {
    const gl = this.gl;
    this._quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _stepCA() {
    const gl = this.gl;
    const { W, H } = Corona;
    const cells = this._cells;

    // Advance mass ejections
    for (let i = this._ejections.length - 1; i >= 0; i--) {
      const ej = this._ejections[i];
      ej.alpha  *= 0.98;
      ej.height += ej.vy;
      ej.vy     -= 0.01;
      ej.col     = ((ej.col + ej.vx) % W + W) % W;
      if (ej.alpha < 0.04) { this._ejections.splice(i, 1); continue; }
      const r0 = Math.min(Math.floor(ej.height), H - 1);
      const r1 = Math.min(r0 + 1, H - 1);
      const c0 = Math.floor(ej.col) % W;
      const c1 = (c0 + 1) % W;
      const cf = ej.col    - Math.floor(ej.col);
      const rf = ej.height - Math.floor(ej.height);
      cells[r0*W+c0] = Math.min(1, cells[r0*W+c0] + ej.alpha * (1-rf) * (1-cf));
      cells[r0*W+c1] = Math.min(1, cells[r0*W+c1] + ej.alpha * (1-rf) * cf);
      cells[r1*W+c0] = Math.min(1, cells[r1*W+c0] + ej.alpha * rf     * (1-cf));
      cells[r1*W+c1] = Math.min(1, cells[r1*W+c1] + ej.alpha * rf     * cf);
    }

    // Propagate upward: traverse top-to-bottom so each row reads the row below
    // before it is updated this frame
    for (let r = H - 1; r >= 1; r--) {
      for (let c = 0; c < W; c++) {
        const l    = cells[(r-1)*W + (c-1+W)%W];
        const m    = cells[(r-1)*W + c];
        const ri   = cells[(r-1)*W + (c+1)%W];
        const here = cells[r*W + c];
        const below = (l + 10*m + ri) / 12;
        const raw = (below + here) / 2;
        cells[r*W + c] = raw * (raw > 0.5 ? 0.999 : 0.95);
      }
    }

    // Refresh bottom row with contrast-pushed random ignition
    for (let c = 0; c < W; c++) { const r = Math.random(); cells[c] = r * r; }

    // Spawn ejection ~once every 3 s (CA runs at ~30 Hz)
    if (Math.random() < 1 / 30)
      this._ejections.push({ col: Math.random()*W, vy: Math.random(), vx: Math.random()*0.5-0.25, height: 0, alpha: 1 });

    // Upload to texture
    const px = this._pixels;
    for (let i = 0; i < cells.length; i++) px[i] = cells[i] * 255;
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.LUMINANCE, gl.UNSIGNED_BYTE, px);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  draw() {
    const gl = this.gl;

    // Step CA every other frame
    if (this._frame++ % 2 === 0) this._stepCA();

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this._prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.uniform1i(this._uFire, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);
    gl.enableVertexAttribArray(this._aPos);
    gl.vertexAttribPointer(this._aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(this._aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
  }
}
