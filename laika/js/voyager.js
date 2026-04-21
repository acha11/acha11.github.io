class Voyager {
  static ROT_SPEED = 2.0; // rad/s
  static SEG_DUR   = 0.5; // seconds per rotation segment

  constructor(gl, aspect) {
    this.gl      = gl;
    this.aspect  = aspect;
    this._meshes = [];
    this._accumMat     = (() => { const m=new Float32Array(16); m[0]=m[5]=m[10]=m[15]=1; return m; })();
    this._segStartT    = 0;
    this._segAxis      = [0, 1, 0];
    this._segDur       = Voyager.SEG_DUR;
    this._segHold      = false;
    this._consecRot    = 0;
    this._initProgram();
  }

  _initProgram() {
    const gl = this.gl;
    this._prog = createProgram(`
      attribute vec3 a_pos;
      attribute vec3 a_normal;
      uniform mat4 u_mvp;
      uniform mat4 u_mv;
      varying vec3 v_norm;
      void main() {
        gl_Position = u_mvp * vec4(a_pos, 1.0);
        v_norm = mat3(u_mv[0].xyz, u_mv[1].xyz, u_mv[2].xyz) * a_normal;
      }
    `, `
      precision mediump float;
      varying vec3 v_norm;
      void main() {
        vec3 n = normalize(v_norm);
        vec3 light = normalize(vec3(1.0, 2.0, 1.5));
        float diff = max(dot(n, light), 0.0) * 0.75;
        gl_FragColor = vec4(vec3(0.2 + diff), 1.0);
      }
    `);
    this._uMVP  = gl.getUniformLocation(this._prog, 'u_mvp');
    this._uMV   = gl.getUniformLocation(this._prog, 'u_mv');
    this._aPos  = gl.getAttribLocation(this._prog, 'a_pos');
    this._aNorm = gl.getAttribLocation(this._prog, 'a_normal');
  }

  async init() {
    const gl     = this.gl;
    const abuf   = await fetch('assets/voyager.glb').then(r => r.arrayBuffer());
    const jsonLen = new DataView(abuf).getUint32(12, true);
    const gltf   = JSON.parse(new TextDecoder().decode(new Uint8Array(abuf, 20, jsonLen)));
    const binOff = 20 + jsonLen + 8;
    for (let ni = 0; ni < gltf.nodes.length; ni++) {
      const node = gltf.nodes[ni];
      if (node.mesh === undefined) continue;
      const nodeOffset = node.translation || [0, 0, 0];
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const acc = (i) => {
          const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView];
          return { off: binOff + (bv.byteOffset||0) + (a.byteOffset||0), n: a.count };
        };
        const pos = acc(prim.attributes.POSITION), nrm = acc(prim.attributes.NORMAL), idx = acc(prim.indices);
        const posVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(abuf, pos.off, pos.n * 3), gl.STATIC_DRAW);
        const normVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, normVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(abuf, nrm.off, nrm.n * 3), gl.STATIC_DRAW);
        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(abuf, idx.off, idx.n), gl.STATIC_DRAW);
        this._meshes.push({ posVBO, normVBO, ibo, count: idx.n, nodeOffset });
      }
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  _nextSegment() {
    if (this._consecRot >= 3 || Math.random() < 1/3) {
      this._segHold    = true;
      this._segDur     = 0.5 + Math.random() * 1.0;
      this._consecRot  = 0;
    } else {
      this._segHold    = false;
      this._segDur     = Voyager.SEG_DUR;
      this._segAxis    = [[1,0,0],[0,1,0],[0,0,1]][Math.floor(Math.random()*3)];
      this._consecRot++;
    }
  }

  _getRotation(ts_s) {
    if (ts_s < this._segStartT) {
      this._segStartT = ts_s;
      this._segHold   = false;
      this._segDur    = Voyager.SEG_DUR;
      this._segAxis   = [0, 1, 0];
      this._consecRot = 0;
    }
    while (ts_s >= this._segStartT + this._segDur) {
      if (!this._segHold)
        this._accumMat = mat4mul(mat4axisAngle(...this._segAxis, Voyager.ROT_SPEED * this._segDur), this._accumMat);
      this._segStartT += this._segDur;
      this._nextSegment();
    }
    if (this._segHold) return this._accumMat;
    return mat4mul(mat4axisAngle(...this._segAxis, Voyager.ROT_SPEED * (ts_s - this._segStartT)), this._accumMat);
  }

  draw(ts_s) {
    const gl = this.gl;
    const cx=0, cy=2.2, cz=4.25, dist=19, elev=0.35;
    const angle = ts_s * 0.25;
    const ex = cx + Math.cos(angle) * Math.cos(elev) * dist;
    const ey = cy + Math.sin(elev) * dist;
    const ez = cz + Math.sin(angle) * Math.cos(elev) * dist;
    const proj = mat4pers(45 * Math.PI / 180, this.aspect, 0.1, 500);
    const view = mat4look(ex, ey, ez, cx, cy, cz, 0, 1, 0);
    const rot  = this._getRotation(ts_s);
    const Tcen = mat4trans(cx, cy, cz);
    gl.useProgram(this._prog);
    gl.enable(gl.DEPTH_TEST);
    for (const m of this._meshes) {
      const Toff = mat4trans(m.nodeOffset[0]-cx, m.nodeOffset[1]-cy, m.nodeOffset[2]-cz);
      const mdl  = mat4mul(Tcen, mat4mul(rot, Toff));
      const mv   = mat4mul(view, mdl);
      gl.uniformMatrix4fv(this._uMVP, false, mat4mul(proj, mv));
      gl.uniformMatrix4fv(this._uMV,  false, mv);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.posVBO);
      gl.enableVertexAttribArray(this._aPos);
      gl.vertexAttribPointer(this._aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.normVBO);
      gl.enableVertexAttribArray(this._aNorm);
      gl.vertexAttribPointer(this._aNorm, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disableVertexAttribArray(this._aPos);
    gl.disableVertexAttribArray(this._aNorm);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }
}
