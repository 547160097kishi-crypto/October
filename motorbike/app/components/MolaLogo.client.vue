<template>
  <div ref="holder" class="yame-logo" aria-label="Yamê ÉBĒM" />
</template>

<script setup lang="ts">
// Lottie Logo（第一阶段提取的 logo_anim_v3.json，800×400，60fps）
import lottie, { type AnimationItem } from 'lottie-web'

const props = withDefaults(defineProps<{ loop?: boolean; autoplay?: boolean }>(), {
  loop: false,
  autoplay: true
})

const holder = ref<HTMLElement | null>(null)
let anim: AnimationItem | null = null
let destroyed = false

onMounted(async () => {
  try {
    const animationData = await $fetch<Record<string, unknown>>(
      '/assets/animations/3d/tmp-cdn-patch/logo_anim_v3.json'
    )
    if (destroyed || !holder.value) return

    anim = lottie.loadAnimation({
      container: holder.value,
      renderer: 'svg',
      loop: props.loop,
      autoplay: props.autoplay,
      animationData,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        progressiveLoad: false
      }
    })
    anim.addEventListener('DOMLoaded', () => {
      // 动画首帧可能全透明，确保停在有内容的位置
      if (!props.autoplay) anim?.goToAndStop(0, true)
    })
  } catch (err) {
    console.error('[MolaLogo] Lottie 初始化失败:', err)
  }
})

onBeforeUnmount(() => {
  destroyed = true
  anim?.destroy()
  anim = null
})
</script>

<style scoped>
.yame-logo {
  width: 100px;
  height: 50px;
}
:deep(svg) {
  width: 100% !important;
  height: 100% !important;
}
</style>
