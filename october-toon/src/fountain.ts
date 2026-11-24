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
 *   - 水流：烟尘同款硬边团块组成（轮廓蓬松破碎，不黏稠）：出水口小而密连成一股，越往下越大越散，出水量起伏时断流；
 *   - 水面：从落水点扩散的涟漪色带 + 色带边缘细墨线（线宽同样按画面高度比例）+ 落水点白沫；
 *   - 水花：烟尘同款硬边团块精灵，水色。
 * 全部参与描边：水面走 identity override；水流团块 / 水花（精灵）用 identity 孪生体。
 */
import * as THREE from 'three'
import { createToonMaterial, type ToonPalette } from './toonMaterial'
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
  /** 团块直径（世界单位）：出水口 → 落点（下宽上窄） */
  sizeTop: number
  sizeBottom: number
  /** 每股每秒发射的团块数（越大水柱越连贯） */
  rate: number
  angle0: number
  /** 落在哪个水面（涟漪中心半径 = to[0]） */
  pool: keyof typeof LEVEL
}

const JETS: JetSpec[] = [
  // 顶部尖饰向上喷，冠状散开落进顶碟
  { name: 'crown', count: 6, from: [0.02, 3.92], to: [0.29, 3.14], vy0: 1.5, sizeTop: 0.028, sizeBottom: 0.085, rate: 100, angle0: 0.3, pool: 'top' },
  // 上碗溢出 → 中碗
  { name: 'upper', count: 8, from: [0.63, 2.66], to: [0.86, 1.6], vy0: 0.3, sizeTop: 0.042, sizeBottom: 0.17, rate: 105, angle0: 0.0, pool: 'middle' },
  // 中碗溢出 → 底池
  { name: 'middle', count: 10, from: [0.99, 1.63], to: [1.5, 0.5], vy0: 0.35, sizeTop: 0.05, sizeBottom: 0.21, rate: 110, angle0: 0.2, pool: 'basin' }
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

  // ---------------- 水流：烟尘同款硬边团块 ----------------
  // 每股水是一串从出水口按抛物线飞出的团块：出水口小而密 → 连成一股集中的水柱；
  // 越往下团块越大、速度越快越稀、初速的随机偏差让它们越飞越散 → 下宽上窄、轮廓蓬松破碎；
  // 出水量按随机节奏起伏，偶尔断流 → 断口是团块的圆润边缘，随水流往下走。
  const viewportHeight = { value: 720 }
  const waterLit = { value: new THREE.Color() }
  const waterShade = { value: new THREE.Color() }
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
    uniforms: { uMap: { value: opts.spriteMap }, uViewportHeight: viewportHeight, uLit: waterLit, uShade: waterShade },
    vertexShader: SPRITE_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uLit;
      uniform vec3 uShade;
      ${SPRITE_MASK}
      void main() {
        vec2 pc = spriteCoord();
        if (!spriteInside(pc)) discard;
        // 与烟尘一致的月牙暗面（左下），受光面是水色
        float c = cos(vRot), s = sin(vRot);
        vec2 q = clamp(pc + mat2(c, s, -s, c) * vec2(0.16, -0.16), 0.0, 1.0);
        float lit = texture2D(uMap, spriteCell() + q * 0.5).r;
        gl_FragColor = vec4(lit > 0.5 ? uLit : uShade, 1.0);
        #include <colorspace_fragment>
      }
    `
  })
  const puffs = new THREE.Points(pGeom, pMat)
  puffs.name = '喷泉水流'
  puffs.frustumCulled = false
  // layer 1 + identity 孪生体（与烟尘相同）：整股水只有外轮廓线，团块之间按前后遮挡出线
  puffs.layers.set(1)
  group.add(puffs)
  const puffTwin = new THREE.Points(pGeom, spriteIdMaterial(opts.spriteMap, opts.allocId(), viewportHeight))
  puffTwin.name = '喷泉水流-identity'
  puffTwin.frustumCulled = false
  opts.idScene.add(puffTwin)

  interface Jet {
    spec: JetSpec
    origin: THREE.Vector3
    out: THREE.Vector3
    side: THREE.Vector3
    vr: number
    tLand: number
    yLand: number
    acc: number
    ph1: number
    ph2: number
    w1: number
    w2: number
  }
  const jets: Jet[] = []
  for (const spec of JETS) {
    const { tLand, vr } = ballistic(spec)
    for (let k = 0; k < spec.count; k++) {
      const ang = spec.angle0 + (k / spec.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.12
      const out = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang))
      jets.push({
        spec,
        origin: new THREE.Vector3(center.x + out.x * spec.from[0], baseY + spec.from[1], center.z + out.z * spec.from[0]),
        out,
        side: new THREE.Vector3(-out.z, 0, out.x),
        vr,
        tLand,
        yLand: baseY + spec.to[1],
        acc: Math.random(),
        ph1: Math.random() * 10,
        ph2: Math.random() * 10,
        w1: 6 + Math.random() * 3,
        w2: 11 + Math.random() * 5
      })
    }
  }
  interface Puff {
    alive: boolean
    fresh: boolean
    jet: Jet
    age: number
    pos: THREE.Vector3
    vel: THREE.Vector3
    s0: number
    s1: number
  }
  const pf: Puff[] = Array.from({ length: PUFFS }, () => ({
    alive: false, fresh: false, jet: jets[0]!, age: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), s0: 0, s1: 0
  }))
  let pCursor = 0
  let clock = 0

  function updatePuffs(dt: number) {
    clock += dt
    for (const j of jets) {
      // 出水量节奏：两组正弦叠加，低于阈值时断流（约 15–20% 的时间）
      const n = 0.6 * Math.sin(clock * j.w1 + j.ph1) + 0.4 * Math.sin(clock * j.w2 + j.ph2)
      // 出水量：n 低于 -0.35 断流（约 25% 的时间），断口随水流往下走
      const flow = THREE.MathUtils.smoothstep(n, -0.35, -0.15)
      j.acc += dt * j.spec.rate * flow
      const count = Math.floor(j.acc)
      j.acc -= count
      const k = j.spec.sizeBottom / 0.21
      for (let c = 0; c < count; c++) {
        const p = pf[pCursor]!
        pCursor = (pCursor + 1) % PUFFS
        // 子帧：沿抛物线把本帧的团块均匀铺开（低帧率也不会一簇簇）
        const a = ((c + Math.random()) / count) * dt
        p.alive = true
        p.fresh = true
        p.jet = j
        p.age = a
        p.vel
          .copy(j.out)
          .multiplyScalar(j.vr + gauss() * 0.1 * k)
          .addScaledVector(j.side, gauss() * 0.13 * k)
        p.vel.y = j.spec.vy0 + gauss() * 0.07 * k
        p.pos
          .copy(j.origin)
          .addScaledVector(j.side, gauss() * j.spec.sizeTop * 0.15)
          .addScaledVector(p.vel, a)
        p.pos.y -= 0.5 * G * a * a
        p.vel.y -= G * a
        p.s0 = j.spec.sizeTop * (0.8 + Math.random() * 0.35)
        p.s1 = j.spec.sizeBottom * (0.75 + Math.random() * 0.5)
        pTile[(pCursor + PUFFS - 1) % PUFFS] = Math.floor(Math.random() * 4)
        pRot[(pCursor + PUFFS - 1) % PUFFS] = Math.random() * Math.PI * 2
      }
    }
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
      // 落进水面：消失，一部分溅起水花
      if (p.pos.y < p.jet.yLand) {
        p.alive = false
        pSize[i] = 0
        if (Math.random() < 0.12) spawnSplash(p.pos, p.jet.out, p.jet.spec.sizeTop * 1.1)
        continue
      }
      pPos[i * 3] = p.pos.x
      pPos[i * 3 + 1] = p.pos.y
      pPos[i * 3 + 2] = p.pos.z
      const t = Math.min(1, p.age / p.jet.tLand)
      pSize[i] = THREE.MathUtils.lerp(p.s0, p.s1, t)
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
    waterLit.value.copy(baseCol)
    const i = p.i.map((v, k) => v + ((p.ni ?? p.i)[k]! - v) * m)
    // 暗面取受光色与水的背光色之间（与烟尘一样偏亮），团块才会融成一股而不是一片片
    waterShade.value.setRGB(i[0]!, i[1]!, i[2]!).lerp(baseCol, 0.5)
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
