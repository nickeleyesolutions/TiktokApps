// WebGL2 post-processing for layers 1+2 (the HUD stays crisp on its own canvas).
// One pass: mip-chain bloom, chromatic aberration, scanlines, vignette,
// optional CRT curvature and pixelation, hit glitch and color grading.
//
// Stream-encoding note: fine high-frequency detail (1px scanlines, grain,
// dither) is what a low-bitrate encoder throws away first and turns to mush.
// So scanline pitch is set in OUTPUT pixels and defaults to 4.

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime, uBloom, uScan, uPitch, uAberr, uVig, uCurve, uPixel, uGlitch, uFlash, uTintAmt, uSat, uWarp, uPrism;
uniform vec3 uTint;
in vec2 vUv;
out vec4 outColor;

float hash(float n) { return fract(sin(n) * 43758.5453); }

vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 off = abs(uv.yx) / vec2(5.0, 4.0);
  uv = uv + uv * off * off * uCurve;
  return uv * 0.5 + 0.5;
}

void main() {
  vec2 uv = vUv;
  if (uCurve > 0.0) uv = curve(uv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (uWarp > 0.0) {
    // dimension shift: a radial fold rippling out from the rift
    vec2 d = uv - vec2(0.5, 0.53);
    float r = length(d);
    uv += d / max(r, 1e-4) * sin(r * 42.0 - uTime * 16.0) * 0.014 * uWarp * smoothstep(0.95, 0.0, r);
  }
  if (uPixel > 1.0) uv = (floor(uv * uRes / uPixel) + 0.5) * uPixel / uRes;
  if (uGlitch > 0.0) {
    float band = floor(uv.y * 48.0);
    float n = hash(band + floor(uTime * 24.0));
    if (n < uGlitch * 0.35) uv.x += (hash(band * 1.7 + uTime) - 0.5) * 0.05 * uGlitch;
  }
  vec2 dir = uv - 0.5;
  float ab = uAberr * (0.0015 + dot(dir, dir) * 0.012);
  vec3 col;
  col.r = texture(uTex, uv + vec2(ab, 0.0)).r;
  col.g = texture(uTex, uv).g;
  col.b = texture(uTex, uv - vec2(ab, 0.0)).b;

  vec3 bl = textureLod(uTex, uv, 2.5).rgb * 0.30
          + textureLod(uTex, uv, 4.0).rgb * 0.40
          + textureLod(uTex, uv, 5.5).rgb * 0.45;
  bl = max(bl - vec3(0.12), vec3(0.0));
  col += bl * uBloom * 1.6;

  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  // higher dimensions: bright areas pick up a thin-film style prismatic sheen
  if (uPrism > 0.0) col += (0.5 + 0.5 * cos(6.28318 * (l * 1.6 + uTime * 0.07 + vec3(0.0, 0.33, 0.67)))) * smoothstep(0.55, 1.2, l) * uPrism * 0.12;
  col = mix(col, col * uTint * 1.5, uTintAmt);

  float s = 0.5 + 0.5 * cos(gl_FragCoord.y * 6.28318 / uPitch);
  col *= 1.0 - uScan * s;

  float v = smoothstep(0.95, 0.25, length(dir * vec2(1.0, 0.85)) * 1.25);
  col *= mix(1.0, v, uVig);
  col = mix(col, vec3(1.0), uFlash);
  outColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) return;
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.prog = p;
    } catch (e) {
      console.warn('[post] shader failed, falling back to plain canvas:', e.message);
      return;
    }
    gl.useProgram(this.prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.u = {};
    for (const n of ['uTex', 'uRes', 'uTime', 'uBloom', 'uScan', 'uPitch', 'uAberr', 'uVig', 'uCurve', 'uPixel', 'uGlitch', 'uFlash', 'uTintAmt', 'uTint', 'uSat', 'uWarp', 'uPrism']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }
    this.ok = true;
  }

  render(source, p) {
    const gl = this.gl;
    const c = this.canvas;
    if (c.width !== source.width || c.height !== source.height) {
      c.width = source.width;
      c.height = source.height;
    }
    gl.viewport(0, 0, c.width, c.height);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (e) {
      // A tainted canvas (cross-origin image drawn without CORS) lands here.
      console.warn('[post] texture upload failed:', e.message);
      this.ok = false;
      return false;
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    const u = this.u;
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uRes, c.width, c.height);
    gl.uniform1f(u.uTime, p.time);
    gl.uniform1f(u.uBloom, p.bloom);
    gl.uniform1f(u.uScan, p.scanlines);
    gl.uniform1f(u.uPitch, Math.max(2, p.scanlinePitch));
    gl.uniform1f(u.uAberr, p.aberration);
    gl.uniform1f(u.uVig, p.vignette);
    gl.uniform1f(u.uCurve, p.curvature);
    gl.uniform1f(u.uPixel, p.pixelate);
    gl.uniform1f(u.uGlitch, p.glitch);
    gl.uniform1f(u.uFlash, p.flash);
    gl.uniform1f(u.uTintAmt, p.tintAmt);
    gl.uniform3f(u.uTint, p.tint[0], p.tint[1], p.tint[2]);
    gl.uniform1f(u.uSat, p.saturation);
    gl.uniform1f(u.uWarp, p.warp || 0);
    gl.uniform1f(u.uPrism, p.prism || 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}
