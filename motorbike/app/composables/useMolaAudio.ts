/**
 * Now Playing 音频控制器
 * 优先使用 Howler（HTML5 模式）；若 CJS 互操作或浏览器策略导致不可用，自动回退原生 Audio。
 * 音源：第一阶段提取的电台音频 BIZARRE.mp3（876 KB）
 */

type Controller = {
  play: () => Promise<void>
  pause: () => void
  isPlaying: () => boolean
  setMuted: (muted: boolean) => void
}

let controller: Controller | null = null

export function useMolaAudio() {
  const isPlaying = ref(false)
  const isMuted = ref(false)
  const isReady = ref(false)
  const trackTitle = ref('YAMÊ, BIZARRE (INSTRUMENTAL)')
  const trackSrc = '/assets/audio/3d/tmp-cdn-patch/audios/radio/BIZARRE.mp3'

  async function ensure() {
    if (controller || !import.meta.client) return

    // 1) 尝试 Howler（howler 为 UMD 包，不同打包器可能只暴露 default）
    try {
      const mod: Record<string, unknown> = await import('howler')
      const candidate =
        (mod.Howl as unknown) ??
        ((mod.default as Record<string, unknown> | undefined)?.Howl) ??
        (mod.default as unknown)

      if (typeof candidate === 'function') {
        const HowlCtor = candidate as new (opts: Record<string, unknown>) => any
        const h = new HowlCtor({
          src: [trackSrc],
          // html5: true 会走 <audio> 池，移动端容易 "HTML5 Audio pool exhausted"；
          // 只有一路音轨时用 Web Audio 解码播放更稳（876 KB，可接受）
          html5: false,
          loop: true,
          volume: 0.55,
          preload: true
        })
        h.on('play', () => { isPlaying.value = true })
        h.on('pause', () => { isPlaying.value = false })
        h.on('stop', () => { isPlaying.value = false })
        h.on('playerror', (_id: number, err: unknown) => {
          console.error('[audio] Howler 播放失败，回退原生 Audio', err)
          controller = null
          isPlaying.value = false
        })
        controller = {
          play: async () => { if (!h.playing()) h.play() },
          pause: () => h.pause(),
          isPlaying: () => Boolean(h.playing()),
          setMuted: (muted: boolean) => h.mute(muted)
        }
        isReady.value = true
        return
      }
      console.warn('[audio] 未找到 Howl 构造函数，使用原生 Audio')
    } catch (err) {
      console.error('[audio] Howler 初始化异常，使用原生 Audio', err)
    }

    // 2) 原生 Audio 回退
    const el = new Audio(trackSrc)
    el.loop = true
    el.volume = 0.55
    el.preload = 'auto'
    el.addEventListener('play', () => { isPlaying.value = true })
    el.addEventListener('pause', () => { isPlaying.value = false })
    controller = {
      play: async () => { await el.play() },
      pause: () => el.pause(),
      isPlaying: () => !el.paused,
      setMuted: (muted: boolean) => { el.muted = muted }
    }
    isReady.value = true
  }

  /** 由用户手势触发（浏览器自动播放策略） */
  async function play() {
    await ensure()
    if (!controller) return
    try {
      await controller.play()
      isPlaying.value = true
    } catch (err) {
      // 自动播放被拦截时静默处理：用户点击 ON 按钮即可恢复
      console.warn('[audio] 播放被浏览器拦截或失败：', err)
      isPlaying.value = false
    }
  }

  function pause() {
    controller?.pause()
    isPlaying.value = false
  }

  async function toggle() {
    await ensure()
    if (!controller) return
    if (controller.isPlaying()) {
      controller.pause()
      isPlaying.value = false
    } else {
      await play()
    }
  }

  function toggleMute() {
    isMuted.value = !isMuted.value
    controller?.setMuted(isMuted.value)
  }

  return { isPlaying, isMuted, isReady, trackTitle, trackSrc, play, pause, toggle, toggleMute }
}
