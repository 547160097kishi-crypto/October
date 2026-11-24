import * as THREE from 'three'

/**
 * 原站 PLAY 按钮进入的游戏模式（HAR 抓包 gpNsPhdA.js 逆向）。
 *
 * 抓包里能找到完整实现，本项目按同一套参数还原：
 *  - `switchToGameMode()`：关掉 cinematic 滚动策略、把相机动画到 GameDesktop、
 *    切到 `Zone Visibility - Game` 轨道、显示障碍物、启动计分
 *  - `bikeGameStrategy()`：`phi -= speed * delta * 40`（注意是**递减**）
 *  - `gameConfig`：INITIAL_SPEED 9e-4 / SPEED_INCREMENT 1e-4 / MAX_SPEED 0.012 /
 *    OBSTACLE_DIFFICULTY 0.8 / OBSTACLE_DISTANCE π/6 / MIN_INTERVAL 0.125
 *  - `columnCount = 3`、turnIntensity 2：三条车道在半径 R-2 / R / R+2 上
 *  - `generateObstacleTick` / `checkObstaclesPassed` / `detectCollision`
 *  - 每秒 `incrementGameScore()` + `incrementGameSpeed()`，bestScore 存 localStorage
 *
 * 障碍物原型来自 scene_v6.16.4.glb 的 `obstacle_0~2`（Desert / Forest / Castle），
 * 原站把它们做成 InstancedMesh 池，这里同样处理。
 */

const TAU = Math.PI * 2
const R = 120
/** 原站 bikeConfig.INITIAL_PHI —— gameState.lastObstaclePhi 的初值 */
const INITIAL_PHI = 5.92023817104828
const degToRad = (n: number) => (n * Math.PI) / 180

export const GAME_CONFIG = {
  INITIAL_SPEED: 9e-4,
  SPEED_INCREMENT: 1e-4,
  MAX_SPEED: 0.012,
  OBSTACLE_DIFFICULTY: 0.8,
  OBSTACLE_DISTANCE: Math.PI / 6,
  OBSTACLE_MIN_INTERVAL: 0.125,
  TURN_INTENSITY: 2,
  COLUMN_COUNT: 3,
  /** 每个 zone 的障碍实例总数（原站 initializeObstacles(10)） */
  POOL_PER_ZONE: 10,
  /** generateObstacleTick 的调用间隔（秒）；原站是每帧 ticker，这里降频避免同帧重复 */
  SPAWN_INTERVAL: 1 / 12,
  /** 相机视图切换时长（原站 animateCameraView duration 1） */
  CAMERA_DURATION: 1,
  TURN_DURATION: 0.7
}

/** 三个关卡区间的角度范围（原站 zones[]） */
const ZONE_DEFS = [
  { name: 'Desert', phiStart: degToRad(-14.4), phiEnd: degToRad(-118.8) },
  { name: 'Forest', phiStart: degToRad(-118.8), phiEnd: degToRad(-239.4) },
  { name: 'Castle', phiStart: degToRad(-239.4), phiEnd: degToRad(-374.4) }
]

export interface GameHudState {
  mode: 'cinematic' | 'game'
  alive: boolean
  crashed: boolean
  score: number
  bestScore: number
  /** 归一化速度显示值（原站 HUD 的 SPEED） */
  speed: number
  column: number
}

export interface GameHost {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  bike: THREE.Group
  sceneModel: THREE.Group
  camAnchor: THREE.Object3D | null
  lookAnchor: THREE.Object3D | null
  phi: number
  bikeSpeed: number
  targetPhi: number
  zoneGroups: Map<string, THREE.Object3D>
  zoneGameObj: any
  bikeAnimator: { start(): void; stop(): void } | null
  onGameState?: (state: GameHudState) => void
}

interface ObstacleSlot {
  instance: THREE.InstancedMesh
  instanceIndex: number
  zoneIndex: number
  /** 生成时的 gamePhi，用于判断是否驶过 */
  initialPhi: number
  /** 冒出地面动画进度 0..1 */
  spawnT: number
  basePhi: number
  column: number
  quat: THREE.Quaternion
  scale: number
}

