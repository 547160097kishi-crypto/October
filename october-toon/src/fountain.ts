/**
 * 前景喷泉（场景「P7/水池」，约 21s 起出现在镜头前景）的动画水流。
 *
 * 模型分析（顶点按高度切片求半径，见提交说明）：中心 (-83.45, -20.67)，底 y=0.55，顶 y=4.49。
 *   底池：水面 ≈ 底+0.50，内半径 ≈ 1.96
 *   中碗：碗沿 ≈ 底+1.64（y≈2.19），半径 ≈ 0.98
 *   上碗：碗沿 ≈ 底+2.67（y≈3.22），半径 ≈ 0.63
 *   顶碟：≈ 底+3.15，半径 ≈ 0.32；尖饰顶 ≈ 底+3.94
 * 模型里原本雕了一串串「静态水滴」（从碗沿落下的点），按 Toon 石材上色后像噪点，
 * 这里按区间剔除这些三角面，换成动画水流。
 *
 * 风格：水面 / 水流都用场景同一套 Toon 材质（createToonMaterial + 水的色板），
 * 自动获得三阶色带、硬阴影、雾、暮色插值；再注入：
 *   - 水流：上半段是连续的变形水柱（下宽上窄、起伏、中段断水、圆头断口），
 *     下半段由烟尘同款团块接手（纯色平涂、越往下越大越散，轮廓蓬松）；
 *   - 水面：从落水点扩散的涟漪色带 + 色带边缘细墨线（线宽同样按画面高度比例）+ 落水点白沫；
 *   - 水花：烟尘同款硬边团块精灵，水色。
 * 全部参与描边：水面走 identity override；水流团块 / 水花（精灵）用 identity 孪生体。
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createToonMaterial, type ToonPalette } from './toonMaterial'
import { ID_FAR, OCT_ENCODE } from './outlinePass'
import { SPRITE_VERT, SPRITE_MASK, spriteIdMaterial } from './dust'

const G = 9.8

/** 相对喷泉底部的高度 / 半径 */
const LEVEL = {
  basin: { y: 0.5, r: 1.96 },
  middle: { y: 1.62, r: 0.95 },
  upper: { y: 2.685, r: 0.6 },
  top: { y: 3.13, r: 0.3 }
}

interface JetSpec {
  name: string
  count: number
  /** 起点 (r, y) / 落点 (r, y)，相对喷泉中心与底部 */
  from: [number, number]
  to: [number, number]
  /** 起始竖直速度（>0 先上抛） */
  vy0: number
  /** 上半段水柱的基准半径：出水口 ≈ 0.55×，往下变宽 */
  radius: number
  /** 上半段水柱的「断水格」周期数 */
  beads: number
  /** 水柱在沿程多少处（0..1 弧长）收尖，交给下半段团块 */
  uEnd: number
  /** 下半段团块落点直径 */
  sizeBottom: number
  /** 每股每秒发射的团块数（越大下半段越连贯） */
  rate: number
  angle0: number
  /** 落在哪个水面（涟漪中心半径 = to[0]） */
  pool: keyof typeof LEVEL
}

const JETS: JetSpec[] = [
  // 顶部尖饰向上喷，冠状散开落进顶碟
  { name: 'crown', count: 6, from: [0.02, 3.92], to: [0.29, 3.14], vy0: 1.5, radius: 0.02, beads: 6, uEnd: 0.62, sizeBottom: 0.07, rate: 95, angle0: 0.3, pool: 'top' },
  // 上碗溢出 → 中碗
  { name: 'upper', count: 8, from: [0.63, 2.66], to: [0.86, 1.6], vy0: 0.3, radius: 0.032, beads: 5, uEnd: 0.6, sizeBottom: 0.13, rate: 105, angle0: 0.0, pool: 'middle' },
  // 中碗溢出 → 底池
  { name: 'middle', count: 10, from: [0.99, 1.63], to: [1.5, 0.5], vy0: 0.35, radius: 0.04, beads: 5, uEnd: 0.6, sizeBottom: 0.165, rate: 115, angle0: 0.2, pool: 'basin' }
]

/** 模型里静态水滴所在区间（相对底部）：碗沿之外、两层之间 */
const DROPLET_ZONES = [
  { y0: 0.73, y1: 1.42, rMin: 0.45, rMax: 1.7 }, // 中碗 → 底池
  { y0: 1.67, y1: 2.55, rMin: 0.43, rMax: 1.2 }, // 上碗 → 中碗
  { y0: 2.71, y1: 3.03, rMin: 0.29, rMax: 0.8 } // 顶碟 → 上碗
]

