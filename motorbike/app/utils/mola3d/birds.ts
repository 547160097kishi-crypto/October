import * as THREE from 'three'

/**
 * 原站 initBirdsParticles（gpNsPhdA.js, ParticleBundle）的等价实现。
 *
 * 原站做法：
 *  - oiseau_v1.glb 的 geometry.rotateY(PI)，把 2 组 morph target 合并成
 *    shapeKeyPosition / shapeKeyNormal，再加 per-instance `seed`；
 *  - MeshToonMaterial({ side: DoubleSide, color: '#111111' }) 注入 vertex shader，
 *    用 cos(seed*3.14 + time)*0.5+0.5 在两个 morph 之间插值 → 翅膀扇动；
 *    time 每帧 += 0.06；
 *  - 20 只 InstancedMesh，沿两条 CatmullRomCurve3 螺旋轨迹盘旋
 *    （64 点、半径 40、高度 0~30、4 圈；第二条整体上移 10）；
 *    每帧 lookAt(飞行方向) + scale 0.2 写 instanceMatrix；
 *  - disableMoebiusEffect(b) → 不参与描边；
 *  - 显隐由 Orbital Sequence 的 `Zone Visibility / birds` 轨道控制
 *    （t=0 True，3.37 False，9.2 True）。
 *
 * 原站用第三方粒子发射器把 particle 映射到 instance，这里直接让 20 只鸟
 * 在曲线上按不同相位匀速前进，视觉等价且无需引入粒子引擎。
 */
export interface BirdFlock {
  mesh: THREE.InstancedMesh
  update: (dt: number) => void
  dispose: () => void
  set visible(v: boolean)
  get visible(): boolean
}

const COUNT = 20
/** 原站 Emitter lifetime=120（秒），即 120 秒走完整条曲线 */
const LIFETIME = 120
/** 原站 rate = 0.5/60*20 ≈ 10 只/秒，前 2 秒逐渐出齐 */
const SPAWN_RATE = 10
/** 原站 scale = 0.2 */
const BIRD_SCALE = 0.2
/** 原站 b.position.set(34, 15, -30) */
const FLOCK_ORIGIN = new THREE.Vector3(34, 15, -30)

const BIRD_COMMON = /* glsl */ `
#include <common>
uniform float time;
attribute vec3 shapeKeyPosition;
attribute vec3 shapeKeyNormal;
attribute float seed;
`

const BIRD_BEGINNORMAL = /* glsl */ `
vec3 objectNormal = vec3( mix(normal, normal + shapeKeyNormal, cos(seed * 3.14 + time) * 0.5 + 0.5) );
`

const BIRD_BEGIN = /* glsl */ `
vec3 transformed = vec3( mix(position, position + shapeKeyPosition, cos(seed * 3.14 + time) * 0.5 + 0.5) );
`

function buildCurves() {
  // 原站：k=40, O=30, N=64, V=4
  const points: THREE.Vector3[] = []
  const N = 64
  for (let i = 0; i < N; i++) {
    const radius = 40 + Math.cos((i / N) * Math.PI)
    const height = Math.sin((i / N) * Math.PI) * (30 / 2) + 30 / 2
    const angle = -(i / N) * Math.PI * 2 * 4
    points.push(new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius))
  }
  points.push(points[0]!.clone())
  const a = new THREE.CatmullRomCurve3(points)
  // 原站 F.reverse().map(p => { p.y += 10 })，用 slice 避免把 a 的点也反转
  const b = new THREE.CatmullRomCurve3(
    points.slice().reverse().map((p) => {
      const q = p.clone()
      q.y += 10
      return q
    })
  )
  return [a, b] as const
}

