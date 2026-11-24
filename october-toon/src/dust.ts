/**
 * 老爷车后轮扬尘 —— 移植自 motorbike 的 dust.ts（原站 initBikeParticles）。
 *
 * 保留原站的：
 *  - 贴图 dust.png：2×2 图集，白色硬边团块（黑底，形状在 R 通道）→ 每个粒子随机取一格
 *  - 寿命内尺寸曲线 1 → 6 → 11 → 5 → 0（这里归一化成 0.09 → 0.55 → 1 → 0.45 → 0）
 *  - 速率 = 速度 × rateFactor，低于阈值不发射；尺寸随速度放大（uSize = v·0.4 + 0.6）
 *  - 往车后 + 两侧 + 上方甩出，带阻力收束；颜色默认取地面沙色
 *
 * 为十月改的：
 *  - 发射点：两个后轮接地点（原站是摩托后轮一个点）
 *  - 粒子在世界坐标里模拟（原站挂在摩托下面跟着走）：车开走后烟尘留在原地散开
 *  - 速度用老爷车动画的真实位移（0~38 单位/秒）驱动，停车时不扬尘
 *  - 点大小按世界尺寸 → 像素换算（与分辨率无关，10527×1024 与普通屏看起来一样大）
 *  - 修 motorbike 移植版的 bug：dust.png 的 alpha 全是 255，`max(tex.a, tex.r)` 恒为 1，
 *    粒子会画成实心方块；这里只用 R 通道作遮罩，并保持硬边（Toon 风格）
 *  - 粒子随机旋转，避免 4 种形状重复感
 */
import * as THREE from 'three'
import { ID_FAR } from './outlinePass'

/** 点精灵通用顶点着色器：世界直径 → 像素，带每粒子图集格与旋转 */
export const SPRITE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aTile;
  attribute float aRot;
  uniform float uViewportHeight;
  varying float vTile;
  varying float vRot;
  varying float vViewZ;
  void main() {
    vTile = aTile;
    vRot = aRot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewZ = -mv.z;
    gl_Position = projectionMatrix * mv;
    // 世界直径 → 像素：size · P[1][1] · 视口高 / 2 / 深度
    gl_PointSize = aSize * projectionMatrix[1][1] * uViewportHeight * 0.5 / max(0.001, -mv.z);
  }
`

/** 取图集形状（随机旋转后取 2×2 图集的一格），形状外 discard；返回旋转后的坐标供月牙阴影用 */
export const SPRITE_MASK = /* glsl */ `
  uniform sampler2D uMap;
  varying float vTile;
  varying float vRot;
  vec2 spriteCell() { return vec2(mod(vTile, 2.0), floor(vTile / 2.0)) * 0.5; }
  vec2 spriteCoord() {
    vec2 pc = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    return mat2(c, -s, s, c) * pc + 0.5;
  }
  bool spriteInside(vec2 pc) {
    if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) return false;
    return texture2D(uMap, spriteCell() + pc * 0.5).r >= 0.5;
  }
