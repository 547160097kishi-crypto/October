<template>
  <div class="webglRenderTargetContainer">
    <canvas id="webglCanvas" ref="canvasRef" class="webglRenderTarget" />

    <!-- WebGL / 模型加载错误提示（不阻塞页面其余 UI） -->
    <div v-if="error" class="webglError" role="alert">
      <p class="title">3D scene unavailable</p>
      <p class="detail">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MolaSceneManager, isWebGLAvailable } from '~/utils/mola3d/sceneManager'
import type { GameHudState } from '~/utils/mola3d/gameMode'

const emit = defineEmits<{
  (e: 'progress', percent: number): void
  (e: 'ready'): void
  (e: 'gameState', state: GameHudState): void
}>()

const error = ref<string | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let manager: MolaSceneManager | null = null
let initialized = false

/**
 * Nuxt 4 的 .client 组件在 Suspense 下挂载时，onMounted 触发时 DOM 可能尚未插入，
 * 因此用 watch(flush: 'post') 监听 template ref，canvas 就绪即初始化（只执行一次）。
 */
watch(canvasRef, (canvas) => {
  if (!canvas || initialized) return
  initialized = true
  initScene(canvas)
}, { immediate: true, flush: 'post' })

async function initScene(canvas: HTMLCanvasElement) {
  if (!isWebGLAvailable()) {
    error.value = 'WebGL is not available on this device or browser.'
    emit('progress', 100)
    emit('ready')
    return
  }

  try {
    manager = new MolaSceneManager(canvas, {
      onProgress: (p) => emit('progress', p),
      onError: (err, context) => {
        console.error(`[mola3d] ${context} failed:`, err)
        if (!error.value) error.value = `Failed to load ${context}`
      }
    })
    // 调试开关：?cam=code 使用原站 cameraViews 代码默认近景机位
    const params = new URLSearchParams(window.location.search)
    if (params.get('cam') === 'code') manager.cameraPreset = 'code'
    // 调试开关：?yaw=12 让相机绕 bike 再转 12°（对齐原站首页构图用）
    const yaw = Number(params.get('yaw'))
    if (Number.isFinite(yaw)) manager.cameraYawDeg = yaw
    // 调试开关：?pillarPalette=default 还原宫殿柱廊的默认紫色间接光
    if (params.get('pillarPalette') === 'default') manager.pillarWarm = false
    // 游戏模式 HUD 状态（score / speed / column / crashed）
    manager.onGameState = (state) => emit('gameState', state)
    await manager.load()
    // 调试开关：?outline=0 关闭描边（用于对比纯 Toon 着色与原站差异）
    if (params.get('outline') === '0') {
      manager.outline.enabled = false
    }
    manager.start()
    ;(window as any).__mola3d = manager
    emit('ready')
  } catch (e) {
    console.error('[mola3d] fatal:', e)
    error.value = e instanceof Error ? e.message : String(e)
    emit('progress', 100)
    emit('ready')
  }
}

onBeforeUnmount(() => {
  manager?.dispose()
  manager = null
})

/** 供页面在点击 ENTER 后触发入场推镜（原站 animateCameraView 的近景推进） */
defineExpose({
  playIntro: (duration = 1.6) => manager?.playIntro(duration),
  /** PLAY → 进入游戏模式 */
  enterGame: () => manager?.enterGame(),
  /** QUIT → 返回 cinematic 首页 */
  exitGame: () => manager?.exitGame(),
  /** 撞车后重开 */
  restartGame: () => manager?.restartGame(),
  get manager() {
    return manager
  }
})
</script>

<style scoped>
.webglRenderTargetContainer {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}
.webglRenderTarget {
  width: 100%;
  height: 100%;
  display: block;
  background: var(--c-secondary);
}
.webglError {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 20px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 8px;
  background: rgba(11, 11, 12, 0.85);
  color: var(--sand-white-rgb);
  text-align: center;
  z-index: 5;
}
.webglError .title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.webglError .detail {
  margin-top: 4px;
  font-size: 10px;
  opacity: 0.7;
}
</style>