export interface Fountain {
  group: THREE.Group
  /** 需要加进 dusk 插值的 Toon 材质 */
  toonMaterials: { mat: THREE.Material; palette: ToonPalette }[]
  /** 走 override identity 的网格（水面） */
  surfaces: THREE.Mesh[]
  update(dt: number): void
  setDusk(m: number): void
  setViewportHeight(px: number): void
  setLineWidth(px: number): void
}

/** 剔除模型里的静态水滴三角面，返回剔除数量 */
export function stripStaticDroplets(fountainRoot: THREE.Object3D, center: THREE.Vector3, baseY: number): number {
  let removed = 0
  const v = new THREE.Vector3()
  fountainRoot.updateWorldMatrix(true, true)
  fountainRoot.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry.index) return
    const pos = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.index
    const keep: number[] = []
    const cy = new Float32Array(pos.count)
    const cr = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      cy[i] = v.y - baseY
      cr[i] = Math.hypot(v.x - center.x, v.z - center.z)
    }
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t)
      const b = index.getX(t + 1)
      const c = index.getX(t + 2)
      const y = (cy[a]! + cy[b]! + cy[c]!) / 3
      const r = (cr[a]! + cr[b]! + cr[c]!) / 3
      const isDrop = DROPLET_ZONES.some((z) => y > z.y0 && y < z.y1 && r > z.rMin && r < z.rMax)
      if (isDrop) removed++
      else keep.push(a, b, c)
    }
    if (keep.length !== index.count) mesh.geometry.setIndex(keep)
  })
  return removed
}

/** 抛物线：起点 → 落点，返回 [t, r, y] 采样 */
function arc(spec: JetSpec, n: number): { r: number; y: number }[] {
  const [r0, y0] = spec.from
  const [r1, y1] = spec.to
  const tLand = (spec.vy0 + Math.sqrt(spec.vy0 * spec.vy0 + 2 * G * (y0 - y1))) / G
  const vr = (r1 - r0) / tLand
  const out: { r: number; y: number }[] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * tLand
    out.push({ r: r0 + vr * t, y: y0 + spec.vy0 * t - 0.5 * G * t * t })
  }
  return out
}

/** 正态随机（Box–Muller） */
function gauss() {
  return Math.sqrt(-2 * Math.log(Math.max(1e-6, Math.random()))) * Math.cos(2 * Math.PI * Math.random())
}

/** 抛物线的落地时间与水平速度 */
function ballistic(spec: JetSpec) {
  const [r0, y0] = spec.from
  const [r1, y1] = spec.to
  const tLand = (spec.vy0 + Math.sqrt(spec.vy0 * spec.vy0 + 2 * G * (y0 - y1))) / G
  return { tLand, vr: (r1 - r0) / tLand }
}

/** 每股水的定义：水管与团块共用（同一角度、相位、抛物线） */
interface JetDef {
  spec: JetSpec
  ang: number
  phase: number
  origin: THREE.Vector3
  out: THREE.Vector3
  side: THREE.Vector3
  vr: number
  tLand: number
  yLand: number
  /** 弧长比例 u（与水管的 aAlong 相同）→ 飞行时间 */
  uToT: (u: number) => number
}

function makeJetDefs(center: THREE.Vector3, baseY: number): JetDef[] {
  const defs: JetDef[] = []
  for (const spec of JETS) {
    const { tLand, vr } = ballistic(spec)
    // 弧长 → 时间的查找表（抛物线越往下越快，弧长与时间不成正比）
    const N = 80
    const samples = arc(spec, N)
    const cum = [0]
    for (let i = 1; i <= N; i++) {
      cum.push(cum[i - 1]! + Math.hypot(samples[i]!.r - samples[i - 1]!.r, samples[i]!.y - samples[i - 1]!.y))
    }
    const total = cum[N]!
    const uToT = (u: number) => {
      const L = THREE.MathUtils.clamp(u, 0, 1) * total
      let i = 1
      while (i < N && cum[i]! < L) i++
      const f = (L - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!)
      return ((i - 1 + f) / N) * tLand
    }
    for (let k = 0; k < spec.count; k++) {
      const ang = spec.angle0 + (k / spec.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.12
      const out = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang))
      defs.push({
        spec,
        ang,
        phase: Math.random() * 10,
        origin: new THREE.Vector3(center.x + out.x * spec.from[0], baseY + spec.from[1], center.z + out.z * spec.from[0]),
        out,
        side: new THREE.Vector3(-out.z, 0, out.x),
        vr,
        tLand,
        yLand: baseY + spec.to[1],
        uToT
      })
    }
  }
  return defs
}