export function createBirdFlock(oiseauGltf: { scene: THREE.Object3D } | null): BirdFlock | null {
  if (!oiseauGltf) return null
  const source = (oiseauGltf.scene.children[0] as THREE.Mesh | undefined)?.geometry
  if (!source) return null

  const geometry = source.clone()
  geometry.rotateY(Math.PI)

  // morph target(2 组) → shapeKey 属性，逐分量取「非零优先」
  const mp = geometry.morphAttributes.position as THREE.BufferAttribute[] | undefined
  const mn = geometry.morphAttributes.normal as THREE.BufferAttribute[] | undefined
  if (!mp?.length || !mn?.length) {
    console.warn('[mola3d] oiseau 缺少 morph target，鸟群将不做扇翅动画')
    return null
  }
  const pos = new Float32Array(mp[0]!.count * 3).fill(0)
  const nrm = new Float32Array(mn[0]!.count * 3).fill(0)
  for (let i = 0; i < pos.length; i++) {
    pos[i] = mp[0]!.array[i] !== 0 ? (mp[0]!.array[i] as number) : ((mp[1]?.array[i] as number) ?? 0)
    nrm[i] = mn[0]!.array[i] !== 0 ? (mn[0]!.array[i] as number) : ((mn[1]?.array[i] as number) ?? 0)
  }
  geometry.setAttribute('shapeKeyPosition', new THREE.BufferAttribute(pos, 3, false))
  geometry.setAttribute('shapeKeyNormal', new THREE.BufferAttribute(nrm, 3, false))
  const seedAttr = new THREE.InstancedBufferAttribute(new Float32Array(COUNT), 1, true)
  geometry.setAttribute('seed', seedAttr)
  geometry.morphAttributes = {}

  const mat = new THREE.MeshToonMaterial({
    side: THREE.DoubleSide,
    color: new THREE.Color('#111111')
  })
  let shaderRef: { uniforms: Record<string, THREE.IUniform> } | null = null
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.time = { value: 0 }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', BIRD_COMMON)
      .replace('#include <beginnormal_vertex>', BIRD_BEGINNORMAL)
      .replace('#include <begin_vertex>', BIRD_BEGIN)
    shaderRef = shader
  }
  mat.customProgramCacheKey = () => 'mola-birds-toon'

  const mesh = new THREE.InstancedMesh(geometry, mat, COUNT)
  mesh.frustumCulled = false
  mesh.name = 'birds'
  mesh.position.copy(FLOCK_ORIGIN)
  // 原站 disableMoebiusEffect：只留 layer 1，identity pass 会被剔除
  mesh.layers.disableAll()
  mesh.layers.enable(1)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.count = 0

  const [curveA, curveB] = buildCurves()
  const phases = new Float32Array(COUNT)
  const seeds = new Float32Array(COUNT)
  for (let i = 0; i < COUNT; i++) {
    phases[i] = (i / COUNT + Math.random() * 0.02) % 1
    const s = Math.random() * 10
    seeds[i] = s
    seedAttr.array[i] = s
  }
  seedAttr.needsUpdate = true

  const orient = new THREE.Object3D()
  orient.up.set(0, 1, 0)
  const matrix = new THREE.Matrix4()
  const scale = new THREE.Vector3(BIRD_SCALE, BIRD_SCALE, BIRD_SCALE)
  const tmpDir = new THREE.Vector3()
  let elapsed = 0
  let wingTime = 0

  function update(dt: number) {
    elapsed += dt
    // 原站每帧 time += 0.06（60fps → 3.6/s），这里按 dt 保持帧率无关
    wingTime += dt * 3.6
    if (shaderRef?.uniforms.time) shaderRef.uniforms.time.value = wingTime

    const shown = Math.min(COUNT, Math.floor(elapsed * SPAWN_RATE))
    mesh.count = shown
    const progress = elapsed / LIFETIME
    for (let i = 0; i < shown; i++) {
      const t = (phases[i]! + progress) % 1
      const curve = i % 2 === 0 ? curveA : curveB
      const p = curve.getPointAt(t)
      tmpDir.copy(curve.getTangentAt(t)).normalize()
      // 原站 H.position=(0,0,0); H.lookAt(direction)
      orient.lookAt(tmpDir)
      matrix.compose(p, orient.quaternion, scale)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  return {
    mesh,
    update,
    dispose: () => {
      geometry.dispose()
      mat.dispose()
    },
    set visible(v: boolean) {
      mesh.visible = v
    },
    get visible() {
      return mesh.visible
    }
  }
}