interface ZonePool {
  instanced: THREE.InstancedMesh[]
  inactive: ObstacleSlot[]
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0)
const TMP_MATRIX = new THREE.Matrix4()
const TMP_POS = new THREE.Vector3()
const TMP_SCALE = new THREE.Vector3()
const TMP_QUAT = new THREE.Quaternion()
const COLLISION_BOX = new THREE.Box3()
const PROBE_A = new THREE.Vector3()
const PROBE_B = new THREE.Vector3()

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

/** 原站 detectZoneBasedOnAngle */
function detectZone(S: number) {
  for (let y = 0; y < ZONE_DEFS.length; y++) {
    const z = ZONE_DEFS[y]!
    const E = ((z.phiStart % TAU) + TAU) % TAU - TAU
    const b = ((z.phiEnd % TAU) + TAU) % TAU - TAU
    if ((E >= b && S <= E && S >= b) || (E < b && (S <= E || S >= b))) return y
  }
  return 0
}

export class MolaGameMode {
  mode: 'cinematic' | 'game' = 'cinematic'
  alive = false
  crashed = false
  paused = true
  column = 1
  score = 0
  bestScore = 0
  speed = GAME_CONFIG.INITIAL_SPEED

  private host: GameHost
  private pools: ZonePool[] = []
  private active: ObstacleSlot[] = []
  /** 原站 animate(instancedObject.position.y)：障碍整体下沉/升起的父节点 */
  private decorGroup = new THREE.Group()
  private decorTween: { from: number; to: number; t: number; duration: number } | null = null
  /** 原站 initGameHelperCurve：4 条车道导引弧 */
  private helperGroup: THREE.Group | null = null
  private helperMats: THREE.MeshBasicMaterial[] = []
  private helperOpacity = 0
  private lastObstaclePhi = INITIAL_PHI
  private scoreAccum = 0
  private notifyAccum = 0
  private keyPressed = false
  private bikeRoot: THREE.Object3D | null = null
  private camBasePos = new THREE.Vector3()
  private camBaseLook = new THREE.Vector3()
  private camFromPos = new THREE.Vector3()
  private camFromLook = new THREE.Vector3()
  private camToPos = new THREE.Vector3()
  private camToLook = new THREE.Vector3()
  private camFromFov = 55
  private camToFov = 55
  private camT = 1
  private camDuration = 1
  private columnTween: { from: number; to: number; t: number; duration: number } | null = null
  private offsetTween: { from: number; to: number; t: number; duration: number } | null = null
  private columnOffset = 0
  private disposed = false

  /** GameDesktop：原站 cameraViews 里的游戏机位 */
  private static GAME_VIEW = {
    position: new THREE.Vector3(-2.6, 1.8, -3.1),
    lookAt: new THREE.Vector3(2, 1, 2.4),
    fov: 55
  }
  /** 退出时回到 HomeDesktop（原站 moveToHomeView） */
  private static HOME_VIEW = {
    position: new THREE.Vector3(-1.102, 0.6, 1.8),
    lookAt: new THREE.Vector3(0.1, 0.4, 0.2),
    fov: 91
  }

  constructor(host: GameHost) {
    this.host = host
    this.bestScore = Number.parseInt(localStorage.getItem('bestScore') || '0', 10) || 0
    this.bikeRoot = host.bike.getObjectByName('root') ?? null
    this.decorGroup.name = 'game_obstacles'
    this.decorGroup.visible = false
    host.scene.add(this.decorGroup)
    this.initializeObstacles()
    this.initHelperCurve()
    this.bindInput()
    this.emit()
  }

  get isActive() {
    return this.mode === 'game'
  }

  /** sceneManager.applyZoneTrackValues 在游戏模式改走这里 */
  applyZones() {
    const v = this.host.zoneGameObj?.value as Record<string, boolean | undefined> | undefined
    if (!v) return
    for (const [key, group] of this.host.zoneGroups) {
      const next = v[key]
      if (typeof next === 'boolean' && group.visible !== next) group.visible = next
    }
  }