`

/** 点精灵的 identity 材质（写 identity + 深度 + 朝向镜头的法线），与可见粒子形状完全一致 */
export function spriteIdMaterial(map: THREE.Texture, identity: number, viewportHeight: { value: number }) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uViewportHeight: viewportHeight, uIdent: { value: identity }, uFar: { value: ID_FAR } },
    vertexShader: SPRITE_VERT,
    fragmentShader: /* glsl */ `
      uniform float uIdent;
      uniform float uFar;
      varying float vViewZ;
      ${SPRITE_MASK}
      void main() {
        if (!spriteInside(spriteCoord())) discard;
        gl_FragColor = vec4(uIdent, vViewZ / uFar, 0.0, 0.0);
      }
    `
  })
}

const COUNT = 1600
/** 原站 0.4s 是给高速摩托的；老爷车慢、体量大，烟团停留更久 */
/** 原站 0.4s：尘带长度 ≈ 车速 × 寿命，约 12 个单位（之前 0.8s 拖得太长） */
const LIFETIME = 0.42
/** 速度 → 浓度的参考值：老爷车巡航约 30 单位/秒 */
const REF_SPEED = 30
/** 每个后轮每秒最大发射数（原站 speed·2.6·rateFactor·200 的量级） */
const MAX_RATE = 210
/** 烟团最大直径（世界单位；车长 3.8，后轮半径约 0.22）。整体浓淡用 ?dust= 调 */
const MAX_SIZE = 1.0
/** 暗面 = 受光色 × 这个（线性空间）：比地面亮一档，否则暗面月牙会读成「洞」 */
const SHADE_TINT = new THREE.Color(0.86, 0.78, 0.68)

interface Particle {
  alive: boolean
  age: number
  life: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  size: number
  fresh: boolean
}

export interface DustTrail {
  object: THREE.Points
  /** 加到 outline.idExtras 里 */
  idObject: THREE.Points
  /** emitters：后轮世界坐标；carVel：车的世界速度（单位/秒） */
  update(dt: number, emitters: THREE.Vector3[], carVel: THREE.Vector3, density: number): void
  setColor(color: THREE.Color): void
  setViewportHeight(px: number): void
  reset(): void
}

export function createDustTrail(map: THREE.Texture, identity = 0.96): DustTrail {
  const positions = new Float32Array(COUNT * 3)
  const sizes = new Float32Array(COUNT)
  const tiles = new Float32Array(COUNT)
  const rots = new Float32Array(COUNT)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aTile', new THREE.BufferAttribute(tiles, 1))
  geometry.setAttribute('aRot', new THREE.BufferAttribute(rots, 1))

  const viewportHeight = { value: 720 }
  const material = new THREE.ShaderMaterial({
    // 不透明 + 写深度：烟团之间按真实前后遮挡（与 identity pass 一致）
    uniforms: {
      uMap: { value: map },
      uColor: { value: new THREE.Color('#f1e0c2') },
      uShade: { value: new THREE.Color('#e5cba6') },
      uViewportHeight: viewportHeight
    },
    vertexShader: SPRITE_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uShade;
      ${SPRITE_MASK}
      void main() {
        vec2 pc = spriteCoord();
        // 硬边：Toon 风格，不做软羽化
        if (!spriteInside(pc)) discard;
        // 月牙阴影：把形状往「光来的方向」（屏幕右上）挪一点再取样，
        // 挪过去后落在形状外的像素 = 背光边缘 → 暗色（与 Toon 物体的受光 / 背光两色一致）
        float c = cos(vRot), s = sin(vRot);
        vec2 toLight = mat2(c, s, -s, c) * vec2(0.16, -0.16); // 抵消粒子自身旋转，暗面始终在左下
        vec2 q = clamp(pc + toLight, 0.0, 1.0);
        float lit = texture2D(uMap, spriteCell() + q * 0.5).r;
        gl_FragColor = vec4(lit > 0.5 ? uColor : uShade, 1.0);
        #include <colorspace_fragment>
      }
    `
  })

  const points = new THREE.Points(geometry, material)
  points.name = '烟尘'
  points.frustumCulled = false
  // layer 1：不走 override 材质的 identity pass（那样画不出烟团形状），改由下面的孪生体写 identity
  points.layers.set(1)
  /** identity 孪生体：共享几何，放进 outline.idExtras → 烟团有外轮廓，也挡住后面物体的描边 */
  const idPoints = new THREE.Points(geometry, spriteIdMaterial(map, identity, viewportHeight))
  idPoints.name = '烟尘-identity'
  idPoints.frustumCulled = false

  const particles: Particle[] = []
  for (let i = 0; i < COUNT; i++) {
    particles.push({ alive: false, fresh: false, age: 0, life: LIFETIME, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1 })
    tiles[i] = i % 4
    rots[i] = Math.random() * Math.PI * 2
  }
  geometry.attributes.aRot!.needsUpdate = true

  const accs: number[] = []
  /** 上一帧的发射点：本帧新粒子沿 上一帧 → 本帧 均匀铺开（低帧率时不会一簇一簇断开） */
  const prevEmitters: THREE.Vector3[] = []
  const _from = new THREE.Vector3()
  let cursor = 0
  const fwd = new THREE.Vector3()
  const side = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)

  function reset() {
    prevEmitters.length = 0
    for (let i = 0; i < COUNT; i++) {
      particles[i]!.alive = false
      sizes[i] = 0
    }
    geometry.attributes.aSize!.needsUpdate = true
  }

  return {
    object: points,
    idObject: idPoints,
    reset,
    update(dt, emitters, carVel, density) {
      if (dt <= 0) return
      const speed = carVel.length()
      // 原站：v = speed·2.6·rateFactor，rate = v·200，< 50 视为 0
      const v = Math.min(speed / REF_SPEED, 1.3) * density
      const rate = v < 0.12 ? 0 : v * MAX_RATE
      // 原站 uSize = v·0.4 + 0.6
      const sizeScale = Math.min(v, 1.3) * 0.4 + 0.6

      if (speed > 0.01) fwd.copy(carVel).setY(0).normalize()
      side.crossVectors(up, fwd).normalize()

      emitters.forEach((e, k) => {
        accs[k] = (accs[k] ?? 0) + dt * rate
        const n = Math.floor(accs[k]!)
        accs[k]! -= n
        const sideSign = k % 2 === 0 ? -1 : 1
        const from = prevEmitters[k] && prevEmitters[k]!.distanceTo(e) < 10 ? prevEmitters[k]! : e
        for (let j = 0; j < n; j++) {
          const p = particles[cursor]!
          cursor = (cursor + 1) % COUNT
          // 子帧：f=0 在上一帧位置（已经「活」了一整帧），f=1 在本帧位置
          const f = (j + Math.random()) / n
          _from.lerpVectors(from, e, f)
          p.alive = true
          p.fresh = true
          p.age = (1 - f) * dt
          p.life = LIFETIME * (0.7 + Math.random() * 0.6)
          p.size = MAX_SIZE * sizeScale * (0.6 + Math.random() * 0.6)
          // 出生点：后轮接地点附近，往外侧铺开一点（原站 spread 0 → .05 → .55）
          p.pos
            .copy(_from)
            .addScaledVector(side, sideSign * Math.random() * 0.25)
            .addScaledVector(fwd, -Math.random() * 0.3)
          p.pos.y = Math.max(p.pos.y, 0.05)
          // 世界速度：随车带走一小部分 + 往后甩 + 向外侧 + 上抛（原站曲线整体往后下方甩）
          p.vel
            .copy(carVel)
            .multiplyScalar(0.12)
            .addScaledVector(fwd, -(1.5 + Math.random() * 3.0) * (0.5 + v * 0.6))
            .addScaledVector(side, sideSign * (0.4 + Math.random() * 1.4) * (0.4 + v * 0.6))
          p.vel.y += (0.6 + Math.random() * 1.2) * (0.5 + v * 0.5)
          // 补上这段子帧里已经走过的路程
          p.pos.addScaledVector(p.vel, p.age)
        }
      })
      emitters.forEach((e, k) => (prevEmitters[k] ??= new THREE.Vector3()).copy(e))

      for (let i = 0; i < COUNT; i++) {
        const p = particles[i]!
        if (!p.alive) {
          sizes[i] = 0
          continue
        }
        if (p.fresh) {
          // 本帧刚生成：子帧推进已在发射时做过
          p.fresh = false
        } else {
          p.age += dt
          p.pos.addScaledVector(p.vel, dt)
          // 阻力（原站曲线末端收束）+ 轻微下沉
          p.vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt))
          p.vel.y -= 0.2 * dt
        }
        const t = p.age / p.life
        if (t >= 1) {
          p.alive = false
          sizes[i] = 0
          continue
        }
        if (p.pos.y < 0.02) p.pos.y = 0.02
        positions[i * 3] = p.pos.x
        positions[i * 3 + 1] = p.pos.y
        positions[i * 3 + 2] = p.pos.z
        // 原站 size 曲线 100 → 600 → 1100 → 500 → 0；Toon 硬边，所以淡出靠缩小而不是透明度
        const curve =
          t < 0.15
            ? THREE.MathUtils.lerp(0.09, 0.55, t / 0.15)
            : t < 0.3
              ? THREE.MathUtils.lerp(0.55, 1, (t - 0.15) / 0.15)
              : t < 0.9
                ? THREE.MathUtils.lerp(1, 0.45, (t - 0.3) / 0.6)
                : THREE.MathUtils.lerp(0.45, 0, (t - 0.9) / 0.1)
        sizes[i] = curve * p.size
      }

      geometry.attributes.position!.needsUpdate = true
      geometry.attributes.aSize!.needsUpdate = true
    },
    setColor(color) {
      ;(material.uniforms.uColor!.value as THREE.Color).copy(color)
      // 暗面：同色相压暗、偏暖（线性空间乘），不要发灰
      ;(material.uniforms.uShade!.value as THREE.Color).copy(color).multiply(SHADE_TINT)
    },
    setViewportHeight(px) {
      viewportHeight.value = px
    }
  }
}
