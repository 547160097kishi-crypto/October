import * as THREE from 'three'

/**
 * 原站 initBikeAnimation（gpNsPhdA.js BikeBundle）的等价实现。
 *
 * bike_v9.7.glb 自带 12 个 AnimationClip，原站用两个 AnimationMixer 驱动：
 *  - `Stop Action`（258 通道人物骨骼）：初始 weight=1 → 停车姿势；
 *    启动 0.5s 内降到 0 → 回到绑定姿势（骑行姿势）；停车 1s 内升回 1。
 *  - `Head Character Action`：LoopOnce，播完后随机 1~6s 重播，timeScale 0.25~0.75。
 *  - `wind_float`：循环播放，weight = |speed| / MAX_SPEED（头发被风吹）。
 *  - `wind_influence`：独立 hairMixer，paused，每帧手动设
 *    time = lerp(time, |speed| * duration / MAX_SPEED, 0.1)。
 *  - mixer/hairMixer 每帧 update(ANIMATION_SPEED * dt)，ANIMATION_SPEED = 1.5。
 *
 * 眼睛动画（👁）不是 AnimationClip，而是 `yame` SkinnedMesh 的 3 个 morph target：
 *  blink / look_left / look_right。原站每 2~7 秒随机触发一次：
 *  blink      → 0.15s 到 1，停 100ms，0.15s 回 0
 *  look_right → 0.5s 到 0.7，停 300~800ms，0.5s 回 0
 *  look_left  → 0.5s 到 0.5，停 300~800ms，0.5s 回 0
 */
const ANIMATION_SPEED = 1.5
/** 原站 gameConfig.MAX_SPEED */
const MAX_SPEED = 0.012

type EyeKey = 'blink' | 'look_left' | 'look_right'
type EyePhase = 'idle' | 'in' | 'hold' | 'out'

export interface BikeAnimatorHandle {
  start: () => void
  stop: () => void
  update: (dt: number, speed: number) => void
  dispose: () => void
  /** 调试：姿势权重 / 眼睛阶段 / morph 当前值 */
  status: () => { stopWeight: number; eyePhase: EyePhase; eyeKey: EyeKey; eyeValue: number }
}