  /** 原站 switchToGameMode() */
  enter() {
    if (this.alive || this.mode === 'game' || this.camT < 1) return
    this.mode = 'game'
    this.alive = true
    this.crashed = false
    this.paused = false
    this.score = 0
    this.scoreAccum = 0
    this.speed = GAME_CONFIG.INITIAL_SPEED
    this.column = 1
    this.columnOffset = 0
    this.host.bikeSpeed = this.speed
    this.host.targetPhi = this.host.phi
    this.lastObstaclePhi = INITIAL_PHI
    this.setBikeColumn(1, true)
    this.moveCameraTo(MolaGameMode.GAME_VIEW)
    this.moveObstaclesUp()
    this.setInstancesVisible(true)
    this.setHelperVisible(true)
    this.host.bikeAnimator?.start()
    this.emit()
  }

  /** 原站 switchToCinematicMode()（QUIT） */
  exit() {
    if (this.mode !== 'game') return
    this.mode = 'cinematic'
    this.alive = false
    this.crashed = false
    this.paused = true
    this.host.bikeSpeed = 0
    this.host.targetPhi = this.host.phi
    this.hideObstacles()
    this.setInstancesVisible(false)
    this.setHelperVisible(false)
    this.setBikeColumn(1, true)
    this.moveCameraTo(MolaGameMode.HOME_VIEW)
    this.host.bikeAnimator?.stop()
    this.score = 0
    this.emit()
  }

  /** 原站 restart()：撞车后重开 */
  restart() {
    if (this.mode !== 'game') return
    this.score = 0
    this.scoreAccum = 0
    this.speed = GAME_CONFIG.INITIAL_SPEED
    this.crashed = false
    this.alive = true
    this.paused = false
    this.host.bikeSpeed = this.speed
    this.host.targetPhi = this.host.phi
    this.clearAllActiveObstacles()
    this.moveObstaclesUp()
    this.setInstancesVisible(true)
    this.setBikeColumn(1, false)
    this.host.bikeAnimator?.start()
    this.emit()
  }

  /** 每帧由 sceneManager 的渲染循环调用（在 handleMovement 之前） */
  tick(dt: number) {
    if (this.disposed) return
    this.updateCamera(dt)
    this.updateColumn(dt)
    this.updateHelper(dt)
    this.updateDecor(dt)
    if (this.mode !== 'game') return

    // 原站 bikeGameStrategy：游戏模式 phi 每帧递减 speed*delta*40
    if (this.alive && !this.paused) {
      this.host.phi -= this.speed * dt * 40
      this.host.targetPhi = this.host.phi
      this.host.bikeSpeed = this.speed
    } else {
      this.host.bikeSpeed = 0
      this.host.targetPhi = this.host.phi
    }

    this.updateSpawning(dt)
    this.checkObstaclesPassed()
    if (this.alive && !this.paused) {
      this.scoreAccum += dt
      while (this.scoreAccum >= 1) {
        this.scoreAccum -= 1
        this.score += 1
        this.speed = Math.min(this.speed + GAME_CONFIG.SPEED_INCREMENT, GAME_CONFIG.MAX_SPEED)
        if (this.score > this.bestScore) {
          this.bestScore = this.score
          localStorage.setItem('bestScore', String(this.bestScore))
        }
      }
      this.generateTick()
      this.detectCollision()
    }

    this.notifyAccum += dt
    if (this.notifyAccum > 0.1) {
      this.notifyAccum = 0
      this.emit()
    }
  }

  /** 原站 gameState.phi = -(2π - phi % 2π + 2π) % 2π */
  private get gamePhi() {
    const p = this.host.phi
    return -(((TAU - (p % TAU) + TAU) % TAU))
  }

