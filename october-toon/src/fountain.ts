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
 *   - 水流：不用贴图高光，靠形状表现流动 —— 下宽上窄、越往下越起伏弯折、颈缩断成圆头水珠，
 *     下段水柱与水珠的轮廓逐步变成烟尘团块那种「圆鼓凸起 + 内凹尖角」（见 JET_SHAPE）；
 *   - 水面：从落水点扩散的涟漪色带 + 色带边缘细墨线（线宽同样按画面高度比例）+ 落水点白沫；
 *   - 水花：烟尘同款硬边团块精灵，水色。
 * 全部参与描边：水面走 identity override；水流（着色器变形）/ 水花（精灵）用 identity 孪生体（共享几何与变形代码）。
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
  /** 水柱基准半径：出水口 ≈ 0.55×，落点 ≈ 2.1×（下宽上窄） */
  radius: number
  /** 沿程「颈缩 → 水珠」的周期数（越大水珠越小越密） */
  beads: number
  angle0: number
  /** 落在哪个水面（涟漪中心半径 = to[0]） */
  pool: keyof typeof LEVEL
}

const JETS: JetSpec[] = [
  // 顶部尖饰向上喷，冠状散开落进顶碟
  { name: 'crown', count: 6, from: [0.02, 3.92], to: [0.29, 3.14], vy0: 1.5, radius: 0.02, beads: 6, angle0: 0.3, pool: 'top' },
  // 上碗溢出 → 中碗
  { name: 'upper', count: 8, from: [0.63, 2.66], to: [0.86, 1.6], vy0: 0.3, radius: 0.032, beads: 5, angle0: 0.0, pool: 'middle' },
  // 中碗溢出 → 底池
  { name: 'middle', count: 10, from: [0.99, 1.63], to: [1.5, 0.5], vy0: 0.35, radius: 0.04, beads: 5, angle0: 0.2, pool: 'basin' }
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

/**
 * 一层的所有水柱合成一个几何。只生成「基准管」（每圈一个截面环），
 * 真正的形状（下宽上窄、起伏弯折、颈缩断成水珠）在顶点着色器里按时间计算（JET_SHAPE）。
 * 每个顶点带：中心线点 aCenter、切线 aTangent、侧向 aSide、沿程 aAlong(0=出水口,1=落点)、
 * 截面角 aAround(0..1)、每股水的随机相位 aPhase。
 */
function buildJets(spec: JetSpec, center: THREE.Vector3, baseY: number) {
  const SEG = 180
  // 截面分段：要表现绕一圈 5～7 个「团块瓣」，每瓣至少 4 段
  const RAD = 28
  const geoms: THREE.BufferGeometry[] = []
  let totalLen = 0
  const up = new THREE.Vector3(0, 1, 0)
  for (let k = 0; k < spec.count; k++) {
    const ang = spec.angle0 + (k / spec.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.12
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
    const aPhase = new Float32Array(nV).fill(Math.random() * 10)
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
        // 绕向：(b-a)×((a+1)-a) = T × ∂dir/∂θ 指向管内，所以反过来连，面朝外（否则明暗上下颠倒）
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
  return { geometry: mergeGeometries(geoms)!, length: totalLen / spec.count }
}

/**
 * 水柱形状（顶点着色器，可见材质与 identity 孪生体共用 → 描边与形状严丝合缝）：
 *  1. 下宽上窄：半径从出水口 0.55× 增到落点 2.1×（集中的水柱 → 散开）；
 *  2. 起伏弯折：两组沿水流向下传播、与截面角耦合的波（左右边缘不同步），振幅越往下越大；
 *     中心线再叠一个越往下越大的横向摆动 → 整股水柱是弯折的曲线；
 *  3. 颈缩断开：Plateau–Rayleigh 式的周期性变细，越往下越细直到半径为 0；
 *     剖面是椭圆，所以断口两端是圆头 → 一颗颗水珠，随水流往下走；
 *  4. 法线按半径沿程变化实时求（dr/ds），Toon 明暗跟着水珠形状走。
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

  // 每颗水珠的随机数：按「水珠编号 n + 每股水的相位」取，编号随水珠一起往下走 → 同一颗水珠形状不变
  float jetHash( float n ) { return fract( sin( n * 127.1 + aPhase * 311.7 ) * 43758.5453 ); }

  // 沿水流的水珠坐标（随时间往下走）
  float jetCell( float u ) { return u * uBeads - uFlowTime * uBeads * 1.5 + aPhase * 0.37; }

  // 后半段逐渐颈缩 → 断开；每颗水珠断得早晚不同
  float jetBreakup( float u, float n ) {
    return smoothstep( 0.42, 0.85, u ) * mix( 0.85, 1.0, jetHash( n + 41.0 ) );
  }

  // 中段的「断水」：随机一部分水珠格子在出水口之后就完全断开，空隙随水流往下走
  float jetMidGap( float u, float n ) {
    return step( jetHash( n + 73.0 ), 0.3 ) * smoothstep( 0.12, 0.22, u );
  }

  // 圆头：d=0 处半径为 0，d=1 处恢复满半径（四分之一圆）
  float jetCap( float d ) {
    d = clamp( d, 0.0, 1.0 );
    return sqrt( d * ( 2.0 - d ) );
  }

  // 团块瓣：越往下，轮廓逐步变成烟尘团块那种「圆鼓凸起 + 内凹尖角」。
  //   |sin|^0.45：顶部圆鼓、相邻凸起之间是尖的内凹；沿水流的凸起为主（相位随截面角与位置扰动），
  //   绕截面 5/7 瓣为辅，每瓣鼓起程度再随位置起伏 → 大小不一、不规则；
  //   用随水流移动的连续坐标 → 图案跟着水往下走、整股水上没有接缝。
  //   只改轮廓：法线用去掉团块瓣的光滑水柱求，明暗仍是水柱那一套（不出现每瓣各自的暗面）。
  float jetLobe( float u, float th ) {
    float s = jetCell( u );
    float amt = smoothstep( 0.22, 0.8, u ) * 1.0;
    float a3 = pow( abs( sin( s * 9.4248 + 1.3 * sin( th * 2.0 + aPhase ) + 0.8 * sin( s * 2.7 + aPhase ) ) ), 0.45 );
    float a1 = pow( abs( sin( th * 2.5 + s * 1.7 + aPhase ) ), 0.45 );
    float a2 = pow( abs( sin( th * 3.5 - s * 2.3 + aPhase * 2.1 ) ), 0.45 );
    float vary = 0.65 + 0.35 * sin( s * 3.1 + th + aPhase * 1.3 );
    float L = ( 0.5 * a3 + 0.3 * a1 + 0.2 * a2 ) * vary + ( 1.0 - vary ) * 0.74;
    return 1.0 + amt * 1.2 * ( L - 0.74 );
  }

  float jetRadius( float u, float th ) {
    float t = uFlowTime;
    // 1. 下宽上窄
    float R = uJetR * mix( 0.55, 1.8, pow( u, 0.9 ) );
    // 2. 起伏：两组向下传播、与截面角耦合的波，越往下越大 → 边缘是弯折的曲线
    float wob = mix( 0.03, 0.3, u * u );
    float s1 = u * uJetLen * 7.0 - t * 6.0 + aPhase;
    float s2 = u * uJetLen * 12.0 - t * 9.0 + aPhase * 1.7;
    R *= 1.0 + wob * ( 0.6 * sin( s1 + 2.0 * th ) + 0.4 * sin( s2 - 3.0 * th ) );
    float s = jetCell( u );
    // 4. 颈缩断成水珠：泪滴剖面（下端圆、上端尖），大小 / 长短 / 位置每颗不同
    float n = floor( s );
    float f = fract( s );
    float r1 = jetHash( n );
    float r2 = jetHash( n + 17.0 );
    float gMid = jetMidGap( u, n );
    float b = max( jetBreakup( u, n ), gMid );
    float h = mix( 0.5, mix( 0.22, 0.36, r2 ), b );
    float c0 = 0.5 + ( r1 - 0.5 ) * ( 0.5 - h ) * 1.6;
    float x = ( f - c0 ) / h;
    float prof = pow( max( 0.0, 1.0 - x * x ), x > 0.0 ? 0.5 : 1.15 );
    float size = mix( 0.68, 1.05, r1 ) * mix( 1.0, 0.85, gMid );
    // 断口两侧的连续水柱收成圆头（上一格 / 下一格是断水格时）
    float capLen = 0.38;
    float capBelow = mix( 1.0, jetCap( ( 1.0 - f ) / capLen ), jetMidGap( u, n + 1.0 ) );
    float capAbove = mix( 1.0, jetCap( f / capLen ), jetMidGap( u, n - 1.0 ) );
    return R * mix( capBelow * capAbove, prof * size, b );
  }

  // 中心线：越往下越大的横向摆动（弯折）+ 断开后水珠各自偏离中轴（散开）
  vec3 jetCenter( float u ) {
    float t = uFlowTime;
    float sway = uJetR * 2.2 * u * u;
    vec3 c = aCenter + aSide * sway * sin( u * uJetLen * 4.0 - t * 4.0 + aPhase * 2.3 );
    float s = jetCell( u );
    float n = floor( s );
    float k = smoothstep( 0.0, 1.0, fract( s ) );
    vec2 j0 = vec2( jetHash( n + 5.0 ), jetHash( n + 9.0 ) ) - 0.5;
    vec2 j1 = vec2( jetHash( n + 6.0 ), jetHash( n + 10.0 ) ) - 0.5;
    // 平滑插值，颈部不会出现错位折角
    vec2 j = mix( j0, j1, k );
    float spread = smoothstep( 0.5, 1.0, u );
    spread *= spread * uJetR * 2.6;
    vec3 nrm = normalize( cross( aSide, aTangent ) );
    return c + ( aSide * j.x + nrm * j.y ) * spread;
  }

  void jetShape( out vec3 pos, out vec3 nrm ) {
    float u = aAlong;
    float th = aAround * 6.2831853;
    vec3 dir = normalize( position - aCenter );
    float r = jetRadius( u, th );
    pos = jetCenter( u ) + dir * r * jetLobe( u, th );
    float du = 0.003;
    float drds = ( jetRadius( min( u + du, 1.0 ), th ) - jetRadius( max( u - du, 0.0 ), th ) ) / ( 2.0 * du * uJetLen );
    // 绕截面方向的半径变化（团块瓣）也计入法线，Toon 明暗跟着瓣的形状走
    float dth = 0.02;
    float drdth = ( jetRadius( u, th + dth ) - jetRadius( u, th - dth ) ) / ( 2.0 * dth );
    vec3 B = normalize( cross( aTangent, dir ) );
    nrm = normalize( dir - aTangent * clamp( drds, -6.0, 6.0 ) - B * clamp( drdth / max( r, 1e-4 ), -4.0, 4.0 ) );
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
  for (const spec of JETS) {
    const { geometry: geom, length } = buildJets(spec, center, baseY)
    const shapeUniforms = {
      uFlowTime: flowTime,
      uJetR: { value: spec.radius },
      uJetLen: { value: length },
      uBeads: { value: spec.beads }
    }
    const mat = createToonMaterial({ palette: opts.waterPalette, gradientMap: opts.gradientMap })
    const baseCompile = mat.onBeforeCompile
    mat.onBeforeCompile = (shader, r) => {
      baseCompile.call(mat, shader, r)
      Object.assign(shader.uniforms, shapeUniforms)
      // 法线 / 位置都换成 jetShape 的结果（beginnormal 在 begin_vertex 之前执行）
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${JET_SHAPE}`)
        .replace('#include <beginnormal_vertex>', 'vec3 jetPos;\nvec3 jetNrm;\njetShape( jetPos, jetNrm );\nvec3 objectNormal = jetNrm;')
        .replace('#include <begin_vertex>', 'vec3 transformed = jetPos;')
    }
    mat.customProgramCacheKey = () => 'october-water-jet'
    const mesh = new THREE.Mesh(geom, mat)
    mesh.name = `喷泉水流-${spec.name}`
    // 形状在着色器里变形 → 包围盒不准，关掉视锥剔除（一共 3 个网格）
    mesh.frustumCulled = false
    // layer 1：不走 override identity（override 材质没有这段变形），由孪生体写 identity
    mesh.layers.set(1)
    group.add(mesh)
    toonMaterials.push({ mat, palette: opts.waterPalette })

    const twin = new THREE.Mesh(geom, jetIdMaterial(opts.allocId(), shapeUniforms))
    twin.name = `${mesh.name}-identity`
    twin.frustumCulled = false
    opts.idScene.add(twin)
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
  const viewportHeight = { value: 720 }
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

  // 落水点（世界坐标）
  const landings: { p: THREE.Vector3; size: number }[] = []
  for (const spec of JETS) {
    for (let k = 0; k < spec.count; k++) {
      const ang = spec.angle0 + (k / spec.count) * Math.PI * 2
      landings.push({
        p: new THREE.Vector3(center.x + Math.cos(ang) * spec.to[0], baseY + spec.to[1] + 0.01, center.z + Math.sin(ang) * spec.to[0]),
        // 水花大小跟水流粗细走（顶部细水流的水花要小）
        size: spec.radius * (spec.name === 'crown' ? 1.4 : 2.0)
      })
    }
  }
  const sp = Array.from({ length: SPLASH }, (_, i) => ({ alive: false, age: 0, life: 0.3, size: 0.08, pos: new THREE.Vector3(), vel: new THREE.Vector3(), i }))
  for (let i = 0; i < SPLASH; i++) {
    sTile[i] = i % 4
    sRot[i] = Math.random() * Math.PI * 2
  }
  let cursor = 0
  let acc = 0
  const RATE = 520 // 每秒总水花数

  function updateSplash(dt: number) {
    acc += dt * RATE
    let n = Math.floor(acc)
    acc -= n
    while (n-- > 0) {
      const p = sp[cursor]!
      cursor = (cursor + 1) % SPLASH
      const land = landings[Math.floor(Math.random() * landings.length)]!
      const L = land.p
      const k = land.size / 0.1
      const out = new THREE.Vector3(L.x - center.x, 0, L.z - center.z).normalize()
      p.alive = true
      p.age = 0
      p.life = 0.22 + Math.random() * 0.25
      p.size = land.size * (0.6 + Math.random() * 0.8)
      p.pos.copy(L).addScaledVector(out, (Math.random() - 0.3) * 0.08 * k)
      p.pos.x += (Math.random() - 0.5) * 0.06 * k
      p.pos.z += (Math.random() - 0.5) * 0.06 * k
      p.vel.copy(out).multiplyScalar((0.2 + Math.random() * 0.5) * k)
      p.vel.x += (Math.random() - 0.5) * 0.5 * k
      p.vel.z += (Math.random() - 0.5) * 0.5 * k
      p.vel.y = (0.6 + Math.random() * 1.0) * Math.sqrt(k)
    }
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
    ;(sMat.uniforms.uBase!.value as THREE.Color).copy(baseCol)
  }
  setDusk(0)

  return {
    group,
    toonMaterials,
    surfaces,
    update(dt) {
      flowTime.value += dt
      updateSplash(dt)
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
