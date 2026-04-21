class TextRenderer {
  static CELL_W = 8;
  static CELL_H = 16;
  static COLS   = 16;
  static W      = 128;
  static H      = 96;
  static FIRST  = 32;
  static LAST   = 126;

  constructor(gl) {
    this.gl    = gl;
    this.ready = false;
    this._initProgram();
    this._initBuffer();
    this._initTexture();
  }

  _initProgram() {
    const gl = this.gl;
    this._prog = createProgram(`
      precision mediump float;
      attribute vec2 a_pos;
      attribute vec2 a_uv;
      uniform vec2 u_res;
      varying vec2 v_uv;
      void main() {
        v_uv = a_uv;
        vec2 clip = vec2(a_pos.x / u_res.x * 2.0 - 1.0,
                         1.0 - a_pos.y / u_res.y * 2.0);
        gl_Position = vec4(clip, 0.0, 1.0);
      }
    `, `
      precision mediump float;
      uniform sampler2D u_atlas;
      uniform float u_brightness;
      varying vec2 v_uv;
      void main() {
        float a = texture2D(u_atlas, v_uv).a;
        gl_FragColor = vec4(vec3(u_brightness * a), a * 0.5);
      }
    `);
    this._uRes        = gl.getUniformLocation(this._prog, 'u_res');
    this._uAtlas      = gl.getUniformLocation(this._prog, 'u_atlas');
    this._uBrightness = gl.getUniformLocation(this._prog, 'u_brightness');
    this._aPos        = gl.getAttribLocation(this._prog, 'a_pos');
    this._aUV         = gl.getAttribLocation(this._prog, 'a_uv');
  }

  _initBuffer() {
    this._buf   = this.gl.createBuffer();
    this._verts = new Float32Array(256 * 6 * 4);
  }

  _initTexture() {
    const gl = this.gl;
    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  loadAtlas(src, onload, onerror) {
    const gl  = this.gl;
    const tex = this._tex;
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.ready = true;
      if (onload) onload();
    };
    if (onerror) img.onerror = onerror;
    img.src = src;
  }

  begin(fw, fh) {
    const gl = this.gl;
    gl.useProgram(this._prog);
    gl.uniform2f(this._uRes, fw, fh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.uniform1i(this._uAtlas, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buf);
    gl.enableVertexAttribArray(this._aPos);
    gl.enableVertexAttribArray(this._aUV);
    gl.vertexAttribPointer(this._aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(this._aUV,  2, gl.FLOAT, false, 16, 8);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  setBrightness(b) {
    this.gl.uniform1f(this._uBrightness, b);
  }

  draw(str, xPx, yPx, scale = 1.0) {
    const gl = this.gl;
    const { CELL_W, CELL_H, COLS, W, H, FIRST, LAST } = TextRenderer;
    const gW = CELL_W * scale, gH = CELL_H * scale;
    const lines = str.split('\n');
    let n = 0;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      for (let ci = 0; ci < line.length; ci++) {
        const idx = line.charCodeAt(ci) - FIRST;
        if (idx < 0 || idx > LAST - FIRST) continue;
        const col = idx % COLS;
        const row = Math.floor(idx / COLS);
        const u0 = (col       * CELL_W) / W;
        const u1 = ((col + 1) * CELL_W) / W;
        const v0 = (row       * CELL_H) / H;
        const v1 = ((row + 1) * CELL_H) / H;
        const x0 = xPx + ci * gW,  x1 = x0 + gW;
        const y0 = yPx + li * gH,  y1 = y0 + gH;
        const b = n * 24;
        this._verts[b+ 0]=x0; this._verts[b+ 1]=y0; this._verts[b+ 2]=u0; this._verts[b+ 3]=v0;
        this._verts[b+ 4]=x0; this._verts[b+ 5]=y1; this._verts[b+ 6]=u0; this._verts[b+ 7]=v1;
        this._verts[b+ 8]=x1; this._verts[b+ 9]=y1; this._verts[b+10]=u1; this._verts[b+11]=v1;
        this._verts[b+12]=x0; this._verts[b+13]=y0; this._verts[b+14]=u0; this._verts[b+15]=v0;
        this._verts[b+16]=x1; this._verts[b+17]=y1; this._verts[b+18]=u1; this._verts[b+19]=v1;
        this._verts[b+20]=x1; this._verts[b+21]=y0; this._verts[b+22]=u1; this._verts[b+23]=v0;
        n++;
      }
    }
    if (n === 0) return;
    gl.bufferData(gl.ARRAY_BUFFER, this._verts.subarray(0, n * 24), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, n * 6);
  }

  end() {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(this._aPos);
    gl.disableVertexAttribArray(this._aUV);
  }
}
