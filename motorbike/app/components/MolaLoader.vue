<template>
  <div class="appLoader" :class="{ '-out': leaving }">
    <div class="enterOverlay" />
    <div class="loaderOverlay" />

    <div class="loader -mounted">
      <header class="appLogo">
        <div class="logos">
          <MolaLogo />
        </div>
      </header>

      <div class="background" aria-hidden="true">
        <div v-for="n in 4" :key="n" class="backgroundContainer">
          <img :src="`/assets/images/3d/tmp-cdn-patch/images/loader_background0${n}.webp`" alt="">
        </div>
      </div>

      <div class="loaderGrid">
        <div class="left">
          <img src="/assets/images/3d/tmp-cdn-patch/images/loader_leftShape.webp" alt="">
        </div>
        <div class="top">
          <img src="/assets/images/3d/tmp-cdn-patch/images/loader_topShape.webp" alt="">
        </div>

        <div
          class="center"
          :class="centerClass"
          role="button"
          :tabindex="phase === 'enter' ? 0 : -1"
          :aria-label="phase === 'enter' ? 'Enter the Molazone' : 'Loading'"
          @click="handleCenter"
          @keydown.enter="handleCenter"
        >
          <div class="transitionCenter" />
          <div class="shape">
            <img src="/ui/loader-shape.svg" alt="">
          </div>

          <div class="loadingStep">
            <div class="counter">
              <div class="percentage">{{ progress }} %</div>
            </div>
            <div class="action">
              <button v-show="phase !== 'loading'" class="loadingCta" type="button" @click.stop="handleCenter">
                Enter
              </button>
            </div>
          </div>
        </div>

        <div class="bottom">
          <img src="/assets/images/3d/tmp-cdn-patch/images/loader_bottomShape.webp" alt="">
        </div>
        <div class="right">
          <img src="/assets/images/3d/tmp-cdn-patch/images/loader_rightShape.webp" alt="">
        </div>
      </div>

      <div class="footerBackground" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{ duration?: number; externalProgress?: number }>(),
  { duration: 3200, externalProgress: 0 }
)
const emit = defineEmits<{ (e: 'enter'): void; (e: 'enterStart'): void }>()

const progress = ref(0)
const phase = ref<'loading' | 'enter' | 'entering'>('loading')
const leaving = ref(false)

const centerClass = computed(() => ({
  '-loaded': phase.value === 'enter',
  '-entering': phase.value === 'entering'
}))

let raf = 0
let timers: ReturnType<typeof setTimeout>[] = []

onMounted(() => {
  // 预加载四张背景图
  let loaded = 0
  const total = 4
  for (let n = 1; n <= 4; n++) {
    const img = new Image()
    img.onload = img.onerror = () => { loaded++ }
    img.src = `/assets/images/3d/tmp-cdn-patch/images/loader_background0${n}.webp`
  }

  const start = performance.now()
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / props.duration)
    const eased = 1 - (1 - t) * (1 - t)
    let p = Math.floor(eased * 100)

    // 3D 资源（三个 GLB，字节级）真实进度；主模型未就绪时进度封顶 92%
    const ext = props.externalProgress ?? 0
    const extReady = ext >= 100
    if (!extReady && p > 92) p = 92
    if (ext > p) p = ext
    if (p > progress.value) progress.value = Math.min(100, p)

    const imagesReady = loaded >= total
    if (progress.value >= 100 && imagesReady) {
      progress.value = 100
      phase.value = 'enter'
      return
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})

function handleCenter() {
  if (phase.value !== 'enter') return
  phase.value = 'entering'
  // 必须由点击手势同步触发音频（浏览器自动播放策略）
  emit('enterStart')
  timers.push(
    setTimeout(() => { leaving.value = true }, 950),
    setTimeout(() => { emit('enter') }, 1850)
  )
}

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  timers.forEach(clearTimeout)
  timers = []
})
</script>

<style scoped>
.appLoader {
  position: fixed;
  inset: 0;
  z-index: 50;
  opacity: 1;
  transition: opacity 0.9s ease;
}
.appLoader.-out {
  opacity: 0;
  pointer-events: none;
}
.enterOverlay,
.loaderOverlay {
  position: fixed;
  inset: 0;
  width: 100svw;
  height: 100svh;
  pointer-events: none;
  opacity: 1;
}
.enterOverlay {
  background-color: var(--c-primary);
  z-index: 0;
}
.loaderOverlay {
  background-color: var(--c-secondary);
  z-index: 1;
}

.loader {
  position: fixed;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--c-secondary);
  color: var(--c-primary);
}
.loader > .appLogo {
  position: absolute;
  top: 32px;
  left: 50%;
  z-index: 4;
  transform: translateX(-50%);
}