  private emit() {
    this.host.onGameState?.({
      mode: this.mode,
      alive: this.alive,
      crashed: this.crashed,
      score: this.score,
      bestScore: this.bestScore,
      speed: this.speed,
      column: this.column
    })
  }

  // ---------------------------------------------------------------- 障碍池

  private initializeObstacles() {
    const root = this.host.sceneModel
    for (let z = 0; z < ZONE_DEFS.length; z++) {
      const group = root.getObjectByName(`obstacle_${z}`)
      const pool: ZonePool = { instanced: [], inactive: [] }
      this.pools.push(pool)
      if (!group) {
        console.warn(`[game] obstacle_${z} 未找到，该 zone 无可用障碍物`)
        continue
      }
      const protos = group.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[]
      if (!protos.length) {
        console.warn(`[game] obstacle_${z} 下没有 Mesh 子节点`)
        continue
      }
      const count = Math.max(1, Math.floor(GAME_CONFIG.POOL_PER_ZONE / protos.length))
      for (const proto of protos) {
        // 共享原型的 Toon 材质（clone 会丢掉 onBeforeCompile 注入），
        // geometry 需要独立拷贝以便清空 morph，避免影响场景里其它实例
        const geo = proto.geometry.clone()
        ;(geo as any).morphAttributes = {}
        const inst = new THREE.InstancedMesh(geo, proto.material, count)
        inst.name = `${proto.name}_game`
        inst.userData.zoneIndex = z
        inst.frustumCulled = false
        inst.castShadow = true
        inst.visible = false
        for (let i = 0; i < count; i++) inst.setMatrixAt(i, ZERO_MATRIX)
        inst.instanceMatrix.needsUpdate = true
        this.decorGroup.add(inst)
        pool.instanced.push(inst)
        for (let i = 0; i < count; i++) {
          pool.inactive.push({
            instance: inst,
            instanceIndex: i,
            zoneIndex: z,
            initialPhi: 0,
            spawnT: 1,
            basePhi: 0,
            column: 1,
            quat: new THREE.Quaternion(),
            scale: 1
          })
        }
      }
    }
  }

