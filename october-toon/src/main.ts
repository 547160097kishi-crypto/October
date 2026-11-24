/**
 * 十月 · Toon Web
 *
 * 渲染管线与 motorbike（mola-zone 原站逆向）一致：
 *   1. 所有 mesh 换成 MeshRampNoiseToonMaterial：three-tone 梯度贴图 → 灰度 → direct/indirect 二色混合
 *   2. 自定义噪波指数雾（FogBundle）
 *   3. MoebiusEffect：identity pass + Sobel 描边合成
 * 场景内容、相机路径、车的动画全部来自 十月-test.glb 自带的 25.7s 动画。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  createToonMaterial,
  createGradientMap,
  setToonPaletteMix,
  setFogIntensity,
  setFogColors,
  tickFog,
  type ToonPalette
} from './toonMaterial'
import { MoebiusOutline } from './outlinePass'
import { paletteForPath } from './palettes'

const MODEL_URL = `${import.meta.env.BASE_URL}models/october.glb`

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
const params = {
  dusk: 0, // 0 = 白天, 1 = 暮色（色板插值，与 motorbike Day-Night 轨道同公式）
  outline: true,
  thickness: 1.0,
  fog: 1.0, // 雾强度倍数
  speed: 1
}

/** 天空 / 雾色：白天与暮色两套，与 Toon 色板一起插值 */
const SKY = {
  // horizon 与 fogFar 相同：远处地面完全雾化后与天际线无缝衔接
  day: { top: new THREE.Color('#86a9cf'), horizon: new THREE.Color('#efd3b4'), fogNear: new THREE.Color('#f2dcc0'), fogFar: new THREE.Color('#efd3b4') },
  dusk: { top: new THREE.Color('#2c2f5e'), horizon: new THREE.Color('#e9876a'), fogNear: new THREE.Color('#d97c5e'), fogFar: new THREE.Color('#e9876a') }
}
/** 基础雾密度（exp2）：场景跨度 ~200，最远处约 55% 雾化 */
const BASE_FOG_DENSITY = 0.0042

