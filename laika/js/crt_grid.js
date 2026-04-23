class CrtGrid {
  constructor(gl) {
    this.gl = gl;
    const prog = createProgram(`
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `, `
      precision mediump float;
      void main() { gl_FragColor = vec4(0.045, 0.045, 0.045, 1.0); }
    `);
    this._prog = prog;
    this._aPos = gl.getAttribLocation(prog, 'a_pos');

    // 8 cols × 6 rows — square cells on a 4:3 canvas
    const verts = [];
    for (let c = 0; c <= 8; c++) { const x = -1 + c * 0.25;    verts.push(x, -1, x,  1); }
    for (let r = 0; r <= 6; r++) { const y = -1 + r * (2 / 6); verts.push(-1, y,  1, y); }
    this._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this._count = verts.length / 2;
  }

  draw() {
    const gl = this.gl;
    gl.useProgram(this._prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.enableVertexAttribArray(this._aPos);
    gl.vertexAttribPointer(this._aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, this._count);
    gl.disableVertexAttribArray(this._aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
}