  /**
   * 原站 initGameHelperCurve()：4 条同心弧线（R-3 / R-1 / R+1 / R+3，y=0.1），
   * 宽度 0.1、白色、opacity 0.06，用来提示三条车道；整体绕 Y 轴 -phi
   * 跟着摩托走，进入游戏淡入、退出淡出。
   *
   * 原站用 MeshLineMaterial 画线，这里用极薄的 RingGeometry 扇环（视觉等价，
   * 且不需要额外依赖）。采样约定与原站一致：点 (cosθ·L, y, -sinθ·L)，
   * θ ∈ [-arc*0.1, arc*0.9]，arc = 2π*0.15。
   */
  private initHelperCurve() {
    const arc = TAU * 0.15
    const group = new THREE.Group()
    group.name = 'game_helper_curve'
    group.visible = false
    for (const radius of [R - 3, R - 1, R + 1, R + 3]) {
      const geo = new THREE.RingGeometry(radius - 0.05, radius + 0.05, 96, 1, -arc * 0.1, arc)
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false
      })
      const mesh = new THREE.Mesh(geo, mat)
      // RingGeometry 在 XY 平面；绕 X 转 -90° 得到 (cosθ, 0, -sinθ)，与原站一致
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = 0.1
      mesh.frustumCulled = false
      this.helperMats.push(mat)
      group.add(mesh)
    }
    this.host.scene.add(group)
    this.helperGroup = group
  }

  /** 原站 watchEffect(isAlive ? P() : N())：淡入 1s（延迟 1s）/ 淡出 .5s */
  private setHelperVisible(on: boolean) {
    if (!this.helperGroup) return
    if (on) {
      this.helperGroup.visible = true
      this.helperTarget = 0.06
    } else {
      this.helperTarget = 0
    }
  }
  private helperTarget = 0
  private updateHelper(dt: number) {
    if (!this.helperGroup) return
    const dur = this.helperTarget > this.helperOpacity ? 1 : 0.5
    const step = (dt / dur) * 0.06
    if (this.helperOpacity < this.helperTarget) {
      this.helperOpacity = Math.min(this.helperTarget, this.helperOpacity + step)
    } else {
      this.helperOpacity = Math.max(this.helperTarget, this.helperOpacity - step)
    }
    for (const m of this.helperMats) m.opacity = this.helperOpacity
    if (this.helperTarget === 0 && this.helperOpacity <= 0) {
      this.helperGroup.visible = false
    }
    if (this.helperGroup.visible) this.helperGroup.rotation.y = -this.host.phi
  }

  private setInstancesVisible(v: boolean) {
    this.decorGroup.visible = v
    for (const pool of this.pools) {
      for (const inst of pool.instanced) inst.visible = v
    }
  }

  /** 原站 moveObstaclesUp()：整体抬回地面（duration 0） */
  private moveObstaclesUp() {
    this.decorTween = null
    this.decorGroup.position.y = 0
  }

  /** 原站 hideObstacles()：整体下沉到 -3（.5s）后再回收实例 */
  private hideObstacles() {
    this.decorTween = { from: this.decorGroup.position.y, to: -3, t: 0, duration: 0.5 }
  }

  private updateDecor(dt: number) {
    const tw = this.decorTween
    if (!tw) return
    tw.t = Math.min(1, tw.t + dt / tw.duration)
    this.decorGroup.position.y = THREE.MathUtils.lerp(tw.from, tw.to, tw.t)
    if (tw.t >= 1) {
      this.decorTween = null
      if (tw.to < 0) {
        this.clearAllActiveObstacles()
        this.decorGroup.position.y = 0
      }
    }
  }

  /** 原站 generateObstacleTick：每帧尝试，靠 OBSTACLE_MIN_INTERVAL 限距 */
  private generateTick() {
    if (Math.random() > GAME_CONFIG.OBSTACLE_DIFFICULTY) return
    const col = Math.floor(Math.random() * GAME_CONFIG.COLUMN_COUNT)
    const phi = this.gamePhi - GAME_CONFIG.OBSTACLE_DISTANCE
    this.generateObstacle(phi, col)
  }

  private generateObstacle(phi: number, col: number) {
    const gp = this.gamePhi
    let w = gp - this.lastObstaclePhi
    if (w > 0) w -= TAU
    if (w > -GAME_CONFIG.OBSTACLE_MIN_INTERVAL) return false

    const zoneIndex = detectZone(phi % TAU)
    const pool = this.pools[zoneIndex]
    if (!pool || !pool.inactive.length) return false
    const idx = Math.floor(Math.random() * pool.inactive.length)
    const slot = pool.inactive.splice(idx, 1)[0]!

    slot.initialPhi = phi
    slot.basePhi = phi
    slot.column = col
    slot.spawnT = 0
    slot.scale = Math.random() * 0.5 + 0.75
    slot.quat.set(
      Math.random() * 0.1 - 0.05,
      Math.random() * TAU,
      Math.random() * 0.1 - 0.05,
      1
    ).normalize()
    this.active.push(slot)
    this.lastObstaclePhi = gp
    return true
  }

  /** 障碍冒出地面：原站 animate(D=-2 → 0, duration .5, easeOut) */
  private updateSpawning(dt: number) {
    for (const slot of this.active) {
      if (slot.spawnT >= 1) continue
      slot.spawnT = Math.min(1, slot.spawnT + dt / 0.5)
      const y = -2 * (1 - easeOut(slot.spawnT))
      const L = R + (slot.column - 1) * GAME_CONFIG.TURN_INTENSITY
      TMP_POS.set(Math.cos(slot.basePhi) * L, y, Math.sin(slot.basePhi) * L)
      TMP_SCALE.setScalar(slot.scale)
      TMP_MATRIX.compose(TMP_POS, slot.quat, TMP_SCALE)
      slot.instance.setMatrixAt(slot.instanceIndex, TMP_MATRIX)
      slot.instance.instanceMatrix.needsUpdate = true
    }
  }

  /** 原站 checkObstaclesPassed */
  private checkObstaclesPassed() {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const slot = this.active[i]!
      let diff = this.gamePhi - slot.initialPhi
      if (diff > Math.PI) diff -= TAU
      if (diff >= -0.2) continue
      slot.instance.setMatrixAt(slot.instanceIndex, ZERO_MATRIX)
      slot.instance.instanceMatrix.needsUpdate = true
      this.active.splice(i, 1)
      this.pools[slot.zoneIndex]?.inactive.push(slot)
    }
  }

  private clearAllActiveObstacles() {
    for (const slot of this.active) {
      slot.instance.setMatrixAt(slot.instanceIndex, ZERO_MATRIX)
      slot.instance.instanceMatrix.needsUpdate = true
      this.pools[slot.zoneIndex]?.inactive.push(slot)
    }
    this.active.length = 0
  }

  /** 原站 detectCollision：bike 前后两个探针点 vs 障碍 Box3 */
  private detectCollision() {
    const bike = this.host.bike
    const probeRoot = bike.children[0]
    if (!probeRoot) return
    probeRoot.updateWorldMatrix(true, false)
    PROBE_A.set(0, 0, 1.5).applyMatrix4(probeRoot.matrixWorld)
    PROBE_B.set(0, 0, -0.7).applyMatrix4(probeRoot.matrixWorld)
    for (const slot of this.active) {
      if (slot.spawnT < 1) continue
      slot.instance.getMatrixAt(slot.instanceIndex, TMP_MATRIX)
      TMP_POS.setFromMatrixPosition(TMP_MATRIX)
      COLLISION_BOX.setFromCenterAndSize(TMP_POS, TMP_SCALE.set(1, 1, 1))
      if (COLLISION_BOX.containsPoint(PROBE_A) || COLLISION_BOX.containsPoint(PROBE_B)) {
        this.onEndGame()
        return
      }
    }
  }

  private onEndGame() {
    this.alive = false
    this.crashed = true
    this.paused = true
    this.speed = 0
    this.host.bikeSpeed = 0
    this.host.targetPhi = this.host.phi
    this.host.bikeAnimator?.stop()
    this.emit()
  }

  // ---------------------------------------------------------------- 车道

  private setBikeColumn(col: number, instant: boolean) {
    this.column = col
    const targetX = (col - 1) * -GAME_CONFIG.TURN_INTENSITY
    // getOffsetFromColumn(col, 1) = 2 - 2*col，相机横移同样走补间（原站 animate(cameraState, ...)）
    const targetOffset = 2 - 2 * col
    if (instant) {
      if (this.bikeRoot) this.bikeRoot.position.x = targetX
      this.columnOffset = targetOffset
      this.columnTween = null
      this.offsetTween = null
    } else {
      // 原站 L = max(1, speed/INITIAL_SPEED*.15)，速度越快换道越快
      const k = Math.max(1, this.speed / GAME_CONFIG.INITIAL_SPEED * 0.15)
      const duration = GAME_CONFIG.TURN_DURATION / k
      const from = this.bikeRoot?.position.x ?? targetX
      this.columnTween = { from, to: targetX, t: 0, duration }
      this.offsetTween = { from: this.columnOffset, to: targetOffset, t: 0, duration }
    }
  }

  private turn(right: boolean) {
    if (!this.alive || this.crashed || this.keyPressed) return
    if (right && this.column >= GAME_CONFIG.COLUMN_COUNT - 1) return
    if (!right && this.column <= 0) return
    this.keyPressed = true
    this.setBikeColumn(this.column + (right ? 1 : -1), false)
    const k = Math.max(1, this.speed / GAME_CONFIG.INITIAL_SPEED * 0.15)
    window.setTimeout(() => { this.keyPressed = false }, 300 / k)
    this.emit()
  }

  private updateColumn(dt: number) {
    const tw = this.columnTween
    if (tw && this.bikeRoot) {
      tw.t = Math.min(1, tw.t + dt / tw.duration)
      this.bikeRoot.position.x = THREE.MathUtils.lerp(tw.from, tw.to, easeInOut(tw.t))
      if (tw.t >= 1) this.columnTween = null
    }
    const ot = this.offsetTween
    if (ot) {
      ot.t = Math.min(1, ot.t + dt / ot.duration)
      this.columnOffset = THREE.MathUtils.lerp(ot.from, ot.to, easeInOut(ot.t))
      if (ot.t >= 1) this.offsetTween = null
    }
  }

  // ---------------------------------------------------------------- 相机

  private moveCameraTo(view: { position: THREE.Vector3; lookAt: THREE.Vector3; fov: number }) {
    this.camFromPos.copy(this.camBasePos.lengthSq() ? this.camBasePos : (this.host.camAnchor?.position ?? view.position))
    this.camFromLook.copy(this.camBaseLook.lengthSq() ? this.camBaseLook : (this.host.lookAnchor?.position ?? view.lookAt))
    this.camFromFov = this.host.camera.fov
    this.camToPos.copy(view.position)
    this.camToLook.copy(view.lookAt)
    this.camToFov = view.fov
    this.camT = 0
    this.camDuration = GAME_CONFIG.CAMERA_DURATION
  }

  private updateCamera(dt: number) {
    const anchor = this.host.camAnchor
    const look = this.host.lookAnchor
    if (!anchor || !look) return
    if (this.camT < 1) {
      this.camT = Math.min(1, this.camT + dt / this.camDuration)
      const k = easeInOut(this.camT)
      this.camBasePos.lerpVectors(this.camFromPos, this.camToPos, k)
      this.camBaseLook.lerpVectors(this.camFromLook, this.camToLook, k)
      this.host.camera.fov = THREE.MathUtils.lerp(this.camFromFov, this.camToFov, k)
      this.host.camera.updateProjectionMatrix()
    }
    if (this.mode === 'cinematic' && this.camT >= 1) return
    anchor.position.copy(this.camBasePos)
    anchor.position.x += this.columnOffset
    look.position.copy(this.camBaseLook)
    look.position.x += this.columnOffset
  }

  // ---------------------------------------------------------------- 输入

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.mode !== 'game' || !this.alive) return
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'KeyA') {
      e.preventDefault()
      this.turn(false)
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'KeyD') {
      e.preventDefault()
      this.turn(true)
    }
  }

  private touchStartX = 0
  private onPointerDown = (e: PointerEvent) => { this.touchStartX = e.clientX }
  private onPointerUp = (e: PointerEvent) => {
    if (this.mode !== 'game' || !this.alive) return
    const dx = e.clientX - this.touchStartX
    if (Math.abs(dx) < 10) return
    this.turn(dx > 0)
  }

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown, { passive: false })
    const el = this.host.scene.userData.canvas as HTMLCanvasElement | undefined
    const target: HTMLElement | Window = el ?? window
    target.addEventListener('pointerdown', this.onPointerDown as EventListener)
    window.addEventListener('pointerup', this.onPointerUp as EventListener)
  }

  dispose() {
    this.disposed = true
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('pointerup', this.onPointerUp as EventListener)
    const el = this.host.scene.userData.canvas as HTMLCanvasElement | undefined
    ;(el ?? window).removeEventListener('pointerdown', this.onPointerDown as EventListener)
    this.clearAllActiveObstacles()
    for (const pool of this.pools) {
      for (const inst of pool.instanced) {
        this.decorGroup.remove(inst)
        inst.geometry.dispose()
        inst.dispose()
      }
    }
    this.pools = []
    if (this.helperGroup) {
      this.host.scene.remove(this.helperGroup)
      this.helperGroup.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) m.geometry.dispose()
      })
      for (const mat of this.helperMats) mat.dispose()
      this.helperMats = []
      this.helperGroup = null
    }
    this.host.scene.remove(this.decorGroup)
  }
}