// ---------------------------------------------------------------------------
// 渲染器（motorbike RENDERER_CONFIG）
// ---------------------------------------------------------------------------
const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({
  canvas,
  powerPreference: 'high-performance',
  antialias: false,
  stencil: false,
  alpha: false,
  depth: true
})
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
renderer.setSize(window.innerWidth, window.innerHeight, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.shadowMap.autoUpdate = false // outline.render 里每帧手动 needsUpdate（与原站一致）

const scene = new THREE.Scene()
scene.background = SKY.day.horizon.clone()

const outline = new MoebiusOutline(renderer)
const syncOutlineSize = () => {
  const s = renderer.getDrawingBufferSize(new THREE.Vector2())
  outline.setSize(s.x, s.y)
}
syncOutlineSize()
outline.setThickness(params.thickness)

// ---------------------------------------------------------------------------
// 天空：内翻球 + 竖向渐变（motorbike 的 skybox-day 渐变条思路），放在 layer 1 → 不参与描边
// ---------------------------------------------------------------------------
const skyUniforms = {
  uTop: { value: SKY.day.top.clone() },
  uHorizon: { value: SKY.day.horizon.clone() },
  uSunDir: { value: new THREE.Vector3() },
  uSunColor: { value: new THREE.Color('#fff1d6') }
}
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        // 地平线以下 = 雾色；以上平滑过渡到天顶
        float t = smoothstep(0.0, 0.6, h);
        vec3 col = mix(uHorizon, uTop, pow(t, 0.8));
        // 硬边太阳盘
        float s = dot(d, normalize(uSunDir));
        col = mix(col, uSunColor, step(0.9985, s));
        col = mix(col, mix(col, uSunColor, 0.35), step(0.995, s) * (1.0 - step(0.9985, s)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`
  })
)
sky.frustumCulled = false
sky.renderOrder = -1000
sky.layers.set(1)
scene.add(sky)

// ---------------------------------------------------------------------------
// 太阳（motorbike lightsConfig：白光强度 3；Toon shader 里 3 × 1/π ≈ 0.955 → 受光面 ≈ directColor）
// ---------------------------------------------------------------------------
const SUN_DIR = new THREE.Vector3(-0.55, 0.75, 0.45).normalize()
const sun = new THREE.DirectionalLight(0xffffff, 3)
sun.castShadow = true
const IS_MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 640
sun.shadow.mapSize.setScalar(IS_MOBILE ? 2048 : 4096)
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.04
const SHADOW_HALF = 45
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 400 })
scene.add(sun, sun.target)
skyUniforms.uSunDir.value.copy(SUN_DIR)

// ---------------------------------------------------------------------------
// 相机
// ---------------------------------------------------------------------------
const freeCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000)
freeCamera.layers.enable(1)
const controls = new OrbitControls(freeCamera, canvas)
controls.enableDamping = true
controls.enabled = false

let animCamera: THREE.PerspectiveCamera | null = null
/** C4D 导出的 yfov/aspectRatio 是按「水平 FOV + 宽幅」写的，这里还原成水平 FOV 再按窗口算竖直 FOV */
let animHFov = THREE.MathUtils.degToRad(70)
let useAnimCamera = true

function activeCamera(): THREE.PerspectiveCamera {
  return useAnimCamera && animCamera ? animCamera : freeCamera
}

function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  syncOutlineSize()
  const aspect = w / h
  freeCamera.aspect = aspect
  freeCamera.updateProjectionMatrix()
  if (animCamera) {
    // 宽屏：保持 16:9 时的竖直 FOV；竖屏：保持水平 FOV（不裁掉两侧），上限 80°
    const v169 = 2 * Math.atan(Math.tan(animHFov / 2) / (16 / 9))
    const vKeepH = 2 * Math.atan(Math.tan(animHFov / 2) / aspect)
    const v = aspect >= 16 / 9 ? v169 : Math.min(vKeepH, THREE.MathUtils.degToRad(80))
    animCamera.fov = THREE.MathUtils.radToDeg(v)
    animCamera.aspect = aspect
    animCamera.updateProjectionMatrix()
  }
}
window.addEventListener('resize', resize)

// ---------------------------------------------------------------------------
// 加载 + 材质替换
// ---------------------------------------------------------------------------
const gradientMap = createGradientMap()
const toonMaterials: { mat: THREE.Material; palette: ToonPalette }[] = []
const materialCache = new Map<string, THREE.Material>()
let mixer: THREE.AnimationMixer | null = null
let action: THREE.AnimationAction | null = null
let clipDuration = 0
let playing = true

function materialFor(key: string, palette: ToonPalette, doubleSide: boolean) {
  const cacheKey = `${key}|${doubleSide ? 2 : 1}`
  let mat = materialCache.get(cacheKey)
  if (!mat) {
    mat = createToonMaterial({ palette, gradientMap, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide })
    mat.name = cacheKey
    materialCache.set(cacheKey, mat)
    toonMaterials.push({ mat, palette })
  }
  return mat
}

function nodePath(o: THREE.Object3D, root: THREE.Object3D) {
  const parts: string[] = []
  let p: THREE.Object3D | null = o
  while (p && p !== root) {
    parts.push(p.name)
    p = p.parent
  }
  return parts.reverse().join('/')
}

function applyToon(root: THREE.Object3D) {
  const stats = new Map<string, number>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const path = nodePath(mesh, root)
    const { key, palette } = paletteForPath(path)
    stats.set(key, (stats.get(key) ?? 0) + 1)
    // 薄片（叶片、画框、水面…）双面，其余单面
    const geom = mesh.geometry
    geom.computeBoundingBox()
    const size = geom.boundingBox!.getSize(new THREE.Vector3())
    const thin = Math.min(size.x, size.y, size.z) < 0.02 * Math.max(size.x, size.y, size.z)
    const old = mesh.material
    mesh.material = materialFor(key, palette, thin || /叶|leaf|Plane|新框|内容/i.test(path))
    ;(Array.isArray(old) ? old : [old]).forEach((m) => m.dispose())
    const isGround = key === 'ground' || key === 'groundAlt' || key === 'water'
    mesh.castShadow = !isGround
    mesh.receiveShadow = true
    mesh.userData.toonKey = key
    mesh.userData.path = path
  })
  console.info('[october] palette usage', Object.fromEntries(stats))
}

/**
 * 模型自带地面是一块 ~206×188 的不规则圆盘，镜头会拍到圆盘外的虚空与地块侧面。
 * 这里提取地面网格的外边界环（只被一个三角形使用的边），沿边界向外做两圈过渡环
 * （河道在边界处的下切 -3.5 在 12 个单位内收回到 0），再用 earcut 铺到 ±2500 的大方形，
 * 用同一个地面材质；远处交给雾化融进天际线。
 */
function groundBoundaryLoop(mesh: THREE.Mesh): THREE.Vector3[] {
  mesh.updateWorldMatrix(true, false)
  const geo = mesh.geometry
  const pos = geo.getAttribute('position')
  const index = geo.getIndex()
  if (!index) return []
  // 按世界坐标焊接（量化/重建后的同位点可能是不同顶点）
  const remap = new Int32Array(pos.count)
  const lookup = new Map<string, number>()
  const pts: THREE.Vector3[] = []
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
    const k = `${Math.round(v.x * 100)},${Math.round(v.y * 100)},${Math.round(v.z * 100)}`
    let id = lookup.get(k)
    if (id === undefined) {
      id = pts.length
      lookup.set(k, id)
      pts.push(v.clone())
    }
    remap[i] = id
  }
  const edgeCount = new Map<string, number>()
  const idx = index.array
  for (let t = 0; t < idx.length; t += 3) {
    for (let j = 0; j < 3; j++) {
      const a = remap[idx[t + j]!]!
      const b = remap[idx[t + ((j + 1) % 3)]!]!
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1)
    }
  }
  const adj = new Map<number, number[]>()
  for (const [k, c] of edgeCount) {
    if (c !== 1) continue
    const [a, b] = k.split('_').map(Number) as [number, number]
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }
  const seen = new Set<number>()
  let best: number[] = []
  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    const loop = [start]
    seen.add(start)
    let prev = -1
    let cur = start
    for (;;) {
      const next = adj.get(cur)!.find((n) => n !== prev && !seen.has(n))
      if (next === undefined) break
      seen.add(next)
      loop.push(next)
      prev = cur
      cur = next
    }
    if (loop.length > best.length) best = loop
  }
  return best.map((i) => pts[i]!)
}

function addGroundExtension(root: THREE.Object3D) {
  const ground = root.getObjectByName('地面-地面') as THREE.Mesh | undefined
  if (!ground) return
  const ring0 = groundBoundaryLoop(ground)
  if (ring0.length < 8) return
  const c = ring0.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(ring0.length)
  const Y = -0.02
  const offsetRing = (ring: THREE.Vector3[], dist: number, yFn: (p: THREE.Vector3) => number) =>
    ring.map((p) => {
      const d = new THREE.Vector3(p.x - c.x, 0, p.z - c.z).normalize()
      const q = p.clone().addScaledVector(d, dist)
      q.y = yFn(p)
      return q
    })
  // ring0 = 原边界（含真实高度）；ring1 收一半高度；ring2 回到地平面
  const ring1 = offsetRing(ring0, 4, (p) => (p.y < 0 ? p.y * 0.5 : Math.min(p.y, 0.6)))
  const ring2 = offsetRing(ring0, 12, () => Y)

  const positions: number[] = []
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3) => {
    // 保证法线朝上（不依赖边界环的绕向）
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a))
    if (n.y < 0) [b, d] = [d, b]
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z)
  }
  const strip = (r0: THREE.Vector3[], r1: THREE.Vector3[]) => {
    for (let i = 0; i < r0.length; i++) {
      const j = (i + 1) % r0.length
      pushTri(r0[i]!, r0[j]!, r1[i]!)
      pushTri(r0[j]!, r1[j]!, r1[i]!)
    }
  }
  strip(ring0, ring1)
  strip(ring1, ring2)

  // ring2 → 外方形：earcut（ShapeUtils）三角化「方形 - 圆环」
  const R = 2500
  const outer = [new THREE.Vector2(-R, -R), new THREE.Vector2(R, -R), new THREE.Vector2(R, R), new THREE.Vector2(-R, R)]
  const hole = ring2.map((p) => new THREE.Vector2(p.x, p.z))
  if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse()
  if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse()
  const faces = THREE.ShapeUtils.triangulateShape(outer, [hole])
  const all = [...outer, ...hole]
  const to3 = (p: THREE.Vector2) => new THREE.Vector3(p.x, Y, p.y)
  for (const [a, b, d] of faces) pushTri(to3(all[a]!), to3(all[b]!), to3(all[d]!))

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.computeVertexNormals()
  const ext = new THREE.Mesh(geom, ground.material as THREE.Material)
  ext.name = '地面-延伸'
  ext.receiveShadow = true
  ext.userData.toonKey = 'ground'
  scene.add(ext)
}

const loadingEl = document.getElementById('loading')!
const loadingPct = document.getElementById('loading-pct')!

async function load() {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync(MODEL_URL, (e) => {
    const pct = e.total ? (e.loaded / e.total) * 100 : 0
    loadingPct.textContent = `${Math.floor(pct)}%`
  })
  loadingPct.textContent = '解析中…'
  const root = gltf.scene
  scene.add(root)
  applyToon(root)
  addGroundExtension(root)

  // 描边：地面 / 水面不打独立 identity（写常量），其余每个 mesh 一个 identity
  const flat = (m: THREE.Mesh) => ['ground', 'groundAlt', 'water'].includes(m.userData.toonKey)
  outline.register(root, (m) => !flat(m))
  outline.registerFlat(scene, flat)

  // 相机：glTF 里的 Octane Camera
  root.traverse((o) => {
    if ((o as THREE.PerspectiveCamera).isPerspectiveCamera && !animCamera) animCamera = o as THREE.PerspectiveCamera
  })
  if (animCamera) {
    const src = gltf.parser.json.cameras?.[0]?.perspective
    if (src?.yfov && src?.aspectRatio) {
      animHFov = 2 * Math.atan(Math.tan(src.yfov / 2) * src.aspectRatio)
    }
    animCamera.near = 0.05
    animCamera.far = 3000
    animCamera.layers.enable(1)
  }

  // 自由相机初始位置：看向场景中心
  const box = new THREE.Box3().setFromObject(root)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  freeCamera.position.copy(center).add(new THREE.Vector3(size.x * 0.35, size.y * 2 + 40, size.z * 0.45))
  controls.target.copy(center)
  controls.update()
  sky.scale.setScalar(1)

  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(root)
    action = mixer.clipAction(gltf.animations[0]!)
    action.play()
    clipDuration = gltf.animations[0]!.duration
  }
  timeline.max = String(clipDuration || 1)

  resize()
  applyDusk()
  applyFog()
  // 预编译，避免首帧卡顿
  try {
    renderer.compile(scene, activeCamera())
  } catch (err) {
    console.warn('[october] precompile failed', err)
  }
  loadingEl.classList.add('done')
  ;(window as any).__october.ready = true
}

// ---------------------------------------------------------------------------
// 暮色 / 雾
// ---------------------------------------------------------------------------
const _c1 = new THREE.Color()
const _c2 = new THREE.Color()
function applyDusk() {
  const m = params.dusk
  for (const { mat, palette } of toonMaterials) setToonPaletteMix(mat, palette, m)
  skyUniforms.uTop.value.lerpColors(SKY.day.top, SKY.dusk.top, m)
  skyUniforms.uHorizon.value.lerpColors(SKY.day.horizon, SKY.dusk.horizon, m)
  skyUniforms.uSunColor.value.lerpColors(new THREE.Color('#fff1d6'), new THREE.Color('#ffb070'), m)
  ;(scene.background as THREE.Color).copy(skyUniforms.uHorizon.value)
  setFogColors(_c1.lerpColors(SKY.day.fogNear, SKY.dusk.fogNear, m), _c2.lerpColors(SKY.day.fogFar, SKY.dusk.fogFar, m))
  // 暮色时太阳压低
  const dir = SUN_DIR.clone().lerp(new THREE.Vector3(-0.85, 0.28, 0.45), m).normalize()
  skyUniforms.uSunDir.value.copy(dir)
}
function applyFog() {
  setFogIntensity(BASE_FOG_DENSITY * params.fog)
}

// ---------------------------------------------------------------------------
// 循环
// ---------------------------------------------------------------------------
const clock = new THREE.Clock()
const _v = new THREE.Vector3()
const _fwd = new THREE.Vector3()
let currentTime = 0

function syncShadow(cam: THREE.Camera) {
  // 阴影相机跟随视点前方（motorbike 的 dynamicShadowLight 跟随 bike，这里跟随镜头焦点区域）
  cam.getWorldPosition(_v)
  cam.getWorldDirection(_fwd)
  _v.addScaledVector(_fwd, SHADOW_HALF * 0.8)
  const texel = (SHADOW_HALF * 2) / sun.shadow.mapSize.x
  _v.set(Math.round(_v.x / texel) * texel, _v.y, Math.round(_v.z / texel) * texel)
  const dir = skyUniforms.uSunDir.value as THREE.Vector3
  sun.target.position.copy(_v)
  sun.position.copy(_v).addScaledVector(dir, 200)
  sun.target.updateMatrixWorld()
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1)
  if (mixer && action) {
    if (playing) currentTime = (currentTime + dt * params.speed) % clipDuration
    action.time = currentTime
    mixer.update(0)
    if (!scrubbing) timeline.value = String(currentTime)
    timeLabel.textContent = `${currentTime.toFixed(1)}s / ${clipDuration.toFixed(1)}s`
  }
  if (!useAnimCamera) controls.update()
  const cam = activeCamera()
  cam.updateMatrixWorld()
  syncShadow(cam)
  tickFog(dt)
  outline.enabled = params.outline
  outline.render(scene, cam)
}
renderer.setAnimationLoop(() => {
  try {
    frame()
  } catch (err) {
    console.error(err)
    renderer.setAnimationLoop(null)
  }
})

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const timeline = $<HTMLInputElement>('timeline')
const timeLabel = $('time')
const playBtn = $<HTMLButtonElement>('play')
const camBtn = $<HTMLButtonElement>('cam')
let scrubbing = false

playBtn.onclick = () => {
  playing = !playing
  playBtn.textContent = playing ? '暂停' : '播放'
  playBtn.setAttribute('aria-pressed', String(!playing))
}
timeline.addEventListener('input', () => {
  scrubbing = true
  currentTime = Number(timeline.value)
})
timeline.addEventListener('change', () => (scrubbing = false))

camBtn.onclick = () => {
  useAnimCamera = !useAnimCamera
  if (!useAnimCamera && animCamera) {
    // 从当前镜头位置无缝切到自由相机
    animCamera.getWorldPosition(freeCamera.position)
    animCamera.getWorldDirection(_fwd)
    controls.target.copy(freeCamera.position).addScaledVector(_fwd, 20)
    freeCamera.fov = animCamera.fov
    freeCamera.updateProjectionMatrix()
  }
  controls.enabled = !useAnimCamera
  camBtn.textContent = useAnimCamera ? '镜头：动画' : '镜头：自由'
}

const bindRange = (id: string, fn: (v: number) => void) => {
  const el = $<HTMLInputElement>(id)
  el.addEventListener('input', () => fn(Number(el.value)))
  fn(Number(el.value))
}
bindRange('dusk', (v) => {
  params.dusk = v
  applyDusk()
})
bindRange('thickness', (v) => {
  params.thickness = v
  outline.setThickness(v)
})
bindRange('fog', (v) => {
  params.fog = v
  applyFog()
})
bindRange('speed', (v) => (params.speed = v))
$<HTMLInputElement>('outline').addEventListener('change', (e) => (params.outline = (e.target as HTMLInputElement).checked))

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
    e.preventDefault()
    playBtn.click()
  }
})

// 调试 / 截图入口
;(window as any).__october = {
  ready: false,
  params,
  scene,
  renderer,
  outline,
  setTime(t: number) {
    currentTime = t
    playing = false
    playBtn.textContent = '播放'
  },
  setFog(v: number) {
    params.fog = v
    applyFog()
  },
  setDusk(v: number) {
    params.dusk = v
    ;($<HTMLInputElement>('dusk')).value = String(v)
    applyDusk()
  },
  animCam() {
    if (!useAnimCamera) camBtn.click()
  },
  freeCam(pos: number[], target: number[]) {
    if (useAnimCamera) camBtn.click()
    freeCamera.position.fromArray(pos)
    controls.target.fromArray(target)
    controls.update()
  },
  info() {
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, materials: toonMaterials.length, duration: clipDuration }
  }
}

load().catch((err) => {
  console.error(err)
  loadingPct.textContent = `加载失败：${err?.message ?? err}`
})
