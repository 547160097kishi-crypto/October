/**
 * Mola Zone 3D 场景管理器
 *
 * 所有渲染 / 相机 / 灯光 / 加载管线参数均逆向自原站 gpNsPhdA.js 与 state_v9.json：
 * - RENDERER_CONFIG / SCENE_BACKGROUND_COLOR：原站常量
 * - lightsConfig：原站 { intensity: 3, direction: (-0.4, 1, -0.5) }，
 *   太阳颜色取 state_v9.json World/sun = (0.867, 0.804, 0.545)
 * - cameraViews：原站 cameraViews 数组；HomeDesktop 叠加 state_v9.json 的
 *   Theatre staticOverrides（position -15.5/1.5/0, fov 73, lookAt 0.2/1.9/-0.5）
 * - bike / oiseau 直接 add 到场景（原站 bikeState.group 无变换）
 * - 解码器：DRACOLoader 1.5.7（gstatic 镜像到本地）+ KTX2 basis transcoder
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import {
  createToonMaterial,
  createGroundToonMaterial,
  createGradientMap,
  setToonPaletteMix,
  setFogIntensity,
  tickFog,
  DEFAULT_PALETTE,
  type ToonPalette
} from './toonMaterial'
import { MoebiusOutline } from './outlinePass'
import { createBirdFlock, type BirdFlock } from './birds'
import { createDustTrail, type DustTrail } from './dust'
import { MolaGameMode, type GameHudState, type GameHost } from './gameMode'
import { createBikeAnimator, type BikeAnimatorHandle } from './bikeAnimation'
import toonColors from './toon-colors.json'
import {
  loadOrbitalTheatre,
  phiToSequencePosition,
  CAMERA_VIEW_PROPS,
  ZONE_KEYS,
  types
} from './theatre'

export const ASSET_URLS = {
  scene: '/assets/models/3d/Scene/scene_v6.16.4.glb',
  bike: '/assets/models/3d/Library/bike/bike_v9.7.glb',
  oiseau: '/assets/models/3d/Library/oiseau_v1.glb',
  skyboxDay: '/assets/textures/3d/Library/ground/skybox-day.jpg',
  skyboxNight: '/assets/textures/3d/Library/ground/skybox-night.png',
  gradientMap: '/assets/textures/3d/texture/three-tone.png',
  groundMap: '/assets/textures/3d/Library/ground/map_ground_v2.1.webp',
  groundSand: '/assets/textures/3d/Library/ground/G_sand.webp',
  groundMarble: '/assets/textures/3d/Library/ground/B_marble.webp',
  groundRock: '/assets/textures/3d/Library/ground/R_rock.webp',
  groundBlend: '/assets/textures/3d/Library/ground/blendmap.webp',
  dracoDecoderPath: '/assets/decoders/www.gstatic.com/draco/versioned/decoders/1.5.7/',
  ktx2TranscoderPath: '/assets/decoders/3d/basis/'
} as const

/** World / bike 的 Toon 配色表（由 analysis/toon/parse_toon_config.py 从原站 JS + state_v9.json 生成） */
const TOON_COLORS = toonColors as {
  world: Record<string, ToonPalette>
  bike: Record<string, ToonPalette>
}

/**
 * 原站 worldConfig / bikeConfig 关键值（逆向自 gpNsPhdA.js）：
 * 摩托沿半径 120 的圆轨道行驶；首页（cinematic 模式）phi 停在 2π
 * （→ sequence position 0），用户滚动 / 拖拽推进 phi。
 */
const WORLD_CONFIG = { RADIUS: 120, INITIAL_PHI: 5.92023817104828 }

/**
 * 宫殿柱廊的专属回退配色。
 *
 * scene_v6.16.4.glb 里 `constraint_allé_pilonne0~3` 是 EXT_mesh_gpu_instancing
 * 的柱身 / 柱础 / 雕像实例，state_v9.json 的 World 配色表**没有这四个键**，
 * 因此它们会回落到全局默认 indirectColor `#605d87`（蓝紫）。
 * 柱身贴图 `pillar_1024px` 是白底黑线描的 atlas，UV 未覆盖到的区域会露出
 * Toon 底色 —— 表现为柱基上一整块规整的淡紫色矩形（原站同位置也有，
 * 只是更淡）。Toon 公式是 `贴图 × (direct·灰度 + indirect·(1-灰度))`，
 * 所以背光面吃满这个紫色。
 *
 * 这里只把**间接色**换成暖灰棕，direct 完全保持默认：亮面观感不变，
 * 背光面与 atlas 空白区的紫色被中和掉。可用 ?pillarPalette=default 关掉。
 */
const PILLAR_FALLBACK_PALETTE: ToonPalette = {
  d: [0.854, 0.718, 0.612],
  i: [0.6, 0.54, 0.46],
  l: 1,
  nd: [0.854, 0.718, 0.612],
  ni: [0.6, 0.54, 0.46],
  nl: 1
}

/**
 * 原站 bikeConfig（gpNsPhdA.js）—— 首页滚动 / 拖拽驱动摩托的运动模型：
 *   wheel:  speed += -deltaY * SCROLL_SENSITIVITY, clamp ±MAX_SPEED
 *   drag:   speed += dx * DRAG_MOVEMENT_FACTOR,     clamp ±MAX_SPEED
 *   每帧 handleMovement(speed, DAMPING):
 *     |speed| > MIN_SPEED ? speed *= DAMPING; targetPhi += speed*dt*40;
 *                          phi = lerp(phi, targetPhi, LERP)
 *     松手减速到 MIN_SPEED 以下 → stopBike
 */
const BIKE_CONFIG = {
  SCROLL_SENSITIVITY: 5e-5,
  MAX_SPEED: 0.01,
  MIN_SPEED: 5e-4,
  DAMPING: 0.95,
  DRAG_MOVEMENT_FACTOR: 5e-7,
  radiusWheel: 0.323377,
  noSpeedWobble: 0.0012,
  speedWoobleFactor: 0.1,
  LERP: 0.1
}

/**
 * 首页机位 = 原站首页「打开后停留的那一帧」。
 * 取 state_v9.json → `Orbital Sequence / sequence / tracksByObject /
 * Camera / Views / HomeDesktop` 各属性第一个关键帧（t = 0.5），
 * 即 sequence 未播放时相机所处的初始状态，与实际打开 mola-zone.com/en
 * 看到的画面（摩托居中偏左、拱门在左、地平线约 47% 高度）一致。
 *
 * position (-1.102, 0.6, 1.8)｜lookAt (0.1, 0.4, 0.2)｜fov 91｜far 200
 * 注意 fov 是 91（超广角），不是代码默认的 55 —— 广角是它能在一台车
 * 的距离内塞进整片拱门与岩壁的原因。
 */
const CAMERA_STATE = {
  offset: new THREE.Vector3(-1.102, 0.6, 1.8),
  lookAt: new THREE.Vector3(0.1, 0.4, 0.2),
  fov: 91,
  far: 200
}
/** 旧版猜的近景机位，保留用于 ?cam=code 对比 */
const CAMERA_CODE = {
  offset: new THREE.Vector3(-1.5, 0.5, 3),
  lookAt: new THREE.Vector3(0, 0.7, 0),
  fov: 55,
  far: 200
}

