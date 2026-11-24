<template>
  <div class="homePage">
    <!-- 3D 场景：Three.js + Draco + KTX2（第四阶段）+ Theatre 轨道动画（第五阶段） -->
    <MolaScene3D
      ref="sceneRef"
      @progress="p => (sceneProgress = p)"
      @ready="sceneReady = true"
      @game-state="onGameState"
    />

    <MolaHeader
      :title="trackTitle"
      :muted="isMuted"
      :playing="isPlaying"
      :mode="gameState.mode"
      @play="enterGame"
      @quit="exitGame"
      @toggle-mute="toggleMute"
      @toggle-play="toggle"
    />

    <MolaGameHud :state="gameState" @restart="restartGame" @quit="exitGame" />

    <div class="scrollHint" :class="{ '-show': entered && gameState.mode !== 'game' }">
      <span class="dash" />
      <span class="chev">‹</span>
      <span class="label">Scroll to explore</span>
      <span class="chev">›</span>
      <span class="dash" />
    </div>

    <MolaLoader v-if="showLoader" :external-progress="sceneProgress" @enter="handleEnter" @enter-start="play" />

    <!-- 页脚在 loader 之后，与根元素同层，Loading 期间同样可见（与原站一致） -->
    <MolaFooter />
  </div>
</template>

<script setup lang="ts">
import type { GameHudState } from '~/utils/mola3d/gameMode'

useHead({
  title: 'Molazone - Yamê Official website',
  meta: [
    { name: 'theme-color', content: '#0b0b0c' },
    {
      name: 'description',
      content: 'Molazone — Yamê ÉBĒM 3D 体验站还原（Nuxt + Vue 3 + Three.js），资源来自 HAR 抓包提取'
    }
  ]
})

const showLoader = ref(true)
const entered = ref(false)
const sceneProgress = ref(0)
const sceneReady = ref(false)
const sceneRef = ref<{
  playIntro: (d?: number) => void
  enterGame: () => void
  exitGame: () => void
  restartGame: () => void
} | null>(null)
const { isPlaying, isMuted, trackTitle, play, toggle, toggleMute } = useMolaAudio()

/** 游戏模式 HUD 状态（由 MolaSceneManager.onGameState 推送） */
const INITIAL_GAME_STATE: GameHudState = {
  mode: 'cinematic',
  alive: false,
  crashed: false,
  score: 0,
  bestScore: 0,
  speed: 0,
  column: 1
}
const gameState = ref<GameHudState>({ ...INITIAL_GAME_STATE })

function onGameState(s: GameHudState) {
  gameState.value = s ?? { ...INITIAL_GAME_STATE }
}

/** Loading 结束、点击 Enter 后进入主界面，并开始播放 Now Playing */
function handleEnter() {
  showLoader.value = false
  entered.value = true
  play()
  // 入场推镜：从远处推进到 HomeDesktop 轨道机位（原站 animateCameraView）
  sceneRef.value?.playIntro(1.6)
}

/** 顶部 PLAY：进入原站的游戏模式（3 车道躲避障碍） */
function enterGame() {
  if (!sceneReady.value) return
  showLoader.value = false
  entered.value = true
  sceneRef.value?.enterGame()
}

/** 顶部 QUIT / 死亡面板 QUIT：回到 cinematic 首页 */
function exitGame() {
  sceneRef.value?.exitGame()
}

/** 撞车后重开一局 */
function restartGame() {
  sceneRef.value?.restartGame()
}
</script>