/** JS 版 jetHash / 断水判断（与 JET_SHAPE 同一公式，按 float32 逐步取整） */
const fr = (x: number) => x - Math.floor(x)
function jetHashJS(n: number, phase: number) {
  let p = fr(Math.fround(n * 0.1031 + phase * 0.0713))
  p = Math.fround(p * (p + 33.33))
  p = Math.fround(p * (p + p))
  return fr(p)
}
function jetGapAt(def: JetDef, u: number, time: number) {
  const B = def.spec.beads
  const s = u * B - time * B * 1.5 + def.phase * 0.37
  return u > 0.17 && jetHashJS(Math.floor(s) + 73, def.phase) < 0.3
}

function buildJets(spec: JetSpec, defs: JetDef[], center: THREE.Vector3, baseY: number) {
  const SEG = 180
  const RAD = 12
  const geoms: THREE.BufferGeometry[] = []
  let totalLen = 0
  const up = new THREE.Vector3(0, 1, 0)
  for (const def of defs) {
    const ang = def.ang
    const pts = arc(spec, 40).map(
      (p) => new THREE.Vector3(center.x + Math.cos(ang) * p.r, baseY + p.y, center.z + Math.sin(ang) * p.r)
    )
    const curve = new THREE.CatmullRomCurve3(pts)
    totalLen += curve.getLength()
    // 侧向 = 水平切向（水柱在「径向-竖直」平面里，侧向恒垂直于切线，起点竖直上喷也不退化）
    const S = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang))
    const nV = (SEG + 1) * (RAD + 1)
    const position = new Float32Array(nV * 3)
    const normal = new Float32Array(nV * 3)
    const uv = new Float32Array(nV * 2)
    const aCenter = new Float32Array(nV * 3)
    const aTangent = new Float32Array(nV * 3)
    const aSide = new Float32Array(nV * 3)
    const aAlong = new Float32Array(nV)
    const aAround = new Float32Array(nV)
    const aPhase = new Float32Array(nV).fill(def.phase)
    const c = new THREE.Vector3()
    const T = new THREE.Vector3()
    const N = new THREE.Vector3()
    const dir = new THREE.Vector3()
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG
      curve.getPointAt(u, c)
      curve.getTangentAt(u, T)
      N.crossVectors(S, T).normalize()
      if (N.dot(up) < 0 && Math.abs(T.y) > 0.99) N.negate()
      for (let j = 0; j <= RAD; j++) {
        const v = i * (RAD + 1) + j
        const th = (j / RAD) * Math.PI * 2
        dir.copy(N).multiplyScalar(Math.cos(th)).addScaledVector(S, Math.sin(th))
        position.set([c.x + dir.x * spec.radius, c.y + dir.y * spec.radius, c.z + dir.z * spec.radius], v * 3)
        normal.set([dir.x, dir.y, dir.z], v * 3)
        uv.set([u, j / RAD], v * 2)
        aCenter.set([c.x, c.y, c.z], v * 3)
        aTangent.set([T.x, T.y, T.z], v * 3)
        aSide.set([S.x, S.y, S.z], v * 3)
        aAlong[v] = u
        aAround[v] = j / RAD
      }
    }
    const index: number[] = []
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < RAD; j++) {
        const a = i * (RAD + 1) + j
        const b = (i + 1) * (RAD + 1) + j
        // 绕向：(b-a)×((a+1)-a) = T × ∂dir/∂θ 指向管内，所以反过来连，面朝外
        // （之前连反了：看到的是管子远端内壁，明暗上下颠倒）
        index.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(position, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setAttribute('aCenter', new THREE.BufferAttribute(aCenter, 3))
    g.setAttribute('aTangent', new THREE.BufferAttribute(aTangent, 3))
    g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 3))
    g.setAttribute('aAlong', new THREE.BufferAttribute(aAlong, 1))
    g.setAttribute('aAround', new THREE.BufferAttribute(aAround, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1))
    g.setIndex(index)
    geoms.push(g)
  }
  return { geometry: mergeGeometries(geoms)!, length: totalLen / defs.length }
}

/**
 * 上半段水柱形状（顶点着色器，可见材质与 identity 孪生体共用）：
 *  - 下宽上窄：出水口 0.55× → 往下变宽；起伏：两组向下传播、左右不同步的波，越往下越大；中心线横向摆动；
 *  - 中段随机「断水格」：断下来的一截缩成泪滴，断口两侧收成圆头（JS 里有同一套判断，下半段团块据此同步断流）；
 *  - 在 uEnd 附近不规则地收尖消失，由下半段团块接手。
 */