/* 四宫格背景插画 */
.background {
  display: grid;
  grid-template-columns: repeat(2, 50vw);
  grid-template-rows: repeat(2, 50svh);
  gap: 4.5svw;
  place-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.backgroundContainer {
  width: 100%;
  height: 100%;
}
.backgroundContainer > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.backgroundContainer:first-child > img {
  object-position: right bottom;
}
.backgroundContainer:nth-child(2) > img {
  object-position: left bottom;
}
.backgroundContainer:nth-child(3) > img {
  object-position: right top;
}
.backgroundContainer:nth-child(4) > img {
  object-position: left top;
}

/* 五向形状网格 */
.loaderGrid {
  position: fixed;
  display: grid;
  grid-template-columns: 1fr 28.125vw 1fr;
  grid-template-rows: auto auto auto;
  place-content: center;
  width: 100%;
  height: 100svh;
}
.loaderGrid img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.loaderGrid > .left {
  grid-column: 1;
  grid-row: 2;
}
.loaderGrid > .left > img {
  object-position: right;
}
.loaderGrid > .top {
  grid-column: 2;
  grid-row: 1;
}
.loaderGrid > .bottom {
  grid-column: 2;
  grid-row: 3;
}
.loaderGrid > .right {
  grid-column: 3;
  grid-row: 2;
}
.loaderGrid > .right > img {
  object-position: left;
}

/* 中心圆 */
.center {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  grid-column: 2;
  grid-row: 2;
  aspect-ratio: 1 / 1;
  clip-path: circle(50%);
  pointer-events: none;
}
.center::before {
  content: '';
  position: absolute;
  width: 100%;
  height: 100%;
  z-index: -2;
  background: url('/assets/images/3d/tmp-cdn-patch/images/loader_centerShape.webp') 50% / contain no-repeat;
  animation: rotation 60s linear infinite reverse;
}
.center::after {
  content: '';
  position: absolute;
  width: 100%;
  height: 100%;
  z-index: -1;
  background-color: var(--c-secondary);
  clip-path: circle(48%);
  transition: all 0.35s ease-in-out;
}
.center.-loaded {
  pointer-events: all;
  cursor: pointer;
}
.center.-loaded:hover::after {
  background-color: var(--c-primary);
}
.center.-loaded:hover .shape img {
  filter: invert(1);
}
.center.-entering > .transitionCenter {
  opacity: 1;
}
.center.-entering .shape {
  opacity: 0 !important;
}

.transitionCenter {
  position: absolute;
  width: 100%;
  height: 100%;
  z-index: 1;
  background-color: var(--c-primary);
  clip-path: circle(48%);
  opacity: 0;
  transition: opacity 0.5s cubic-bezier(0.87, 0, 0.13, 1);
}

.shape {
  width: 40%;
  height: 40%;
  opacity: 0;
  transition: opacity 0.5s cubic-bezier(0.87, 0, 0.13, 1);
}
.center.-loaded .shape,
.center.-entering .shape {
  opacity: 1;
}
.shape img {
  width: 100%;
  height: 100%;
  transition: filter 0.25s ease-in-out;
}

/* 进度 / 进入按钮 */
.loadingStep {
  position: absolute;
  bottom: 0;
  display: flex;
  justify-content: center;
  width: 100%;
}
.counter {
  position: absolute;
  bottom: 58px;
  width: 74%;
  text-align: center;
  opacity: 0;
  transition: opacity 1s linear;
}
.loader.-mounted .counter {
  opacity: 1;
}
.percentage {
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 2px;
  line-height: 100%;
  text-transform: uppercase;
}
.counter {
  opacity: 1;
}

.action {
  position: absolute;
  bottom: 2px;
  display: flex;
  justify-content: center;
  width: 100%;
  transform: translateY(100%);
  opacity: 0;
  transition: opacity 0.5s cubic-bezier(0.87, 0, 0.13, 1), transform 0.5s cubic-bezier(0.87, 0, 0.13, 1);
}
.center.-loaded .action,
.center.-entering .action {
  transform: translateY(0);
  opacity: 1;
}
.loadingCta {
  padding: 13px 44px;
  border: 1px solid var(--c-primary);
  border-radius: 999px;
  color: var(--c-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.36px;
  line-height: 12px;
  text-transform: uppercase;
  transition: all 0.35s ease-in-out;
}
.loadingCta:hover {
  background: var(--c-primary);
  color: var(--c-secondary);
}

/* 底部黑条 */
.footerBackground {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 63px;
  background-color: var(--c-secondary);
  z-index: 10;
}

@keyframes rotation {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