/** 原站 SCENE_BACKGROUND_COLOR = 197379 = 0x030303 */
const SCENE_BACKGROUND_COLOR = 0x030303

/** 原站 RENDERER_CONFIG */
const RENDERER_OPTIONS: THREE.WebGLRendererParameters = {
  powerPreference: 'high-performance',
  antialias: false,
  stencil: false,
  alpha: false,
  depth: true
}

/** 原站 lightsConfig：白色平行光、强度 3。
 *  强度 3 是给 Toon shader 用的：gradient(1.0) × 3 × BRDF_Lambert(1/π) ≈ 0.955，
 *  也就是「受光面 ≈ directColor，背光面 ≈ indirectColor」。
 */
const SUN_CONFIG = {
  intensity: 3,
  color: 0xffffff,
  direction: new THREE.Vector3(-0.4, 1, -0.5).normalize()
}

/** 原站 cameraViews（代码默认值） */
export interface CameraView {
  name: string
  position: THREE.Vector3
  lookAt: THREE.Vector3
  fov: number
  far: number
}

const CAMERA_VIEWS: CameraView[] = [
  /**
   * HomeDesktop：与原站首页打开后停留的帧一致（HomeDesktop 轨道 t=0.5 关键帧）。
   */
  { name: 'HomeDesktop', position: CAMERA_STATE.offset, lookAt: CAMERA_STATE.lookAt, fov: CAMERA_STATE.fov, far: CAMERA_STATE.far },
  // 其余视图保留原站代码默认
  { name: 'HomePhone', position: new THREE.Vector3(-1.2, 0.3, 3.1), lookAt: new THREE.Vector3(0.1, 0.8, 0), fov: 63, far: 150 },
  { name: 'GameDesktop', position: new THREE.Vector3(-2.6, 1.8, -3.1), lookAt: new THREE.Vector3(2, 1, 2.4), fov: 55, far: 150 },
  { name: 'GamePhone', position: new THREE.Vector3(-1.5, 1.8, -4.8), lookAt: new THREE.Vector3(5.6, -2.3, 17.3), fov: 63, far: 150 }
]

export type LoadPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface MolaSceneOptions {
  onProgress?: (percent: number) => void
  onError?: (error: unknown, context: string) => void
}

/** 按字节进度 fetch（GLB 大文件进度条数据源，等价原站 loader:load 事件） */
async function fetchBufferWithProgress(
  url: string,
  weight: number,
  onWeighted: (deltaWeighted: number) => void
): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = await res.arrayBuffer()
  onWeighted(weight)
  return buf
}

/**
 * 兼容修复：scene_v6.16.4.glb 中 `tree_chain_02_instance_forest` /
 * `tree_chain_instance_forest` 是带 morph targets 的 EXT_mesh_gpu_instancing 实例，
 * 但 GLTFLoader 创建 InstancedMesh 时不会初始化 morphTargetInfluences，导致 three
 * 渲染时读 `objectInfluences.length` 崩溃。
 * 这里仅补齐缺失的运行时数组（全 0 = 基础形态），不触碰几何与材质数据。
 */
function ensureMorphInfluences(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const ma = mesh.geometry.morphAttributes ?? {}
    const count = ma.position?.length ?? ma.normal?.length ?? ma.color?.length ?? 0
    if (count > 0 && mesh.morphTargetInfluences === undefined) {
      mesh.morphTargetInfluences = new Array(count).fill(0)
      mesh.morphTargetDictionary = {}
    }
  })
}

export class MolaSceneManager {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

  private raf = 0
  private resizeObserver: ResizeObserver | null = null
  private disposed = false
  private dracoLoader: DRACOLoader | null = null
  private ktx2Loader: KTX2Loader | null = null
  private gltfLoader: GLTFLoader | null = null

  /** 机位预设：state = 原站 HomeDesktop（默认），code = cameraViews 代码默认近景 */
  cameraPreset: 'state' | 'code' = 'state'

  /** 调试：绕 bike 的 Y 轴再旋转几度（用于对齐原站首页构图的方位角） */
  cameraYawDeg = 0

  /** 柱廊间接光去紫（默认开）；?pillarPalette=default 可还原原站默认紫色 */
  pillarWarm = true

  // ===== 第六阶段：PLAY 进入的游戏模式（原站 MainBundle）=====
  /** 游戏运行时；构造完成后由渲染循环驱动 */
  game: MolaGameMode | null = null
  /** 游戏 HUD 状态回调（由 MolaScene3D.client.vue 接到页面） */
  onGameState?: (state: GameHudState) => void
  /** Zone Visibility - Game theatre 对象（游戏模式专用的区域显隐） */
  zoneGameObj: any = null

  // ===== 第五阶段：Orbital Sequence 动画（原站 SequenceBundle + BikeBundle）=====
  /** Theatre 工程（Orbital Sequence sheet） */
  private theatre: Awaited<ReturnType<typeof loadOrbitalTheatre>> | null = null
  /** Camera / Views / HomeDesktop（或 HomePhone） theatre 对象 */
  private camViewObj: any = null
  /** Zone Visibility theatre 对象 */
  private zoneObj: any = null
  /** Day - Night theatre 对象（mix 0=白天 1=夜晚） */
  private dayNightObj: any = null
  /** 所有 Toon 材质 + 各自色板（日夜混合时需要整体重算 uniform） */
  private toonMaterials: { mat: THREE.Material; palette: ToonPalette }[] = []
  /** 天空材质（双贴图 + uMix） */
  private skyMaterial: THREE.ShaderMaterial | null = null
  /** Door / DoorEnd 轨道对象与场景节点（原站 door_left / door_right 旋转，*_end 平移） */
  private doorObj: any = null
  private doorEndObj: any = null
  private doorLeft: THREE.Object3D | null = null
  private doorRight: THREE.Object3D | null = null
  private doorLeftEnd: THREE.Object3D | null = null
  private doorRightEnd: THREE.Object3D | null = null
  /** Fog 轨道对象（intensity / thichness，原站注意拼写就是 thichness） */
  private fogObj: any = null
  /** 后轮扬尘（原站 initBikeParticles）+ 对应 Dust 轨道 */
  private dust: DustTrail | null = null
  dustObj: any = null
  /** GLB 中按名索引的 zone 组（zone_0..3 / palace_inner / shop ...） */
  private zoneGroups = new Map<string, THREE.Object3D>()
  /** bikeState：phi 为轨道角（rad），首页停在 2π → sequence position 0 */
  phi = Math.PI * 2
  private targetPhi = Math.PI * 2
  private bikeSpeed = 0
  private wasMoving = false
  private isDragging = false
  private dragLastX = 0
  private dragStartX = 0
  /** bike 部件引用（车轮 / root，名称取自 bike_v9.7.glb） */
  private frontWheel: THREE.Object3D | null = null
  private rearWheel: THREE.Object3D | null = null
  private bikeRoot: THREE.Object3D | null = null
  private rootRotationX = 0
  /** 输入监听清理 */
  private inputCleanup: (() => void) | null = null
  /** 鼠标视差（原站 cameraConfig.mousePhi / mouseTheta，球面角微调 + LERP） */
  private parallaxX = 0
  private parallaxY = 0
  private targetParallaxX = 0
  private targetParallaxY = 0
  /** 入场推镜：0 = 起始（远），1 = 完成 */
  private introT = 1
  private introSpeed = 1
  private introActive = false