const JET_SHAPE = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aTangent;
  attribute vec3 aSide;
  attribute float aAlong;
  attribute float aAround;
  attribute float aPhase;
  uniform float uFlowTime;
  uniform float uJetR;
  uniform float uJetLen;
  uniform float uBeads;
  uniform float uEnd;

  // 与 JS 的 jetHashJS 同一公式（不用 sin，避免 GPU / JS 精度差异）
  float jetHash( float n ) {
    float p = fract( n * 0.1031 + aPhase * 0.0713 );
    p *= p + 33.33;
    p *= p + p;
    return fract( p );
  }
  float jetCell( float u ) { return u * uBeads - uFlowTime * uBeads * 1.5 + aPhase * 0.37; }
  float jetMidGap( float u, float n ) { return step( jetHash( n + 73.0 ), 0.3 ) * smoothstep( 0.12, 0.22, u ); }
  float jetCap( float d ) { d = clamp( d, 0.0, 1.0 ); return sqrt( d * ( 2.0 - d ) ); }

  float jetRadius( float u, float th ) {
    float t = uFlowTime;
    float R = uJetR * mix( 0.55, 1.8, pow( u, 0.9 ) );
    float wob = mix( 0.03, 0.3, u * u );
    float s1 = u * uJetLen * 7.0 - t * 6.0 + aPhase;
    float s2 = u * uJetLen * 12.0 - t * 9.0 + aPhase * 1.7;
    R *= 1.0 + wob * ( 0.6 * sin( s1 + 2.0 * th ) + 0.4 * sin( s2 - 3.0 * th ) );
    float s = jetCell( u );
    float n = floor( s );
    float f = fract( s );
    float r1 = jetHash( n );
    float r2 = jetHash( n + 17.0 );
    float gMid = jetMidGap( u, n );
    float h = mix( 0.5, mix( 0.22, 0.36, r2 ), gMid );
    float c0 = 0.5 + ( r1 - 0.5 ) * ( 0.5 - h ) * 1.6;
    float x = ( f - c0 ) / h;
    float prof = pow( max( 0.0, 1.0 - x * x ), x > 0.0 ? 0.5 : 1.15 );
    float size = mix( 0.68, 1.05, r1 ) * 0.85;
    float capLen = 0.38;
    float capBelow = mix( 1.0, jetCap( ( 1.0 - f ) / capLen ), jetMidGap( u, n + 1.0 ) );
    float capAbove = mix( 1.0, jetCap( f / capLen ), jetMidGap( u, n - 1.0 ) );
    float r = R * mix( capBelow * capAbove, prof * size, gMid );
    // 末端不规则收尖（随时间、截面角起伏），下半段由团块接手
    float endU = uEnd + 0.035 * sin( t * 5.0 + aPhase * 3.1 ) + 0.02 * sin( th * 3.0 + t * 7.0 );
    return r * smoothstep( endU, endU - 0.12, u );
  }

  vec3 jetCenter( float u ) {
    float sway = uJetR * 2.2 * u * u;
    return aCenter + aSide * sway * sin( u * uJetLen * 4.0 - uFlowTime * 4.0 + aPhase * 2.3 );
  }

  void jetShape( out vec3 pos, out vec3 nrm ) {
    float u = aAlong;
    float th = aAround * 6.2831853;
    vec3 dir = normalize( position - aCenter );
    float r = jetRadius( u, th );
    pos = jetCenter( u ) + dir * r;
    float du = 0.003;
    float drds = ( jetRadius( min( u + du, 1.0 ), th ) - jetRadius( max( u - du, 0.0 ), th ) ) / ( 2.0 * du * uJetLen );
    nrm = normalize( dir - aTangent * clamp( drds, -6.0, 6.0 ) );
  }