export function createBikeAnimator(
  bike: THREE.Group,
  animations: THREE.AnimationClip[]
): BikeAnimatorHandle | null {
  if (!animations?.length) return null
  const find = (name: string) => animations.find((a) => a.name === name)

  const stopClip = find('Stop Action')
  if (!stopClip) {
    console.warn('[mola3d] bike 缺少 Stop Action，跳过人物动画')
    return null
  }

  const mixer = new THREE.AnimationMixer(bike)
  const hairMixer = new THREE.AnimationMixer(bike)

  /**
   * bike_v9.7.glb 里个别 clip 的轨道绑定到已不存在的节点，
   * AnimationAction.play() 会在 AnimationMixer._lendBinding 里对 undefined
   * 写 _cacheIndex 而抛错（原站同样数据但在自己的 mixer 实现里被吞掉）。
   * 这里安全跳过无效 clip，避免每帧污染控制台 / 打断渲染循环。
   */
  const safePlay = (m: THREE.AnimationMixer, clip: THREE.AnimationClip) => {
    try {
      const action = m.clipAction(clip)
      action.play()
      return action
    } catch (err) {
      console.warn('[mola3d] 跳过无效动画轨道:', clip.name, err)
      try { m.uncacheClip(clip) } catch { /* 已释放 */ }
      return null
    }
  }

  const stopAction = safePlay(mixer, stopClip)
  if (!stopAction) return null
  stopAction.weight = 1

  const headClip = find('Head Character Action')
  const headAction = (() => {
    if (!headClip) return null
    const a = safePlay(mixer, headClip)
    if (!a) return null
    a.setLoop(THREE.LoopOnce, 1)
    return a
  })()

  const headFinished = ({ action }: { action: THREE.AnimationAction }) => {
    if (!headAction || action.getClip().name !== headAction.getClip().name) return
    window.setTimeout(() => {
      if (!headAction) return
      try {
        headAction.stop()
        headAction.timeScale = Math.random() * 0.5 + 0.25
        headAction.play()
      } catch { /* 轨道无效，停止重播 */ }
    }, Math.random() * 5000 + 1000)
  }
  if (headAction) mixer.addEventListener('finished', headFinished as never)

  const windFloat = (() => {
    const clip = find('wind_float')
    if (!clip) return null
    const a = safePlay(mixer, clip)
    if (!a) return null
    a.setLoop(THREE.LoopRepeat, Infinity)
    a.weight = 0
    return a
  })()

  const windInfluence = (() => {
    const clip = find('wind_influence')
    if (!clip) return null
    const a = safePlay(hairMixer, clip)
    if (!a) return null
    a.paused = true
    return a
  })()

  // 眼睛 morph target（原站 skinnedMesh = scene.getObjectByName("yame")）
  const skinned = bike.getObjectByName('yame') as THREE.SkinnedMesh | undefined
  const dict = skinned?.morphTargetDictionary ?? undefined
  const influences = skinned?.morphTargetInfluences ?? undefined

  // ---- 停车 / 骑行姿势权重补间（原站 animate(z,{value},{duration})）----
  let stopWeight = 1
  let targetStopWeight = 1
  let weightRate = 0 // 每秒变化量

  // ---- 眼睛状态机 ----
  let eyePhase: EyePhase = 'idle'
  let eyeKey: EyeKey = 'blink'
  let eyeTarget = 1
  let eyeInDur = 0.15
  let eyeOutDur = 0.15
  let eyeHold = 0.1
  let eyeT = 0
  let nextEyeIn = 2 + Math.random() * 5

  function setEyeInfluence(v: number) {
    if (!dict || !influences) return
    const idx = dict[eyeKey]
    if (idx !== undefined) influences[idx] = v
  }

  function beginEye() {
    const r = Math.random()
    if (r < 0.33) {
      eyeKey = 'blink'
      eyeTarget = 1
      eyeInDur = eyeOutDur = 0.15
      eyeHold = 0.1
    } else if (r < 0.66) {
      eyeKey = 'look_right'
      eyeTarget = 0.7
      eyeInDur = eyeOutDur = 0.5
      eyeHold = Math.random() * 0.5 + 0.3
    } else {
      eyeKey = 'look_left'
      eyeTarget = 0.5
      eyeInDur = eyeOutDur = 0.5
      eyeHold = Math.random() * 0.5 + 0.3
    }
    eyePhase = 'in'
    eyeT = 0
  }

  function updateEyes(dt: number) {
    if (!dict || !influences) return
    if (eyePhase === 'idle') {
      nextEyeIn -= dt
      if (nextEyeIn <= 0) beginEye()
      return
    }
    eyeT += dt
    if (eyePhase === 'in') {
      const k = Math.min(1, eyeT / eyeInDur)
      setEyeInfluence(eyeTarget * k)
      if (k >= 1) {
        eyePhase = 'hold'
        eyeT = 0
      }
    } else if (eyePhase === 'hold') {
      if (eyeT >= eyeHold) {
        eyePhase = 'out'
        eyeT = 0
      }
    } else {
      const k = Math.min(1, eyeT / eyeOutDur)
      setEyeInfluence(eyeTarget * (1 - k))
      if (k >= 1) {
        eyePhase = 'idle'
        nextEyeIn = 2 + Math.random() * 5
      }
    }
  }

  return {
    start() {
      targetStopWeight = 0
      weightRate = 1 / 0.5 // 原站 start：0.5s
    },
    stop() {
      targetStopWeight = 1
      weightRate = 1 / 1 // 原站 stop：1s
    },
    status() {
      const idx = dict?.[eyeKey]
      return {
        stopWeight,
        eyePhase,
        eyeKey,
        eyeValue: idx !== undefined ? (influences?.[idx] ?? 0) : 0
      }
    },
    update(dt: number, speed: number) {
      if (weightRate > 0) {
        const diff = targetStopWeight - stopWeight
        const step = weightRate * dt
        if (Math.abs(diff) <= step) {
          stopWeight = targetStopWeight
          weightRate = 0
        } else {
          stopWeight += Math.sign(diff) * step
        }
        stopAction.weight = stopWeight
      }

      mixer.update(ANIMATION_SPEED * dt)
      hairMixer.update(ANIMATION_SPEED * dt)

      const ratio = Math.min(1, Math.abs(speed) / MAX_SPEED)
      if (windInfluence) {
        windInfluence.time = THREE.MathUtils.lerp(
          windInfluence.time,
          ratio * windInfluence.getClip().duration,
          0.1
        )
      }
      if (windFloat) windFloat.weight = THREE.MathUtils.lerp(windFloat.weight, ratio, 0.1)

      updateEyes(dt)
    },
    dispose() {
      if (headAction) mixer.removeEventListener('finished', headFinished as never)
      // 只停用动作即可：three 的 uncacheRoot() 会对已清空的动作表再次
      // _removeInactiveAction()，此时 lastInactiveAction 为 undefined，
      // 会抛 "Cannot set properties of undefined (setting '_cacheIndex')"
      //（HMR / 组件卸载时必现）。mixer 随 manager 一起被 GC 回收。
      mixer.stopAllAction()
      hairMixer.stopAllAction()
    }
  }
}
