// Nuxt 4 配置 — FastBike 项目（第二阶段：项目初始化）
export default defineNuxtConfig({
  compatibilityDate: '2026-11-11',

  // 全局 CSS（含第一阶段提取的 Kern 字体声明），所有页面生效
  css: ['~/assets/css/main.css'],

  // 关闭 Nuxt DevTools：dev 环境下的悬浮面板会遮挡 3D 画面，影响与原站逐像素比对
  devtools: { enabled: false },

  // 消除 Vite 首次运行时的依赖预打包提示，并避免运行时发现 CJS 依赖导致页面重载
  vite: {
    optimizeDeps: {
      include: ['@vue/devtools-core', 'howler', 'lottie-web']
    }
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'FastBike · 3D 摩托车体验站',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: '基于抓包提取的 3D 资源（GLB / KTX2 / Draco / Lottie / Theatre.js）构建的 Nuxt + Three.js 摩托车体验项目'
        }
      ],
      link: [
        // 使用第一阶段提取的站点原始 favicon
        { rel: 'icon', type: 'image/svg+xml', href: '/assets/images/3d/tmp-cdn-patch/favicon.svg' }
      ]
    }
  }
})