`

function jetIdMaterial(identity: number, shapeUniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    uniforms: { uIdent: { value: identity }, uFar: { value: ID_FAR }, ...shapeUniforms },
    vertexShader: /* glsl */ `
      ${JET_SHAPE}
      varying float vViewZ;
      varying vec3 vN;
      void main() {
        vec3 p;
        vec3 n;
        jetShape( p, n );
        vN = normalize( normalMatrix * n );
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIdent;
      uniform float uFar;
      varying float vViewZ;
      varying vec3 vN;
      ${OCT_ENCODE}
      void main() {
        gl_FragColor = vec4( uIdent, vViewZ / uFar, octEncode( normalize( vN ) ) );
      }
    `
  })
}

export function createFountain(opts: {
  fountainRoot: THREE.Object3D
  gradientMap: THREE.Texture
  waterPalette: ToonPalette
  spriteMap: THREE.Texture
  idScene: THREE.Scene
  allocId: () => number
}): Fountain {
  const box = new THREE.Box3().setFromObject(opts.fountainRoot)
  const center = box.getCenter(new THREE.Vector3())
  const baseY = box.min.y
  const removed = stripStaticDroplets(opts.fountainRoot, center, baseY)
  console.info(`[october] fountain: removed ${removed} static droplet triangles`)

  const group = new THREE.Group()
  group.name = '喷泉水流'
  const toonMaterials: Fountain['toonMaterials'] = []
  const surfaces: THREE.Mesh[] = []
  const flowTime = { value: 0 }
  const lineWidth = { value: 1.2 }

  // 涟漪 / 高光颜色（线性），暮色插值
  const HI_DAY = new THREE.Color('#e4f5f1')
  const HI_DUSK = new THREE.Color('#f6cdb9')
  const INK_DAY = new THREE.Color('#244a5c')
  const INK_DUSK = new THREE.Color('#2a2244')
  const hiColor = { value: HI_DAY.clone() }
  const inkColor = { value: INK_DAY.clone() }
  const foamColor = { value: new THREE.Color('#f7fbf8') }

  // ---------------- 水面：Toon 材质 + 涟漪 ----------------
  const pools: { key: keyof typeof LEVEL; impact: number }[] = [
    { key: 'basin', impact: JETS[2]!.to[0] },
    { key: 'middle', impact: JETS[1]!.to[0] },
    { key: 'upper', impact: 0.0 }, // 上碗本身无落水，只有轻微水纹（冠状水流落在顶碟）
    { key: 'top', impact: JETS[0]!.to[0] }
  ]
  for (const pool of pools) {
    const lv = LEVEL[pool.key]
    const geom = new THREE.CircleGeometry(lv.r, 96)
    geom.rotateX(-Math.PI / 2)
    const mat = createToonMaterial({ palette: opts.waterPalette, gradientMap: opts.gradientMap })
    const baseCompile = mat.onBeforeCompile
    mat.onBeforeCompile = (shader, r) => {
      baseCompile.call(mat, shader, r)
      shader.uniforms.uFlowTime = flowTime
      shader.uniforms.uImpact = { value: pool.impact }
      shader.uniforms.uRadius = { value: lv.r }
      shader.uniforms.uHi = hiColor
      shader.uniforms.uInkW = inkColor
      shader.uniforms.uFoam = foamColor
      shader.uniforms.uLinePx = lineWidth
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uFlowTime; uniform float uImpact; uniform float uRadius; uniform float uLinePx;
          uniform vec3 uHi; uniform vec3 uInkW; uniform vec3 uFoam;`
        )
        .replace(
          /#include <opaque_fragment>(?![\s\S]*#include <opaque_fragment>)/,
          `{
            // 局部坐标（CircleGeometry 的 uv 映射到 [-R, R]）
            vec2 P = (vUv - 0.5) * 2.0 * uRadius;
            float r = length(P);
            float a = atan(P.y, P.x);
            float t = uFlowTime;
            float wob = 0.03 * sin(a * 7.0 + t * 1.3) + 0.02 * sin(a * 13.0 - t * 2.1);
            float d = abs(r + wob - uImpact);
            // 涟漪：从落水圈向内外扩散的色带，越远越窄、越稀
            float freq = 5.5 / max(uRadius, 0.4);
            float w = fract(d * freq - t * 0.9);
            // 无落水的碗（上碗）：从中心柱向外的细波纹铺满整碗
            float spread = uImpact > 0.01 ? uRadius * 0.75 : uRadius * 1.1;
            float fade = 1.0 - smoothstep(0.0, spread, d);
            float bandW = 0.24 * fade;
            float band = step(w, bandW);
            // 色带边缘细墨线：用 fwidth 换算成像素，线宽 = 主线 × 0.55
            float px = max(fwidth(w), 1e-4);
            float e = min(abs(w - bandW), min(w, 1.0 - w)) / px;
            float line = bandW > 0.02 ? 1.0 - smoothstep(uLinePx * 0.55 * 0.5 - 0.5, uLinePx * 0.55 * 0.5 + 0.5, e) : 0.0;
            // 落水圈白沫
            float foamR = 0.05 + 0.025 * sin(a * 23.0 + t * 6.0) + 0.015 * sin(a * 41.0 - t * 9.0);
            float foam = uImpact > 0.01 ? step(d, foamR) : 0.0;
            vec3 lit = outgoingLight;
            outgoingLight = mix(outgoingLight, uHi * (0.55 + 0.45 * toonIrradiance), band * 0.85);
            outgoingLight = mix(outgoingLight, uFoam * (0.6 + 0.4 * toonIrradiance), foam);
            outgoingLight = mix(outgoingLight, uInkW, line * 0.75 * (1.0 - foam));
          }
          #include <opaque_fragment>`
        )
    }
    mat.customProgramCacheKey = () => `october-water-pool`
    const mesh = new THREE.Mesh(geom, mat)
    mesh.position.set(center.x, baseY + lv.y, center.z)
    mesh.name = `喷泉水面-${pool.key}`
    mesh.receiveShadow = true
    mesh.userData.toonKey = 'fountainWater'
    group.add(mesh)
    surfaces.push(mesh)
    toonMaterials.push({ mat, palette: opts.waterPalette })
  }

  // ---------------- 水流 ----------------
  // 上半段：连续的变形水管（下宽上窄、起伏、中段断水、圆头断口）；
  // 下半段：从水管末端接手的烟尘同款团块，纯色平涂（不画暗面），越往下越大越散，轮廓蓬松。
  // 两者用同一个 identity → 交界处没有线，外轮廓连成一体。
  const waterId = opts.allocId()
  const defs = makeJetDefs(center, baseY)
  const jetLen = new Map<JetSpec, number>()
  for (const spec of JETS) {
    const specDefs = defs.filter((d) => d.spec === spec)
    const { geometry: geom, length } = buildJets(spec, specDefs, center, baseY)
    jetLen.set(spec, length)
    const shapeUniforms = {
      uFlowTime: flowTime,
      uJetR: { value: spec.radius },
      uJetLen: { value: length },
      uBeads: { value: spec.beads },
      uEnd: { value: spec.uEnd }
    }
    const mat = createToonMaterial({ palette: opts.waterPalette, gradientMap: opts.gradientMap })
    const baseCompile = mat.onBeforeCompile
    mat.onBeforeCompile = (shader, r) => {
      baseCompile.call(mat, shader, r)
      Object.assign(shader.uniforms, shapeUniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${JET_SHAPE}`)
        .replace('#include <beginnormal_vertex>', 'vec3 jetPos;\nvec3 jetNrm;\njetShape( jetPos, jetNrm );\nvec3 objectNormal = jetNrm;')
        .replace('#include <begin_vertex>', 'vec3 transformed = jetPos;')
    }
    mat.customProgramCacheKey = () => 'october-water-jet'
    const mesh = new THREE.Mesh(geom, mat)
    mesh.name = `喷泉水柱-${spec.name}`
    mesh.frustumCulled = false
    mesh.layers.set(1)
    group.add(mesh)
    toonMaterials.push({ mat, palette: opts.waterPalette })
    const twin = new THREE.Mesh(geom, jetIdMaterial(waterId, shapeUniforms))
    twin.name = `${mesh.name}-identity`
    twin.frustumCulled = false
    opts.idScene.add(twin)
  }

  const viewportHeight = { value: 720 }
  const waterLit = { value: new THREE.Color() }
  const PUFFS = 3200
  const pPos = new Float32Array(PUFFS * 3)
  const pSize = new Float32Array(PUFFS)
  const pTile = new Float32Array(PUFFS)
  const pRot = new Float32Array(PUFFS)
  const pGeom = new THREE.BufferGeometry()
  pGeom.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage))
  pGeom.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage))
  pGeom.setAttribute('aTile', new THREE.BufferAttribute(pTile, 1).setUsage(THREE.DynamicDrawUsage))
  pGeom.setAttribute('aRot', new THREE.BufferAttribute(pRot, 1).setUsage(THREE.DynamicDrawUsage))
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: opts.spriteMap }, uViewportHeight: viewportHeight, uLit: waterLit },
    vertexShader: SPRITE_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uLit;
      ${SPRITE_MASK}
      void main() {
        if (!spriteInside(spriteCoord())) discard;
        // 纯色平涂：不画暗面，团块融成一股，只留外轮廓
        gl_FragColor = vec4(uLit, 1.0);
        #include <colorspace_fragment>
      }
    `
  })
  const puffs = new THREE.Points(pGeom, pMat)
  puffs.name = '喷泉水流-团块'
  puffs.frustumCulled = false
  puffs.layers.set(1)
  group.add(puffs)
  const puffTwin = new THREE.Points(pGeom, spriteIdMaterial(opts.spriteMap, waterId, viewportHeight))
  puffTwin.name = '喷泉水流-团块-identity'
  puffTwin.frustumCulled = false
  opts.idScene.add(puffTwin)

  interface Puff {
    alive: boolean
    fresh: boolean
    def: JetDef
    age: number
    life: number
    pos: THREE.Vector3
    vel: THREE.Vector3
    s0: number
    s1: number
  }
  const pf: Puff[] = Array.from({ length: PUFFS }, () => ({
    alive: false, fresh: false, def: defs[0]!, age: 0, life: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), s0: 0, s1: 0
  }))
  const accs = defs.map(() => Math.random())
  let pCursor = 0

  /** 与 JET_SHAPE 一致的上半段半径（不含起伏），用于让团块初始大小接上水管末端 */
  const tubeR = (spec: JetSpec, u: number) => spec.radius * THREE.MathUtils.lerp(0.55, 1.8, Math.pow(u, 0.9))

  function updatePuffs(dt: number) {
    const now = flowTime.value
    defs.forEach((d, di) => {
      const spec = d.spec
      accs[di]! += dt * spec.rate
      const count = Math.floor(accs[di]!)
      accs[di]! -= count
      const k = spec.sizeBottom / 0.165
      for (let c = 0; c < count; c++) {
        // 在水管末端那一段（收尖区）出发
        const uE = spec.uEnd - 0.12 + Math.random() * 0.1
        // 水管在这里正好断水 → 不发射，断口一路延续到下半段
        if (jetGapAt(d, uE, now)) continue
        const a0 = d.uToT(uE)
        const p = pf[pCursor]!
        const idx = pCursor
        pCursor = (pCursor + 1) % PUFFS
        p.alive = true
        p.fresh = true
        p.def = d
        p.age = 0
        p.life = Math.max(0.05, d.tLand - a0)
        // 位置：沿同一条抛物线（含水管中心线的横向摆动）
        const sway = spec.radius * 2.2 * uE * uE * Math.sin(uE * jetLen.get(spec)! * 4 - now * 4 + d.phase * 2.3)
        p.pos
          .copy(d.origin)
          .addScaledVector(d.out, d.vr * a0)
          .addScaledVector(d.side, sway + (Math.random() - 0.5) * tubeR(spec, uE))
        p.pos.y += spec.vy0 * a0 - 0.5 * G * a0 * a0
        // 速度：抛物线速度 + 从这里开始的随机散开
        p.vel
          .copy(d.out)
          .multiplyScalar(d.vr + gauss() * 0.08 * k)
          .addScaledVector(d.side, gauss() * 0.09 * k)
        p.vel.y = spec.vy0 - G * a0 + gauss() * 0.06 * k
        // 子帧：本帧内随机已飞行 0..dt，沿抛物线推进（低帧率也连续，不会一簇簇）
        const sub = Math.random() * dt
        p.pos.addScaledVector(p.vel, sub)
        p.pos.y -= 0.5 * G * sub * sub
        p.vel.y -= G * sub
        p.age = sub
        // 大小：从水管末端直径接上，越往下越大
        p.s0 = (tubeR(spec, uE) * 2) / 0.75 * (0.85 + Math.random() * 0.3)
        p.s1 = spec.sizeBottom * (0.75 + Math.random() * 0.5)
        pTile[idx] = Math.floor(Math.random() * 4)
        pRot[idx] = Math.random() * Math.PI * 2
      }
    })
    for (let i = 0; i < PUFFS; i++) {
      const p = pf[i]!
      if (!p.alive) {
        pSize[i] = 0
        continue
      }
      if (p.fresh) p.fresh = false
      else {
        p.age += dt
        p.vel.y -= G * dt
        p.pos.addScaledVector(p.vel, dt)
      }
      if (p.pos.y < p.def.yLand) {
        p.alive = false
        pSize[i] = 0
        if (Math.random() < 0.1) spawnSplash(p.pos, p.def.out, p.def.spec.radius * 2.2)
        continue
      }
      pPos[i * 3] = p.pos.x
      pPos[i * 3 + 1] = p.pos.y
      pPos[i * 3 + 2] = p.pos.z
      pSize[i] = THREE.MathUtils.lerp(p.s0, p.s1, Math.min(1, p.age / p.life))
    }
    pGeom.attributes.position!.needsUpdate = true
    pGeom.attributes.aSize!.needsUpdate = true
    pGeom.attributes.aTile!.needsUpdate = true
    pGeom.attributes.aRot!.needsUpdate = true
  }

  // ---------------- 水花 ----------------
  const SPLASH = 420
  const sPos = new Float32Array(SPLASH * 3)
  const sSize = new Float32Array(SPLASH)
  const sTile = new Float32Array(SPLASH)
  const sRot = new Float32Array(SPLASH)
  const sGeom = new THREE.BufferGeometry()
  sGeom.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage))
  sGeom.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1).setUsage(THREE.DynamicDrawUsage))
  sGeom.setAttribute('aTile', new THREE.BufferAttribute(sTile, 1))
  sGeom.setAttribute('aRot', new THREE.BufferAttribute(sRot, 1))
  const sMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: opts.spriteMap }, uViewportHeight: viewportHeight, uHi: hiColor, uBase: { value: new THREE.Color() } },
    vertexShader: SPRITE_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uHi;
      uniform vec3 uBase;
      ${SPRITE_MASK}
      void main() {
        vec2 pc = spriteCoord();
        if (!spriteInside(pc)) discard;
        float c = cos(vRot), s = sin(vRot);
        vec2 q = clamp(pc + mat2(c, s, -s, c) * vec2(0.18, -0.18), 0.0, 1.0);
        float lit = texture2D(uMap, spriteCell() + q * 0.5).r;
        gl_FragColor = vec4(lit > 0.5 ? uHi : uBase, 1.0);
        #include <colorspace_fragment>
      }
    `
  })
  const splash = new THREE.Points(sGeom, sMat)
  splash.name = '喷泉水花'
  splash.frustumCulled = false
  splash.layers.set(1)
  group.add(splash)
  const splashTwin = new THREE.Points(sGeom, spriteIdMaterial(opts.spriteMap, opts.allocId(), viewportHeight))
  splashTwin.frustumCulled = false
  opts.idScene.add(splashTwin)

  const sp = Array.from({ length: SPLASH }, (_, i) => ({ alive: false, age: 0, life: 0.3, size: 0.08, pos: new THREE.Vector3(), vel: new THREE.Vector3(), i }))
  for (let i = 0; i < SPLASH; i++) {
    sTile[i] = i % 4
    sRot[i] = Math.random() * Math.PI * 2
  }
  let cursor = 0

  /** 团块落进水面时溅起的小水花 */
  function spawnSplash(at: THREE.Vector3, out: THREE.Vector3, size: number) {
    const p = sp[cursor]!
    cursor = (cursor + 1) % SPLASH
    const k = size / 0.07
    p.alive = true
    p.age = 0
    p.life = 0.2 + Math.random() * 0.22
    p.size = size * (0.5 + Math.random() * 0.6)
    p.pos.copy(at)
    p.vel.copy(out).multiplyScalar((0.1 + Math.random() * 0.4) * k)
    p.vel.x += (Math.random() - 0.5) * 0.5 * k
    p.vel.z += (Math.random() - 0.5) * 0.5 * k
    p.vel.y = (0.5 + Math.random() * 0.9) * Math.sqrt(k)
  }

  function updateSplash(dt: number) {
    for (const p of sp) {
      if (!p.alive) {
        sSize[p.i] = 0
        continue
      }
      p.age += dt
      if (p.age >= p.life) {
        p.alive = false
        sSize[p.i] = 0
        continue
      }
      p.vel.y -= G * dt
      p.pos.addScaledVector(p.vel, dt)
      sPos.set([p.pos.x, p.pos.y, p.pos.z], p.i * 3)
      const t = p.age / p.life
      sSize[p.i] = p.size * (t < 0.2 ? 0.5 + 2.5 * t : 1 - (t - 0.2) / 0.8)
    }
    sGeom.attributes.position!.needsUpdate = true
    sGeom.attributes.aSize!.needsUpdate = true
  }

  const baseCol = new THREE.Color()
  function setDusk(m: number) {
    hiColor.value.lerpColors(HI_DAY, HI_DUSK, m)
    inkColor.value.lerpColors(INK_DAY, INK_DUSK, m)
    const p = opts.waterPalette
    const d = p.d.map((v, i) => v + ((p.nd ?? p.d)[i]! - v) * m)
    baseCol.setRGB(d[0]!, d[1]!, d[2]!)
    // 团块颜色 = 水柱 Toon 受光色带（three-tone 最亮一阶：受光 0.955 + 背光 0.045），与水柱受光面同一种蓝
    const ii = p.i.map((v, k) => v + ((p.ni ?? p.i)[k]! - v) * m)
    waterLit.value.setRGB(ii[0]!, ii[1]!, ii[2]!).lerp(baseCol, 0.955)
    ;(sMat.uniforms.uBase!.value as THREE.Color).copy(baseCol)
  }
  setDusk(0)

  return {
    group,
    toonMaterials,
    surfaces,
    update(dt) {
      flowTime.value += dt
      updatePuffs(Math.min(dt, 0.1))
      updateSplash(Math.min(dt, 0.1))
    },
    setDusk,
    setViewportHeight(px) {
      viewportHeight.value = px
    },
    setLineWidth(px) {
      lineWidth.value = px
    }
  }
}
