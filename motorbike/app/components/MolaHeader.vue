<template>
  <header class="appHeader">
    <div class="navigation">
      <div class="uiButtonGame light play-btn" :class="{ '-quit': mode === 'game' }">
        <button class="uiButtonGhost inner" type="button" @click="mode === 'game' ? emit('quit') : emit('play')">
          <span>
            <svg
              v-if="mode !== 'game'"
              class="uiIconPlay"
              width="7"
              height="9"
              viewBox="-2 0 12 12"
              fill="#0b0b0c"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M8.39769 6L0.621993 0.461992V11.538L8.39769 6Z" />
            </svg>
            {{ mode === 'game' ? 'Quit' : 'Play' }}
          </span>
        </button>
        <img v-if="mode !== 'game'" class="uiIconMoto" src="/ui/moto.svg" alt="" width="25" height="13">
      </div>

      <nav v-if="mode !== 'game'" aria-label="主导航">
        <a class="nav-item" href="#" @click.prevent>TOUR 2025</a>
        <a class="nav-item" href="#" @click.prevent>Shop</a>
        <a class="nav-item" href="#" @click.prevent>ÉBĒM Vault</a>
      </nav>
    </div>

    <header class="appLogo">
      <div class="logos">
        <MolaLogo />
      </div>
    </header>

    <div class="controls">
      <div class="sound-control">
        <div class="uiRadio link-2" role="button" tabindex="0" @click="emit('togglePlay')" @keydown.enter="emit('togglePlay')">
          <div class="top">
            <p class="label">Now Playing</p>
            <p class="value">{{ title }}</p>
          </div>
        </div>
        <div
          class="uiSoundButton soundButton"
          :class="{ 'is-muted': muted }"
          role="button"
          tabindex="0"
          :aria-pressed="!muted"
          @click="emit('toggleMute')"
          @keydown.enter="emit('toggleMute')"
        >
          <div class="waveform" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </div>
          <p class="volume-state">{{ muted ? 'OFF' : 'ON' }}</p>
        </div>
      </div>

      <button class="fullscreen" type="button" aria-label="全屏" @click="toggleFullscreen">
        <svg
          width="19"
          height="14"
          viewBox="0 0 19 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M1.2998 10V12.623C1.2998 12.6655 1.33453 12.7002 1.37695 12.7002H5.4375V14H1.37695L1.23633 13.9932C0.588097 13.9275 0.0725189 13.4119 0.00683594 12.7637L0 12.623V10H1.2998Z"
            fill="currentColor"
          />
          <path
            d="M19 12.623L18.9932 12.7637C18.9275 13.4119 18.4119 13.9275 17.7637 13.9932L17.623 14H13.5801V12.7002H17.623C17.6655 12.7002 17.7002 12.6655 17.7002 12.623V10H19V12.623Z"
            fill="currentColor"
          />
          <path
            d="M17.7637 0.00683594C18.4581 0.0771988 19 0.663979 19 1.37695V4H17.7002V1.37695C17.7002 1.33453 17.6655 1.2998 17.623 1.2998H13.5801V0H17.623L17.7637 0.00683594Z"
            fill="currentColor"
          />
          <path
            d="M5.4375 1.2998H1.37695C1.33453 1.2998 1.2998 1.33453 1.2998 1.37695V4H0V1.37695C0 0.663979 0.541913 0.0771986 1.23633 0.00683594L1.37695 0H5.4375V1.2998Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  muted: boolean
  playing: boolean
  /** cinematic = 顶部 PLAY 进入游戏；game = 顶部 QUIT 退出 */
  mode: 'cinematic' | 'game'
}>()

const emit = defineEmits<{
  (e: 'play'): void
  (e: 'quit'): void
  (e: 'toggleMute'): void
  (e: 'togglePlay'): void
}>()

const isFullscreen = ref(false)

function toggleFullscreen() {
  if (!import.meta.client) return
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().then(() => {
      isFullscreen.value = true
    }).catch(() => {})
  } else {
    document.exitFullscreen?.().then(() => {
      isFullscreen.value = false
    }).catch(() => {})
  }
}

onMounted(() => {
  const onChange = () => { isFullscreen.value = Boolean(document.fullscreenElement) }
  document.addEventListener('fullscreenchange', onChange)
  onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onChange))
})
</script>
