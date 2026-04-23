class Earth {
  constructor(gl, aspect) {
    this.gl     = gl;
    this.aspect = aspect;
    this._stripLengths = [];
    this._initProgram();
    this._grid = new CrtGrid(gl);
    this._vbo = gl.createBuffer();
  }

  _initProgram() {
    const gl = this.gl;
    this._prog = createProgram(`
      attribute vec3 a_pos;
      uniform mat4 u_mvp;
      void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }
    `, `
      precision mediump float;
      void main() { gl_FragColor = vec4(0.7, 0.7, 0.7, 1.0); }
    `);
    this._uMVP = gl.getUniformLocation(this._prog, 'u_mvp');
    this._aPos = gl.getAttribLocation(this._prog, 'a_pos');
  }

  async init() {
    const gl = this.gl;
    const [abuf, lengths] = await Promise.all([
      fetch('assets/earth_verts.bin').then(r => r.arrayBuffer()),
      fetch('assets/earth_strip_lengths.json').then(r => r.json()),
    ]);
    this._stripLengths = lengths;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(abuf), gl.STATIC_DRAW);
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
    const camAngle = ts_s * 0.12;
    const camDist  = 5.2, camElev = 0.35;
    const ex = Math.cos(camAngle) * Math.cos(camElev) * camDist;
    const ey = Math.sin(camElev) * camDist;
    const ez = Math.sin(camAngle) * Math.cos(camElev) * camDist;
    const proj = mat4pers(42 * Math.PI / 180, this.aspect, 0.1, 100);
    const view = mat4look(ex, ey, ez, 0, 0, 0, 0, 1, 0);
    const mvp  = mat4mul(proj, mat4mul(view, model));
    gl.useProgram(this._prog);
    gl.uniformMatrix4fv(this._uMVP, false, mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.enableVertexAttribArray(this._aPos);
    let byteOff = 0;
    for (const count of this._stripLengths) {
      gl.vertexAttribPointer(this._aPos, 3, gl.FLOAT, false, 0, byteOff);
      gl.drawArrays(gl.LINE_STRIP, 0, count);
      byteOff += count * 12;
    }
    gl.disableVertexAttribArray(this._aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
}
