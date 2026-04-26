class OnTheBeach {
  static CAM_R     = 5.5;
  static CAM_Y     = 1.2;
  static CAM_SPEED = 0.025;

  constructor(gl, FW, FH, t0) {
    this.gl     = gl;
    this.aspect = FW / FH;
    this.t0     = t0;
    this._fadeIn = 0;
    this._waves = new Waves(gl, FW / FH);
    this._grid  = new CrtGrid(gl);

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

  activate(ts_s, params = {}) {
    this._fadeIn       = params.fade_in ?? 0;
    this._activationTs = ts_s;
  }

  draw(ts_s) {
    const gl  = this.gl;
    const st  = Math.max(0, ts_s - this.t0);
    const { CAM_R, CAM_Y, CAM_SPEED } = OnTheBeach;

    this._grid.draw();

    const angle = st * CAM_SPEED;
    const ex = CAM_R * Math.sin(angle);
    const ez = CAM_R * Math.cos(angle);
    this._waves.draw(st, ex, CAM_Y, ez, -ex * 1.8, 1.0, -ez * 1.8);

    const sinceActivation = Math.max(0, ts_s - (this._activationTs ?? this.t0));
    const fadeAlpha = this._fadeIn > 0 ? Math.max(0, 1 - sinceActivation / this._fadeIn) : 0;
    if (fadeAlpha > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