  /** 描边后处理（原站 MoebiusEffect + MoebiusSelectMaterial 的等价实现） */
  readonly outline: MoebiusOutline
  /** Toon 渐变贴图（three-tone.png，3×1） */
  private gradientMap: THREE.Texture | null = null

  /** 场景内关键对象（加载完成后可用） */
  bike: THREE.Group | null = null
  sceneModel: THREE.Group | null = null
  oiseau: THREE.Object3D | null = null
  /** 原站 initBirdsParticles：20 只鸟（螺旋轨迹 + 扇翅 morph） */
  private birdFlock: BirdFlock | null = null
  /** 原站 initBikeAnimation：人物姿势 / 头发 / 眼睛 morph */
  private bikeAnimator: BikeAnimatorHandle | null = null
  /** 首次滚动标记（原站 startAnimOnFirstInteraction 的 isFirst） */
  private isFirstInteraction = true

  constructor(canvas: HTMLCanvasElement, private options: MolaSceneOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, ...RENDERER_OPTIONS })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    // 原站：shadowMap.autoUpdate = false，每帧手动 needsUpdate（见 outline.render）
    this.renderer.shadowMap.autoUpdate = false
    // three r187 已移除 PCFSoftShadowMap，改用 PCFShadowMap
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(SCENE_BACKGROUND_COLOR)

    this.camera = new THREE.PerspectiveCamera(73, window.innerWidth / window.innerHeight, 0.1, 127.6)

    this.outline = new MoebiusOutline(this.renderer)
    this.outline.setSize(
      Math.floor(this.renderer.domElement.width),
      Math.floor(this.renderer.domElement.height)
    )

    this.initLights()
    this.initLoaders()
    this.initResize(canvas)
    this.initContextRecovery(canvas)
  }

  /** WebGL 上下文丢失 / 恢复处理 */
  private initContextRecovery(canvas: HTMLCanvasElement) {
    this.onContextLost = (e: Event) => {
      e.preventDefault()
      this.contextLost = true
      console.warn('[mola3d] WebGL context lost — pausing render loop')
      this.stop()
    }
    this.onContextRestored = () => {
      console.warn('[mola3d] WebGL context restored')
      this.contextLost = false
      this.renderer.setSize(window.innerWidth, window.innerHeight, false)
      this.start()
    }
    canvas.addEventListener('webglcontextlost', this.onContextLost, false)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false)
  }
  private onContextLost: (e: Event) => void = () => {}
  private onContextRestored: () => void = () => {}
  private contextLost = false
  private renderErrorLogged = false

  /** 灯光：原站只有一盏白色平行光（intensity 3），
   *  阴影相机仅覆盖摩托周围 4×4 单位（±2），近 0.1 / 远 150、1024 贴图、bias -1e-4。
   *  原站没有环境光/半球光——Toon shader 里 indirect 项被 BRDF_Lambert(0) 清零，
   *  受光与否完全由 direct 的灰度决定。
   */
  private sunLight: THREE.DirectionalLight | null = null

  private initLights() {
    const sun = new THREE.DirectionalLight(SUN_CONFIG.color, SUN_CONFIG.intensity)
    sun.position.copy(SUN_CONFIG.direction).multiplyScalar(100)
    sun.name = 'sun'
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.near = 0.1
    sun.shadow.camera.far = 150
    sun.shadow.camera.left = -2
    sun.shadow.camera.right = 2
    sun.shadow.camera.top = 2
    sun.shadow.camera.bottom = -2
    sun.shadow.camera.updateProjectionMatrix()
    sun.shadow.bias = -0.0001
    this.scene.add(sun, sun.target)
    this.sunLight = sun
  }

  /** 阴影光源跟随摩托（原站 lightsState.dynamicShadowLight） */
  private syncShadowLight() {
    if (!this.sunLight || !this.bike) return
    const bp = this.bike.position
    this.sunLight.target.position.copy(bp)
    this.sunLight.position.copy(bp).addScaledVector(SUN_CONFIG.direction, 100)
    this.sunLight.target.updateMatrixWorld()
  }

  private initLoaders() {
    this.dracoLoader = new DRACOLoader()
    this.dracoLoader.setDecoderPath(ASSET_URLS.dracoDecoderPath)

    this.ktx2Loader = new KTX2Loader()
    this.ktx2Loader.setTranscoderPath(ASSET_URLS.ktx2TranscoderPath)
    this.ktx2Loader.detectSupport(this.renderer)

    this.gltfLoader = new GLTFLoader()
    this.gltfLoader.setDRACOLoader(this.dracoLoader)
    this.gltfLoader.setKTX2Loader(this.ktx2Loader)
  }

  private initResize(canvas: HTMLCanvasElement) {
    const apply = () => {
      if (this.disposed) return
      const w = window.innerWidth
      const h = window.innerHeight
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.outline.setSize(
        Math.floor(this.renderer.domElement.width),
        Math.floor(this.renderer.domElement.height)
      )
    }
    this.resizeObserver = new ResizeObserver(apply)
    this.resizeObserver.observe(canvas)
    window.addEventListener('resize', apply)
    this.cleanupResize = () => window.removeEventListener('resize', apply)
  }
  private cleanupResize: () => void = () => {}

  /**
   * 加载三个 GLB（GLTFLoader.parse 路径，字节级进度）。
   * 权重按文件大小分配：scene 6.3MB / bike 3MB / oiseau 0.03MB。
   */
  async load(): Promise<void> {
    const weights = { scene: 6.32, bike: 3.02, oiseau: 0.08 }
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
    let done = 0
    const report = (delta: number) => {
      done = Math.min(totalWeight, done + delta)
      this.options.onProgress?.(Math.round((done / totalWeight) * 100))
    }

    const parse = async (url: string, weight: number): Promise<any /* GLTF */> => {
      const buf = await fetchBufferWithProgress(url, weight, report)
      return await new Promise((resolve, reject) => {
        this.gltfLoader!.parse(buf, url, resolve, (err) => reject(err instanceof Error ? err : new Error(String(err))))
      })
    }

    const [sceneGltf, bikeGltf, oiseauGltf] = await Promise.all([
      parse(ASSET_URLS.scene, weights.scene).catch((e) => {
        this.options.onError?.(e, 'scene_v6.16.4.glb')
        throw e
      }),
      parse(ASSET_URLS.bike, weights.bike).catch((e) => {
        this.options.onError?.(e, 'bike_v9.7.glb')
        throw e
      }),
      parse(ASSET_URLS.oiseau, weights.oiseau).catch((e) => {
        // 鸟是粒子源，加载失败不阻塞主场景
        this.options.onError?.(e, 'oiseau_v1.glb')
        return null
      })
    ])

    if (this.disposed) return

    // 场景（root 自带 scale 63 / 旋转，全部保留，不做任何修改）
    const sceneModel = sceneGltf.scene
    this.sceneModel = sceneModel
    sceneModel.name = 'mola-scene'
    ensureMorphInfluences(sceneModel)
    this.applyZoneVisibility(sceneModel)
    this.scene.add(sceneModel)

    // 摩托车：原站 bikeState.group 沿半径 120 的圆轨道，首页（cinematic）
    // 停在 phi = INITIAL_PHI（沙漠区）。注意不能取 2π —— 那是轨道另一侧的
    // 宫殿区（大理石地面），与原站首页的沙漠构图完全不符。
    const bike: THREE.Group = bikeGltf.scene
    this.bike = bike
    bike.name = 'bike'
    const phi = WORLD_CONFIG.INITIAL_PHI
    this.phi = phi
    this.targetPhi = phi
    const R = WORLD_CONFIG.RADIUS
    bike.position.set(Math.cos(phi) * R, 0, Math.sin(phi) * R)
    // 朝向切线（原站 moveBike 用 phi-0.001 的圆上一点作为 lookAt 目标）
    bike.lookAt(
      Math.cos(phi - 0.001) * R,
      0,
      Math.sin(phi - 0.001) * R
    )
    this.frontWheel = bike.getObjectByName('front_wheel') ?? null
    this.rearWheel = bike.getObjectByName('rear_wheel') ?? null
    this.bikeRoot = bike.getObjectByName('root') ?? null
    if (this.bikeRoot) this.rootRotationX = this.bikeRoot.rotation.x
    // 投影：摩托与骑士投射阴影（原站 castShadow 机制）
    bike.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    this.scene.add(bike)

    // 相机跟随：原站把约束节点挂到 bike group 下，故相机相对摩托固定
    this.attachCameraToBike()
    await this.loadSkybox()
    await this.loadToonAssets()
    this.applyWorldToonMaterials()
    await this.applyGroundToonMaterial()
    this.applyBikeToonMaterials()

    // 描边：原站在生成 Toon 材质时同步给每个 mesh 打 identity（地面/天空不参与）
    this.outline.register(sceneModel, (mesh) => mesh.name !== 'ground')
    this.outline.register(bike)

    // 鸟群：原站 initBirdsParticles —— 20 只 InstancedMesh 沿两条螺旋
    // CatmullRom 曲线盘旋，morph target 驱动翅膀扇动。
    this.birdFlock = createBirdFlock(oiseauGltf)
    if (this.birdFlock) {
      this.scene.add(this.birdFlock.mesh)
      // 显隐交给 Orbital Sequence 的 `Zone Visibility / birds` 轨道
      this.zoneGroups.set('birds', this.birdFlock.mesh)
      this.zoneInitialVisible.set('birds', true)
    }

    // 人物动画：Stop/骑行姿势切换、头发飘动、眨眼与左右转眼 morph
    this.bikeAnimator = createBikeAnimator(bike, bikeGltf.animations ?? [])

    // 后轮扬尘（原站 initBikeParticles）：挂到 bike root 下 z=0.9
    await this.initDust()

    // 第五阶段：Theatre 轨道动画（相机 / zone 显隐 / 日夜 / 门 / 雾）
    // 放在鸟群之后，zoneProps 才能包含 birds 键
    await this.initOrbitalSequence()
    this.bindInputListeners()

    // 第六阶段：PLAY 进入的游戏模式。构造时从 obstacle_0~2 建立
    // InstancedMesh 障碍池并绑定键盘 / 滑动输入（原站 MainBundle.create$3）
    this.scene.userData.canvas = this.renderer.domElement
    this.game = new MolaGameMode(this as unknown as GameHost)

    this.syncCameraToBike()
    try {
      this.renderer.compile(this.scene, this.camera)
    } catch (err) {
      // 编译预热失败不影响后续渲染
      console.warn('[mola3d] shader precompile skipped:', err)
    }
  }

  /**
   * 后轮扬尘：原站 initBikeParticles 用 Points + 自定义 shader 做 400 粒子拖尾，
   * rate 由「速度 × rateFactor」驱动，挂到 bike root 下（局部 z=0.9 后轮处）。
   */
  private async initDust() {
    try {
      const tex = await new THREE.TextureLoader().loadAsync('/assets/textures/3d/texture/dust.png')
      tex.colorSpace = THREE.SRGBColorSpace
      this.dust = createDustTrail(tex)
      const parent = this.bike?.getObjectByName('root') ?? this.bike
      parent?.add(this.dust.object)
    } catch (err) {
      console.warn('[mola3d] dust trail unavailable:', err)
    }
  }

  /** Dust 轨道：rateFactor 控制浓度，color 控制染色（原站 types.rgba） */
  private applyDustTrack(dt: number) {
    if (!this.dust || !this.dustObj) return
    const v = this.dustObj.value as {
      color?: { r: number; g: number; b: number }
      rateFactor?: number
      opacity?: number
    }
    if (v.color) this.dust.setColor(new THREE.Color(v.color.r, v.color.g, v.color.b))
    if (typeof v.opacity === 'number') this.dust.setOpacity(v.opacity)
    const speed = this.game?.isActive ? this.game.speed : Math.abs(this.bikeSpeed)
    this.dust.update(dt, speed, v.rateFactor ?? 0)
  }


  /**
   * 区域可见性：scene GLB 的 obstacle_0~3 属于原站 game 模式关卡障碍物
   * （state_v9.json 的 `Zone Visibility` / `Zone Visibility - Game` 轨道），
   * home（cinematic）模式下应隐藏，否则会挡在相机与摩托之间。
   * zone_* / palace_* / shop 组由 initOrbitalSequence 的 Zone Visibility 轨道接管。
   */
  private applyZoneVisibility(root: THREE.Object3D) {
    root.traverse((obj) => {
      if (/^obstacle_\d+$/.test(obj.name)) obj.visible = false
    })
    // 索引 zone 组，并记录 GLB 原始的 visible 作为 Theatre props 默认值
    // （原站：objects.reduce((o,g)=>(o[g.name]=types.boolean(g.visible),o),{})）
    for (const key of ZONE_KEYS) {
      const g = root.getObjectByName(key)
      if (g) {
        this.zoneGroups.set(key, g)
        this.zoneInitialVisible.set(key, g.visible)
      }
    }
  }
  /** GLB 里各 zone 组的初始 visible */
  private zoneInitialVisible = new Map<string, boolean>()

  /**
   * 接入 Theatre 轨道：加载 state_v9.json，创建 Camera / Views 与
   * Zone Visibility 对象，并把 sequence position 设为 phi 的映射（t=0）。
   */
  private async initOrbitalSequence() {
    if (this.cameraPreset === 'code') return // ?cam=code：不用轨道，保持静态机位
    try {
      this.theatre = await loadOrbitalTheatre()
      const sheet = this.theatre.sheet
      const isPhone = window.matchMedia('(max-width: 768px)').matches
      this.camViewObj = sheet.object(
        isPhone ? 'Camera / Views / HomePhone' : 'Camera / Views / HomeDesktop',
        { ...CAMERA_VIEW_PROPS }
      )
      // 无关键帧的区组沿用 GLB 原始 visible（palace_outer 内含地面/墙/屋顶，
      // 一旦默认 false 就会出现「柱子悬空、地面全黑」）
      const zoneProps: Record<string, boolean> = {}
      for (const [key, visible] of this.zoneInitialVisible) zoneProps[key] = visible
      this.zoneObj = sheet.object('Zone Visibility', zoneProps)
      // 原站 SequenceBundle.create$4 同时绑定两套区域显隐轨道，
      // handleVisibility(mode) 在 cinematic / game 之间切换取值
      this.zoneGameObj = sheet.object('Zone Visibility - Game', {
        ...zoneProps,
        flare: false
      })
      this.dayNightObj = sheet.object('Day - Night', { mix: 0 })
      this.doorObj = sheet.object('Door', { left: 0, right: Math.PI })
      this.doorEndObj = sheet.object('DoorEnd', { left: 0, right: 0 })
      this.fogObj = sheet.object('Fog', { intensity: 0, thichness: 0 })
      // 原站：opacity / color(rgba) / rateFactor(number, range 0..200)
      this.dustObj = sheet.object('Dust', {
        opacity: types.number(1, { range: [0, 1] }),
        color: types.rgba({ r: 0.5149, g: 0.2423, b: 0.1413, a: 1 }),
        rateFactor: types.number(0, { range: [0, 200] })
      })
      const root = this.sceneModel
      this.doorLeft = root?.getObjectByName('door_left') ?? null
      this.doorRight = root?.getObjectByName('door_right') ?? null
      this.doorLeftEnd = root?.getObjectByName('door_left_end') ?? null
      this.doorRightEnd = root?.getObjectByName('door_right_end') ?? null
      // 原站把两扇门的 end 节点 x 归零后再由轨道驱动
      if (this.doorLeftEnd) this.doorLeftEnd.position.x = 0
      if (this.doorRightEnd) this.doorRightEnd.position.x = 0
      // 初始位置：phi=INITIAL_PHI → sequence position ≈ 0.578（与原站首页一致）
      this.theatre.sequence.position = phiToSequencePosition(this.phi)
      this.applyZoneTrackValues()
      this.applyDayNight()
      this.applyDoors()
      this.applyFogTrack()
    } catch (err) {
      console.warn('[mola3d] theatre unavailable, keep static camera:', err)
    }
  }

  /** 把 Zone Visibility 轨道当前值写到 GLB 的 zone 组上 */
  private applyZoneTrackValues() {
    // 原站 handleVisibility("game")：改用 Zone Visibility - Game 轨道
    if (this.game?.isActive) {
      this.game.applyZones()
      return
    }
    if (!this.zoneObj) return
    const v = this.zoneObj.value as Record<string, boolean | undefined>
    for (const [key, group] of this.zoneGroups) {
      const next = v[key]
      // 轨道里不存在的键（Theatre 会返回 props 默认值）保持 GLB 原状
      if (typeof next !== 'boolean') continue
      if (group.visible !== next) group.visible = next
    }
    // birds / flare 尚无对应实体（粒子系统后续接入）
  }

  /** 把 Day - Night 轨道的 mix 应用到全部 Toon 材质与天空 */
  private applyDayNight(force = false) {
    if (!this.dayNightObj) return
    const mix = this.dayNightObj.value.mix as number
    if (!force && Math.abs(mix - this.lastDayNightMix) < 1e-4) return
    this.lastDayNightMix = mix
    for (const { mat, palette } of this.toonMaterials) {
      setToonPaletteMix(mat, palette, mix)
    }
    if (this.skyMaterial) this.skyMaterial.uniforms.uMix!.value = mix
  }
  private lastDayNightMix = -1

  /** 门轨道：Door 绑 rotation.y，DoorEnd 绑 position.x（原站 onValuesChange 等价） */
  private applyDoors() {
    if (this.doorObj) {
      const v = this.doorObj.value
      if (this.doorLeft) this.doorLeft.rotation.y = v.left
      if (this.doorRight) this.doorRight.rotation.y = v.right
    }
    if (this.doorEndObj) {
      const e = this.doorEndObj.value
      if (this.doorLeftEnd) this.doorLeftEnd.position.x = e.left
      if (this.doorRightEnd) this.doorRightEnd.position.x = e.right
    }
  }

  /**
   * 雾轨道（原站 FogBundle）：
   *   `Fog / intensity` → setFogIntensity(intensity * 0.02)（写进每个 Toon 材质的 fogDensity）
   *   `Fog / thichness` → moebiusEffect.thickness（描边粗细）
   */
  private applyFogTrack() {
    if (!this.fogObj) return
    const v = this.fogObj.value as { intensity: number; thichness: number }
    setFogIntensity(v.intensity * 0.02)
    this.outline.setThickness(v.thichness)
  }

  /**
   * 首页输入（原站 cinematic 模式）：
   * 滚轮 / 横向拖拽给摩托加速，摩托沿圆轨道行驶带动整条 sequence。
   */
  private bindInputListeners() {
    if (this.inputCleanup) return
    const el = this.renderer.domElement
    const onWheel = (e: WheelEvent) => {
      this.bikeSpeed = THREE.MathUtils.clamp(
        this.bikeSpeed - e.deltaY * BIKE_CONFIG.SCROLL_SENSITIVITY,
        -BIKE_CONFIG.MAX_SPEED,
        BIKE_CONFIG.MAX_SPEED
      )
    }
    const onPointerDown = (e: PointerEvent) => {
      this.isDragging = true
      this.dragLastX = e.clientX
      this.dragStartX = e.clientX
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!this.isDragging) return
      // 点击（pointerdown/up 之间的小抖动）不应被当成拖拽
      if (Math.abs(e.clientX - this.dragStartX) < 10) return
      const dx = e.clientX - this.dragLastX
      this.dragLastX = e.clientX
      this.bikeSpeed = THREE.MathUtils.clamp(
        this.bikeSpeed + dx * BIKE_CONFIG.DRAG_MOVEMENT_FACTOR,
        -BIKE_CONFIG.MAX_SPEED,
        BIKE_CONFIG.MAX_SPEED
      )
    }
    const onPointerUp = () => {
      this.isDragging = false
    }
    // 鼠标视差：归一化到 [-1,1]，原站 cameraConfig 的球面角微调
    const onParallax = (e: PointerEvent) => {
      this.targetParallaxX = (e.clientX / window.innerWidth) * 2 - 1
      this.targetParallaxY = (e.clientY / window.innerHeight) * 2 - 1
    }
    // wheel 挂在 window：canvas 之上有 loader / UI 覆盖层，事件到不了 canvas
    window.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointermove', onParallax)
    window.addEventListener('pointerup', onPointerUp)
    this.inputCleanup = () => {
      window.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointermove', onParallax)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }

  /** 原站 handleMovement(state, DAMPING)：阻尼推进 targetPhi 并 lerp phi */
  private handleMovement(dt: number) {
    // 游戏模式由 bikeGameStrategy（MolaGameMode.tick）推进 phi，
    // cinematic 的滚轮/拖拽阻尼状态机不适用
    if (this.game?.isActive) return
    if (Math.abs(this.bikeSpeed) > BIKE_CONFIG.MIN_SPEED) {
      // 原站 startAnimOnFirstInteraction：首次有速度 → startAnimation()
      // （Stop Action 权重 0.5s 降到 0，人物从停车姿势切到骑行姿势）
      if (this.isFirstInteraction) {
        this.isFirstInteraction = false
        this.bikeAnimator?.start()
      }
      this.bikeSpeed *= BIKE_CONFIG.DAMPING
      this.targetPhi += this.bikeSpeed * dt * 40
      this.phi = THREE.MathUtils.lerp(this.phi, this.targetPhi, BIKE_CONFIG.LERP)
      this.wasMoving = true
    } else if (this.wasMoving) {
      // 原站 stopBike()：stopAnimation() + isFirst = true
      this.wasMoving = false
      this.bikeSpeed = 0
      this.targetPhi = this.phi
      this.isFirstInteraction = true
      this.bikeAnimator?.stop()
    }
  }

  /** 原站 moveBike：按 phi 设置位置并朝向切线 */
  private moveBike() {
    if (!this.bike) return
    const R = WORLD_CONFIG.RADIUS
    this.bike.position.set(Math.cos(this.phi) * R, 0, Math.sin(this.phi) * R)
    this.bike.lookAt(
      Math.cos(this.phi - 0.001) * R,
      0,
      Math.sin(this.phi - 0.001) * R
    )
  }

  /** 原站 updateCameraSequence：phi → sequence position */
  private updateCameraSequence() {
    if (!this.theatre) return
    const pos = phiToSequencePosition(this.phi)
    if (Math.abs(this.theatre.sequence.position - pos) > 1e-3) {
      this.theatre.sequence.position = pos
    }
  }

  /** 每帧把 Theatre 相机轨道值写到相机约束节点（原站 render$3 / CameraBundle） */
  private applyCameraTrack() {
    // 游戏模式用固定 GameDesktop 机位，不由 HomeDesktop 轨道覆盖
    if (this.game?.isActive) return
    if (!this.camViewObj || !this.camAnchor || !this.lookAnchor) return
    const v = this.camViewObj.value
    this.camAnchor.position.set(v.positionX, v.positionY, v.positionZ)
    this.lookAnchor.position.set(v.lookAtX, v.lookAtY, v.lookAtZ)
    if (this.camera.fov !== v.fov || this.camera.far !== v.far) {
      this.camera.fov = v.fov
      this.camera.far = v.far
      this.camera.updateProjectionMatrix()
    }
  }

  /**
   * 鼠标视差 + 入场推镜，作用在 camAnchor 的球面坐标上
   * （原站 cameraState.mousePhi/mouseTheta → cameraConstraintPosition.setFromSpherical）。
   */
  private applyCameraModifiers(dt: number) {
    // 原站 onMouseMove / updateCameraTick 在 game 模式直接 return（关掉视差）
    if (this.game?.isActive) return
    if (!this.camAnchor) return
    this.parallaxX += (this.targetParallaxX - this.parallaxX) * Math.min(1, dt * 6)
    this.parallaxY += (this.targetParallaxY - this.parallaxY) * Math.min(1, dt * 6)

    if (this.introActive) {
      this.introT = Math.min(1, this.introT + dt * this.introSpeed)
      if (this.introT >= 1) this.introActive = false
    }
    // 入场：从 2 倍距离推近到轨道机位（easeOutCubic）
    const k = this.introActive ? 1 - Math.pow(1 - this.introT, 3) : 1
    const distScale = 1 + (2 - 1) * (1 - k)

    const sph = new THREE.Spherical().setFromVector3(this.camAnchor.position)
    sph.radius *= distScale
    sph.phi += this.parallaxY * 0.05
    sph.theta -= this.parallaxX * 0.07
    this.camAnchor.position.setFromSpherical(sph)
  }

  /** 播放入场推镜（点击 ENTER 后调用），duration 秒 */
  playIntro(duration = 1.6) {
    this.introT = 0
    this.introSpeed = 1 / Math.max(0.1, duration)
    this.introActive = true
  }

  /**
   * 车轮滚动与整车起伏（原站 render$5）：
   * speed = cinematicModeSpeed·dt·40·2π·R·0.25，wobble 由 noSpeedWobble + speed·factor 驱动。
   */
  private animateBikeParts(dt: number, elapsedTime: number) {
    // cinematic 的 bikeSpeed 为负（phi 递增），game 模式为正（phi 递减）
    const dir = this.game?.isActive ? 1 : -1
    const speed = dir * this.bikeSpeed * dt * 40 * Math.PI * 2 * WORLD_CONFIG.RADIUS * 0.25
    const rot = speed / (BIKE_CONFIG.radiusWheel * Math.PI * 2)
    if (this.frontWheel) this.frontWheel.rotation.x += rot
    if (this.rearWheel) this.rearWheel.rotation.x += rot
    // 原站：group.children[0].children[0].rotation.x = rootRotationX + cos(t·50)·intensity
    const g0 = this.bike?.children[0] as THREE.Object3D | undefined
    const target = g0?.children[0]
    if (target) {
      // 原站 cinematic 分支：rotationIntensity = cinematicModeSpeed * speedWoobleFactor
      // （cinematicModeSpeed = -state.speed，|speed| 上限 0.01 → 幅度 ≤ 0.001 rad）。
      // 之前误乘了 100，导致整车高频剧烈抖动。
      const intensity = Math.abs(this.bikeSpeed) * BIKE_CONFIG.speedWoobleFactor
      target.rotation.x = this.rootRotationX + Math.cos(elapsedTime * 50) * intensity
    }
  }

  setCameraView(name: string) {
    const view = CAMERA_VIEWS.find((v) => v.name === name) ?? CAMERA_VIEWS[0]
    if (!view) return
    this.camera.position.copy(view.position)
    this.camera.fov = view.fov
    this.camera.far = view.far
    this.camera.lookAt(view.lookAt)
    this.camera.updateProjectionMatrix()
  }

  /** 调试辅助：用于对比原站代码默认机位与 Theatre 覆盖机位 */
  applyCodeDefaultHomeView() {
    this.camera.position.set(-1.5, 0.5, 3)
    this.camera.fov = 55
    this.camera.far = 150
    this.camera.lookAt(0, 0.7, 0)
    this.camera.updateProjectionMatrix()
  }

  /**
   * 相机约束：挂两个 Object3D 到 bike group（等价原站 cameraConstraintPosition /
   * cameraConstraintLookAt），每帧同步相机世界位置与朝向。
   */
  private camAnchor: THREE.Object3D | null = null
  private lookAnchor: THREE.Object3D | null = null

  private attachCameraToBike() {
    if (!this.bike) return
    const preset = this.cameraPreset === 'code' ? CAMERA_CODE : CAMERA_STATE
    const axisY = new THREE.Vector3(0, 1, 0)
    const offset = preset.offset.clone()
    const lookAt = preset.lookAt.clone()
    if (this.cameraYawDeg) {
      const rad = THREE.MathUtils.degToRad(this.cameraYawDeg)
      offset.applyAxisAngle(axisY, rad)
      lookAt.applyAxisAngle(axisY, rad)
    }
    this.camAnchor = new THREE.Object3D()
    this.camAnchor.position.copy(offset)
    this.lookAnchor = new THREE.Object3D()
    this.lookAnchor.position.copy(lookAt)
    this.bike.add(this.camAnchor, this.lookAnchor)
    this.camera.fov = preset.fov
    // far 沿用原站 HomeDesktop 轨道的取值（t=0.5 时 200）；天幕半径 90 落在此范围内
    this.camera.far = preset.far
    this.syncCameraToBike()
  }

  /** 把相机同步到 bike 跟随位置（渲染循环每帧调用） */
  syncCameraToBike() {
    if (!this.camAnchor || !this.lookAnchor || !this.bike) return
    this.bike.updateMatrixWorld(true)
    this.camAnchor.getWorldPosition(this.camera.position)
    const target = this.lookAnchor.getWorldPosition(new THREE.Vector3())
    this.camera.lookAt(target)
    this.camera.updateProjectionMatrix()
    this.syncShadowLight()
  }

  /**
   * 天空：原站 skybox-day.jpg 是 50×1600 的垂直渐变条，
   * 通过 createRenderTargetShader 拉伸成 64×2048 的 equirect 天幕。
   * 这里用内翻球体 + 垂直渐变着色实现同一效果（采样方式一致，视觉等价）。
   * 原站对天幕调用 disableMoebiusEffect()：移到 layer 1，不参与描边 identity pass。
   */
  private async loadSkybox() {
    try {
      const loader = new THREE.TextureLoader()
      const [tex, night] = await Promise.all([
        loader.loadAsync(ASSET_URLS.skyboxDay),
        loader.loadAsync(ASSET_URLS.skyboxNight).catch(() => null)
      ])
      // 原站：dayTexture / nightTexture 都标 srgb
      for (const t of [tex, night]) {
        if (!t) continue
        t.colorSpace = THREE.SRGBColorSpace
        t.wrapS = THREE.ClampToEdgeWrapping
        t.wrapT = THREE.ClampToEdgeWrapping
      }
      const skyMat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uNight: { value: night ?? tex },
          uMix: { value: 0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform sampler2D uNight;
          uniform float uMix;
          varying vec2 vUv;
          void main() {
            vec2 uv = vec2(0.5, clamp(vUv.y, 0.0, 1.0));
            vec3 day = texture2D(uMap, uv).rgb;
            vec3 ngt = texture2D(uNight, uv).rgb;
            vec3 c = mix(day, ngt, uMix);
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false
      })
      this.skyMaterial = skyMat
      // 跟随相机的天幕，半径需落在 camera.far 之内（原站 far = 200）
      const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), skyMat)
      sky.name = 'skyDome'
      sky.renderOrder = -1
      sky.frustumCulled = false
      // 等价原站 disableMoebiusEffect：只留在 layer 1（identity pass 会关掉 layer 1）
      sky.layers.disableAll()
      sky.layers.enable(1)
      // 等价原站天幕 box 的 onBeforeRender：只跟随相机位置、不跟随旋转，
      // 这样天空纹理严格按「视线方向的仰角」采样，和原站一致
      const cam = this.camera
      sky.onBeforeRender = () => {
        sky.position.copy(cam.position)
      }
      this.scene.add(sky)
      // 背景仍保留原站 SCENE_BACKGROUND_COLOR 作为兜底
    } catch (err) {
      console.warn('[mola3d] skybox failed, keep solid background:', err)
    }
  }

  /** 加载 Toon 需要的渐变贴图与地面四张纹理（原站 world create 阶段同一批资源） */
  private async loadToonAssets() {
    const loader = new THREE.TextureLoader()
    const [gradient, map, sand, marble, rock, blend] = await Promise.all([
      loader.loadAsync(ASSET_URLS.gradientMap),
      loader.loadAsync(ASSET_URLS.groundMap),
      loader.loadAsync(ASSET_URLS.groundSand),
      loader.loadAsync(ASSET_URLS.groundMarble),
      loader.loadAsync(ASSET_URLS.groundRock),
      loader.loadAsync(ASSET_URLS.groundBlend)
    ])
    this.gradientMap = createGradientMap(gradient)
    this.groundTextures = { map, sand, marble, rock, blend }

    // 与原站一致：只有 map_ground 标 sRGB（解码），三张细节贴图与 blendmap 保持原始值
    map.colorSpace = THREE.SRGBColorSpace
    for (const t of [sand, marble, rock, blend]) t.colorSpace = THREE.NoColorSpace
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping
    for (const t of [sand, marble, rock]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(80, 80)
    }
    blend.wrapS = blend.wrapT = THREE.RepeatWrapping
  }

  private groundTextures: {
    map: THREE.Texture
    sand: THREE.Texture
    marble: THREE.Texture
    rock: THREE.Texture
    blend: THREE.Texture
  } | null = null

  /**
   * 世界材质：原站对 root 下所有 mesh 调用 generateMeshRampNoiseToonMaterial，
   * 颜色取 WORLD_MOEBIUS_CONFIG[name] / state_v9 的 `objects / <name> / day`。
   * 地面单独用 MeshBlendRampNoiseToonMaterial（见 applyGroundToonMaterial）。
   */
  private applyWorldToonMaterials() {
    if (!this.sceneModel || !this.gradientMap) return
    let applied = 0
    const missing: string[] = []
    this.sceneModel.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      if (mesh.name === 'ground') return
      // mask_palace_in / mask_palace_out 是原站宫殿进出过渡用的遮挡平面，
      // 不是可见几何。套上不透明 Toon 材质后会变成实心色板挡住整片柱廊
      // （表现为「柱子没被渲染到」+ 一块矩形色斑），这里保持它们不可见。
      // if (mesh.name.startsWith('mask_palace')) {
      //   mesh.visible = false
      //   return
      // }
      const key = TOON_COLORS.world[mesh.name] ? mesh.name : mesh.name.replace(/\./g, '')
      const isPillar = /pilonne|pillar/i.test(mesh.name)
      if (!TOON_COLORS.world[key] && !isPillar) missing.push(mesh.name)
      const palette =
        TOON_COLORS.world[key] ??
        (isPillar && this.pillarWarm ? PILLAR_FALLBACK_PALETTE : DEFAULT_PALETTE)
      const src = Array.isArray(mesh.material) ? mesh.material[0] : (mesh.material as THREE.MeshStandardMaterial)
      const map = (src as THREE.MeshStandardMaterial)?.map ?? null
      if (map) map.colorSpace = THREE.SRGBColorSpace
      // 原站只透传 map（+ fog），其余属性用 MeshToonMaterial 默认值：
      // 不透明、FrontSide、alphaTest 0 —— 这也是摩托/遗迹看起来「实心平涂」的原因
      const mat = createToonMaterial({
        palette,
        gradientMap: this.gradientMap!,
        map,
        side: mesh.name.includes('head') ? THREE.DoubleSide : THREE.FrontSide
      })
      const matName = `${mesh.name}_mat`
      mat.name = matName
      this.toonMaterials.push({ mat, palette })
      const old = mesh.material
      mesh.material = mat
      if (Array.isArray(old)) old.forEach((m) => m.dispose())
      else old?.dispose?.()
      // 原站：除 palace / water 外全部投射阴影
      if (!mesh.name.includes('palace') && mesh.name !== 'water') {
        mesh.castShadow = true
      }
      applied++
    })
    console.info(`[mola3d] toon materials applied: ${applied} world meshes`)
    if (missing.length) {
      console.warn(`[mola3d] 无配色回落默认色的 mesh (${missing.length}):`, missing.join(', '))
    }
  }

  /**
   * 地面材质：等价原站 MeshBlendRampNoiseToonMaterial
   * （R_rock / G_sand / B_marble 按 blendmap 权重混合后乘 map_ground_v2.1）。
   */
  private async applyGroundToonMaterial() {
    const ground = this.sceneModel?.getObjectByName('ground') as THREE.Mesh | undefined
    if (!ground || !this.gradientMap || !this.groundTextures) return
    const t = this.groundTextures
    const mat = createGroundToonMaterial({
      map: t.map,
      rock: t.rock,
      sand: t.sand,
      marble: t.marble,
      blendMap: t.blend,
      gradientMap: this.gradientMap,
      blendScale: 50,
      luminance: 1
    })
    mat.name = 'ground_mat'
    const old = ground.material
    ground.material = mat
    ground.receiveShadow = true
    if (Array.isArray(old)) old.forEach((m) => m.dispose())
    else old?.dispose?.()
  }

  /**
   * 摩托车材质：原站对 bike 里所有 MeshStandardMaterial 调用同一套 Toon 材质，
   * 颜色取 getBikeMoebiusConfig() + state_v9 `objects / <mesh> / day`。
   */
  private applyBikeToonMaterials() {
    if (!this.bike || !this.gradientMap) return
    let applied = 0
    this.bike.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const palette = TOON_COLORS.bike[mesh.name] ?? DEFAULT_PALETTE
      const src = Array.isArray(mesh.material) ? mesh.material[0] : (mesh.material as THREE.MeshStandardMaterial)
      const map = (src as THREE.MeshStandardMaterial)?.map ?? null
      if (map) map.colorSpace = THREE.SRGBColorSpace
      const mat = createToonMaterial({
        palette,
        gradientMap: this.gradientMap!,
        map,
        side: THREE.FrontSide
      })
      mat.name = `${mesh.name}_mat`
      this.toonMaterials.push({ mat, palette })
      const old = mesh.material
      mesh.material = mat
      if (Array.isArray(old)) old.forEach((m) => m.dispose())
      else old?.dispose?.()
      mesh.castShadow = true
      applied++
    })
    console.info(`[mola3d] toon materials applied: ${applied} bike meshes`)
  }

  /** 采样地面在 (x,z) 处的高度（用于校验模型落地位置） */
  getGroundHeightAt(x: number, z: number): number | null {
    const ground = this.sceneModel?.getObjectByName('ground')
    if (!ground) return null
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 300, z), new THREE.Vector3(0, -1, 0), 0, 600)
    const hits = ray.intersectObject(ground, true)
    return hits.length && hits[0] ? +hits[0].point.y.toFixed(3) : null
  }

  /** 调试信息：包围盒 / 可见性 / 贴图状态 */
  getDebugInfo() {
    const out: Record<string, unknown> = {}
    if (this.bike) {
      const bb = new THREE.Box3().setFromObject(this.bike)
      out.bike = { min: bb.min.toArray().map((n) => +n.toFixed(3)), max: bb.max.toArray().map((n) => +n.toFixed(3)) }
      const mats: any[] = []
      this.bike.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && mesh.material) {
          const m = mesh.material as any
          mats.push({ mesh: mesh.name, mat: m.name, type: m.type, map: !!m.map, mapImg: m.map?.image ? `${m.map.image.width}x${m.map.image.height}` : null })
        }
      })
      out.bikeMaterials = mats
    }
    if (this.sceneModel) {
      const hidden: string[] = []
      let meshes = 0
      this.sceneModel.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++
        if (!o.visible) hidden.push(o.name)
      })
      out.scene = { meshes, hidden: hidden.slice(0, 12) }
    }
    const lights: any[] = []
    this.scene.traverse((o) => {
      const l = o as THREE.Light
      if ((l as any).isLight) lights.push({ type: l.type, name: l.name, intensity: (l as any).intensity })
    })
    out.lights = lights
    out.camera = { pos: this.camera.position.toArray().map((n) => +n.toFixed(2)), fov: this.camera.fov }
    out.render = { calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles }
    return out
  }

  start() {
    let last = performance.now()
    const loop = () => {
      if (this.disposed || this.contextLost) return
      this.raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      try {
        // 第六阶段：游戏模式（bikeGameStrategy / 障碍 / 碰撞 / 计分）
        this.game?.tick(dt)
        // 第五阶段：摩托运动 → sequence → 相机 / zone 联动（原站 render 循环顺序）
        this.handleMovement(dt)
        this.moveBike()
        this.updateCameraSequence()
        this.applyCameraTrack()
        this.applyCameraModifiers(dt)
        this.applyZoneTrackValues()
        this.applyDayNight()
        this.applyDoors()
        this.applyFogTrack()
        this.applyDustTrack(dt)
        tickFog(dt)
        this.animateBikeParts(dt, now / 1000)
        this.bikeAnimator?.update(dt, this.bikeSpeed)
        this.birdFlock?.update(dt)
        this.syncCameraToBike()
        this.outline.render(this.scene, this.camera)
      } catch (err) {
        // 单帧渲染失败不应中断循环，也不应冒泡到 Vue 导致整页白屏
        if (!this.renderErrorLogged) {
          this.renderErrorLogged = true
          console.error('[mola3d] render error:', err)
          this.options.onError?.(err, 'render loop')
        }
      }
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
  }

  /** PLAY：进入游戏模式（原站 switchToGameMode） */
  enterGame() { this.game?.enter() }
  /** QUIT：返回 cinematic 首页（原站 switchToCinematicMode） */
  exitGame() { this.game?.exit() }
  /** 撞车后重开（原站 restart） */
  restartGame() { this.game?.restart() }

  dispose() {
    this.disposed = true
    this.stop()
    this.game?.dispose()
    this.game = null
    this.dust?.dispose()
    this.dust = null
    this.inputCleanup?.()
    this.inputCleanup = null
    this.cleanupResize()
    this.resizeObserver?.disconnect()
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost)
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((m) => {
          // 释放材质及其纹理
          for (const key of Object.keys(m ?? {})) {
            const v = (m as any)[key]
            if (v?.isTexture) v.dispose()
          }
          m?.dispose?.()
        })
      }
    })
    this.dracoLoader?.dispose()
    this.ktx2Loader?.dispose()
    this.outline.dispose()
    this.birdFlock?.dispose()
    this.birdFlock = null
    this.bikeAnimator?.dispose()
    this.bikeAnimator = null
    this.renderer.dispose()
  }
}

/** WebGL 可用性检测（供错误处理降级） */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}
