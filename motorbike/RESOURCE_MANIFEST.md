# RESOURCE_MANIFEST.md

> 第一阶段成果：HAR 资源分析与提取。**本阶段不包含网页开发。**

| 项目 | 值 |
| --- | --- |
| 源 HAR 文件 | `E:\文档\摩托车抓包\download` |
| 源文件大小 | 26.39 MiB (27,672,616 B) |
| HAR 版本 / 抓取工具 | 1.2 / WebInspector 537.36 (Chrome DevTools) |
| 抓取页面 | `https://mola-zone.com/en?ref=landing.love` |
| 抓取时间 (UTC) | 2026-11-11T02:01:58.349Z |
| 请求总数 | 135 |
| 成功提取文件 | 93 个，共 20.07 MiB |
| 完整性校验 | **93 / 93 通过，0 损坏** |
| 提取根目录 | `E:/workbuddy/fastbike/extracted/` |

## 1. 结论速览

**可以直接使用（开箱即用，无需解码器）**：

- 全部 **图片 / 纹理**（WebP、PNG、JPEG、SVG、ICO）、**7 个 MP3 音频**、**3 个 WOFF2 字体** —— 二进制均已从 Base64 还原并逐一通过魔数与长度校验。
- **logo_anim_v3.json**（Lottie 5.7.0，800×400，60fps，4.98s，资源全内嵌无外链）与 **state_v9.json**（Theatre.js 0.4.0 状态表）—— JSON 可解析、数据自包含。
- 全部 **HTML / CSS / JS** 构建产物（明文，可直接查看或留档复用）。

**可以直接使用，但必须配套 HAR 中已抓到的解码器**：

- 3 个 **GLB 模型**：均使用 `KHR_draco_mesh_compression`；`scene_v6.16.4.glb` 与 `bike_v9.7.glb` 还使用 `KHR_texture_basisu`（KTX2 纹理）。
- 所需解码器 **Draco 1.5.7 (JS + WASM)** 与 **Basis transcoder (JS + WASM)** 已完整抓取并提取到 `extracted/decoders/`，因此 **不缺解码器**。
- 其中 `oiseau_v1.glb` 依赖最少（仅 Draco + 内嵌 PNG 贴图），是三个模型里最容易直接加载的。

**不能直接使用的**：2 个 HTTP 503 的 Nuxt chunk（`BTEu00bY.js`、`BdRKPyVd.js`）响应体为空且未重试成功；hcaptcha 的 2 个 `logo.png` 为空；第三方统计/验证码脚本存在跨域与授权限制。

> 提示：这些资源来自第三方站点的抓包，复用前请确认版权与使用授权。

## 2. HAR 解析与总体统计

### 2.1 HTTP 状态码分布

| 状态码 | 数量 | 说明 |
| --- | ---: | --- |
| 200 | 109 | 成功（含重复请求） |
| 304 | 16 | 缓存命中，HAR 未保存响应体 |
| 202 | 5 | 已接受（埋点上报，无资源） |
| 503 | 3 | 服务端错误，响应体为空 |
| 301 | 1 | 重定向 |
| 204 | 1 | 无内容 |

### 2.2 MIME 类型分布（全部 135 条请求）

| MIME | 数量 |
| --- | ---: |
| `application/json` | 24 |
| `font/woff2` | 19 |
| `application/javascript` | 18 |
| `image/webp` | 15 |
| `text/css` | 10 |
| `text/plain` | 9 |
| `image/svg+xml` | 8 |
| `image/png` | 8 |
| `audio/mpeg` | 7 |
| `text/html` | 4 |
| `image/jpeg` | 3 |
| `application/octet-stream` | 3 |
| `text/javascript` | 2 |
| `image/vnd.microsoft.icon` | 2 |
| `application/wasm` | 2 |
| `application/speculationrules+json` | 1 |

### 2.3 资源分类统计

| 分类 | 请求数 | 提取文件数 | 提取字节 | 占比 |
| --- | ---: | ---: | ---: | ---: |
| 3D 模型 (GLB / GLTF) | 3 | 3 | 9.38 MiB | 46.8% |
| 3D 场景 / 状态 JSON | 1 | 1 | 189.2 KiB | 0.9% |
| 动画 JSON | 2 | 1 | 28.4 KiB | 0.1% |
| 解码器 / 运行时依赖 | 4 | 4 | 903.0 KiB | 4.4% |
| 纹理贴图 | 12 | 12 | 648.0 KiB | 3.2% |
| 图片 / UI 素材 | 22 | 19 | 831.1 KiB | 4.0% |
| 字体 | 19 | 3 | 77.3 KiB | 0.4% |
| 音频 | 7 | 7 | 2.94 MiB | 14.7% |
| HTML | 2 | 1 | 141.4 KiB | 0.7% |
| CSS | 10 | 10 | 94.1 KiB | 0.5% |
| JavaScript | 17 | 14 | 2.16 MiB | 10.8% |
| 数据 / 配置 JSON | 22 | 12 | 144.7 KiB | 0.7% |
| 第三方脚本（不建议复用） | 14 | 6 | 2.59 MiB | 12.9% |
| **合计** | **135** | **93** | **20.07 MiB** | **100%** |

### 2.4 传输体积与 HTTP 压缩

| 指标 | 值 |
| --- | --- |
| content.size 总和（解压后） | 21.21 MiB |
| _transferSize 总和（网络传输，含头） | 16.04 MiB |
| 实际提取文件字节总和 | 20.07 MiB |

响应头 `content-encoding` 分布：

| 编码 | 数量 | 说明 |
| --- | ---: | --- |
| `(none)` | 66 | 无压缩 |
| `br` | 37 | DevTools 已解压后再写入 HAR |
| `zstd` | 27 | DevTools 已解压后再写入 HAR |
| `gzip` | 5 | DevTools 已解压后再写入 HAR |

**重要**：Chrome DevTools 写入 HAR 的 `content.text` / `content.size` 是**解压后**的响应体。已抽查 `zstd` / `br` / `gzip` 条目，提取结果为明文 HTML/CSS/JS（例如 `gpNsPhdA.js` 以 `const __vite__mapDeps=` 开头）。因此本地**无需** brotli / zstd 解码器，也不会出现二次解压问题。

### 2.5 重复请求与去重

- 135 条请求映射到 100 个唯一 URL 路径；其中 93 个有可用响应体并已落盘。
- 去重策略：同一输出路径保留 `status=200` 且响应体最完整的条目；重复请求（如 `logo_anim_v3.json` ×2、`favicon.svg` ×2、`_payload.json` 系列、304 字体）只导出一份。
- 全部 93 个文件的解码字节数与 HAR `content.size` **100% 一致**（0 处不一致）。

## 3. 分类资源清单

> 「校验」列：`OK` = 魔数/长度/结构/编码全部通过。`提取路径` 均相对于 `extracted/`。

### 3.1 3D 模型 (GLB / GLTF)（3 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `bike_v9.7.glb` | 3.02 MiB | GLB(glTF 2.0 binary) | OK | `models/3d/Library/bike/bike_v9.7.glb` | `https://mola-zone.com/3d/Library/bike/bike_v9.7.glb` |
| `oiseau_v1.glb` | 33.1 KiB | GLB(glTF 2.0 binary) | OK | `models/3d/Library/oiseau_v1.glb` | `https://mola-zone.com/3d/Library/oiseau_v1.glb` |
| `scene_v6.16.4.glb` | 6.32 MiB | GLB(glTF 2.0 binary) | OK | `models/3d/Scene/scene_v6.16.4.glb` | `https://mola-zone.com/3d/Scene/scene_v6.16.4.glb` |

### 3.2 3D 场景 / 状态 JSON（1 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `state_v9.json` | 189.2 KiB | JSON | OK | `scenes/3d/state_v9.json` | `https://mola-zone.com/3d/state_v9.json` |

### 3.3 动画 JSON（1 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `logo_anim_v3.json` | 28.4 KiB | JSON | OK | `animations/3d/tmp-cdn-patch/logo_anim_v3.json` | `https://mola-zone.com/3d/tmp-cdn-patch/logo_anim_v3.json` |

### 3.4 解码器 / 运行时依赖（4 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `basis_transcoder.js` | 78.1 KiB | application/javascript | OK | `decoders/3d/basis/basis_transcoder.js` | `https://mola-zone.com/3d/basis/basis_transcoder.js` |
| `basis_transcoder.wasm` | 488.2 KiB | WebAssembly | OK | `decoders/3d/basis/basis_transcoder.wasm` | `https://mola-zone.com/3d/basis/basis_transcoder.wasm` |
| `draco_decoder.wasm` | 279.2 KiB | WebAssembly | OK | `decoders/www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.wasm` | `https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.wasm` |
| `draco_wasm_wrapper.js` | 57.4 KiB | text/javascript | OK | `decoders/www.gstatic.com/draco/versioned/decoders/1.5.7/draco_wasm_wrapper.js` | `https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_wasm_wrapper.js` |

### 3.5 纹理贴图（12 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `B_marble.webp` | 49.2 KiB | WebP | OK | `textures/3d/Library/ground/B_marble.webp` | `https://mola-zone.com/3d/Library/ground/B_marble.webp` |
| `G_sand.webp` | 16.0 KiB | WebP | OK | `textures/3d/Library/ground/G_sand.webp` | `https://mola-zone.com/3d/Library/ground/G_sand.webp` |
| `R_rock.webp` | 89.4 KiB | WebP | OK | `textures/3d/Library/ground/R_rock.webp` | `https://mola-zone.com/3d/Library/ground/R_rock.webp` |
| `blendmap.webp` | 71.8 KiB | WebP | OK | `textures/3d/Library/ground/blendmap.webp` | `https://mola-zone.com/3d/Library/ground/blendmap.webp` |
| `map_ground_v2.1.webp` | 85.1 KiB | WebP | OK | `textures/3d/Library/ground/map_ground_v2.1.webp` | `https://mola-zone.com/3d/Library/ground/map_ground_v2.1.webp` |
| `noise.webp` | 195.4 KiB | WebP | OK | `textures/3d/Library/ground/noise.webp` | `https://mola-zone.com/3d/Library/ground/noise.webp` |
| `skybox-day.jpg` | 19.7 KiB | JPEG | OK | `textures/3d/Library/ground/skybox-day.jpg` | `https://mola-zone.com/3d/Library/ground/skybox-day.jpg` |
| `skybox-night.png` | 15.3 KiB | PNG | OK | `textures/3d/Library/ground/skybox-night.png` | `https://mola-zone.com/3d/Library/ground/skybox-night.png` |
| `sea_foam_albedo.jpg` | 90.1 KiB | JPEG | OK | `textures/3d/Library/water/sea_foam_albedo.jpg` | `https://mola-zone.com/3d/Library/water/sea_foam_albedo.jpg` |
| `water.jpeg` | 11.5 KiB | JPEG | OK | `textures/3d/Library/water/water.jpeg` | `https://mola-zone.com/3d/Library/water/water.jpeg` |
| `dust.png` | 4.3 KiB | PNG | OK | `textures/3d/texture/dust.png` | `https://mola-zone.com/3d/texture/dust.png` |
| `three-tone.png` | 131 B | PNG | OK | `textures/3d/texture/three-tone.png` | `https://mola-zone.com/3d/texture/three-tone.png` |

### 3.6 图片 / UI 素材（19 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `favicon-196x196.png` | 7.7 KiB | PNG | OK | `images/3d/tmp-cdn-patch/favicon-196x196.png` | `https://mola-zone.com/3d/tmp-cdn-patch/favicon-196x196.png` |
| `favicon.ico` | 33.7 KiB | ICO | OK | `images/3d/tmp-cdn-patch/favicon.ico` | `https://mola-zone.com/3d/tmp-cdn-patch/favicon.ico` |
| `favicon.svg` | 14.1 KiB | SVG/XML | OK | `images/3d/tmp-cdn-patch/favicon.svg` | `https://mola-zone.com/3d/tmp-cdn-patch/favicon.svg` |
| `arrows.png` | 471 B | PNG | OK | `images/3d/tmp-cdn-patch/images/arrows.png` | `https://mola-zone.com/3d/tmp-cdn-patch/images/arrows.png` |
| `chevron.svg` | 154 B | SVG/XML | OK | `images/3d/tmp-cdn-patch/images/chevron.svg` | `https://mola-zone.com/3d/tmp-cdn-patch/images/chevron.svg` |
| `instagram.svg` | 1.2 KiB | SVG/XML | OK | `images/3d/tmp-cdn-patch/images/instagram.svg` | `https://mola-zone.com/3d/tmp-cdn-patch/images/instagram.svg` |
| `loader_background01.webp` | 157.7 KiB | WebP | OK | `images/3d/tmp-cdn-patch/images/loader_background01.webp` | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_background01.webp` |
| `loader_background02.webp` | 110.1 KiB | WebP | OK | `images/3d/tmp-cdn-patch/images/loader_background02.webp` | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_background02.webp` |
| `loader_background03.webp` | 58.5 KiB | WebP | OK | `images/3d/tmp-cdn-patch/images/loader_background03.webp` | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_background03.webp` |
| `loader_background04.webp` | 94.6 KiB | WebP | OK | `images/3d/tmp-cdn-patch/images/loader_background04.webp` | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_background04.webp` |
| `loader_bottomShape.webp` | 71.9 KiB | WebP | OK | `images/3d/tmp-cdn-patch/images/loader_bottomShape.webp` | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_bottomShape.webp` |
| `loader_centerShape.webp` | 17.7 KiB | WebP | OK | `images/3d/tmp-cdn-patch/images/loader_centerShape.webp` | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_centerShape.webp` |
| `loader_leftShape.webp` | 101.6 KiB | WebP | OK | `images/3d/tmp-cdn-patch/images/loader_leftShape.webp` | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_leftShape.webp` |
| `loader_rightShape.webp` | 99.9 KiB | WebP | OK | `images/3d/tmp-cdn-patch/images/loader_rightShape.webp` | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_rightShape.webp` |
| `loader_topShape.webp` | 57.5 KiB | WebP | OK | `images/3d/tmp-cdn-patch/images/loader_topShape.webp` | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_topShape.webp` |
| `nav-focus-icon.svg` | 3.2 KiB | SVG/XML | OK | `images/3d/tmp-cdn-patch/images/nav-focus-icon.svg` | `https://mola-zone.com/3d/tmp-cdn-patch/images/nav-focus-icon.svg` |
| `stroke-normal.svg` | 368 B | SVG/XML | OK | `images/3d/tmp-cdn-patch/images/stroke-normal.svg` | `https://mola-zone.com/3d/tmp-cdn-patch/images/stroke-normal.svg` |
| `tiktok.svg` | 323 B | SVG/XML | OK | `images/3d/tmp-cdn-patch/images/tiktok.svg` | `https://mola-zone.com/3d/tmp-cdn-patch/images/tiktok.svg` |
| `youtube.svg` | 329 B | SVG/XML | OK | `images/3d/tmp-cdn-patch/images/youtube.svg` | `https://mola-zone.com/3d/tmp-cdn-patch/images/youtube.svg` |

### 3.7 字体（3 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `Kern-Bold.woff2` | 25.9 KiB | WOFF2 | OK | `fonts/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| `Kern-Medium.woff2` | 26.0 KiB | WOFF2 | OK | `fonts/3d/tmp-cdn-patch/fonts/Kern/Kern-Medium.woff2` | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Medium.woff2` |
| `Kern-Regular.woff2` | 25.4 KiB | WOFF2 | OK | `fonts/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |

### 3.8 音频（7 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `SFX_desert.mp3` | 212.4 KiB | MP3 | OK | `audio/3d/tmp-cdn-patch/audios/SFX_desert.mp3` | `https://mola-zone.com/3d/tmp-cdn-patch/audios/SFX_desert.mp3` |
| `SFX_forest.mp3` | 106.6 KiB | MP3 | OK | `audio/3d/tmp-cdn-patch/audios/SFX_forest.mp3` | `https://mola-zone.com/3d/tmp-cdn-patch/audios/SFX_forest.mp3` |
| `motor-cruise.mp3` | 513.2 KiB | MP3 | OK | `audio/3d/tmp-cdn-patch/audios/motor-cruise.mp3` | `https://mola-zone.com/3d/tmp-cdn-patch/audios/motor-cruise.mp3` |
| `motor-stopped.mp3` | 44.3 KiB | MP3 | OK | `audio/3d/tmp-cdn-patch/audios/motor-stopped.mp3` | `https://mola-zone.com/3d/tmp-cdn-patch/audios/motor-stopped.mp3` |
| `BIZARRE.mp3` | 856.1 KiB | MP3 | OK | `audio/3d/tmp-cdn-patch/audios/radio/BIZARRE.mp3` | `https://mola-zone.com/3d/tmp-cdn-patch/audios/radio/BIZARRE.mp3` |
| `CELINE.mp3` | 1.18 MiB | MP3 | OK | `audio/3d/tmp-cdn-patch/audios/radio/CELINE.mp3` | `https://mola-zone.com/3d/tmp-cdn-patch/audios/radio/CELINE.mp3` |
| `reverb.mp3` | 72.4 KiB | MP3 | OK | `audio/3d/tmp-cdn-patch/audios/reverb.mp3` | `https://mola-zone.com/3d/tmp-cdn-patch/audios/reverb.mp3` |

### 3.9 HTML（1 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `index.html` | 141.4 KiB | HTML | OK | `html/en/index.html` | `https://mola-zone.com/en/?ref=landing.love` |

### 3.10 CSS（10 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `FormField.CmJslRV7.css` | 2.0 KiB | CSS | OK | `css/_nuxt/FormField.CmJslRV7.css` | `https://mola-zone.com/_nuxt/FormField.CmJslRV7.css` |
| `credits.Ct6LYxGg.css` | 1.6 KiB | CSS | OK | `css/_nuxt/credits.Ct6LYxGg.css` | `https://mola-zone.com/_nuxt/credits.Ct6LYxGg.css` |
| `entry.B2OHENv6.css` | 63.7 KiB | CSS | OK | `css/_nuxt/entry.B2OHENv6.css` | `https://mola-zone.com/_nuxt/entry.B2OHENv6.css` |
| `molazone.D9f-kKp9.css` | 4.3 KiB | CSS | OK | `css/_nuxt/molazone.D9f-kKp9.css` | `https://mola-zone.com/_nuxt/molazone.D9f-kKp9.css` |
| `premium.BUj5YXut.css` | 12.1 KiB | CSS | OK | `css/_nuxt/premium.BUj5YXut.css` | `https://mola-zone.com/_nuxt/premium.BUj5YXut.css` |
| `radio.DjQLCONZ.css` | 1.2 KiB | CSS | OK | `css/_nuxt/radio.DjQLCONZ.css` | `https://mola-zone.com/_nuxt/radio.DjQLCONZ.css` |
| `roi.BoUQHJvp.css` | 1.2 KiB | CSS | OK | `css/_nuxt/roi.BoUQHJvp.css` | `https://mola-zone.com/_nuxt/roi.BoUQHJvp.css` |
| `shop.kCGlADTP.css` | 3.3 KiB | CSS | OK | `css/_nuxt/shop.kCGlADTP.css` | `https://mola-zone.com/_nuxt/shop.kCGlADTP.css` |
| `tourdates.D-K9VRmN.css` | 2.5 KiB | CSS | OK | `css/_nuxt/tourdates.D-K9VRmN.css` | `https://mola-zone.com/_nuxt/tourdates.D-K9VRmN.css` |
| `video.FwYnGhR5.css` | 2.2 KiB | CSS | OK | `css/_nuxt/video.FwYnGhR5.css` | `https://mola-zone.com/_nuxt/video.FwYnGhR5.css` |

### 3.11 JavaScript（14 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `BBmSEAfM.js` | 1.4 KiB | JavaScript | OK | `js/_nuxt/BBmSEAfM.js` | `https://mola-zone.com/_nuxt/BBmSEAfM.js` |
| `BTkscHHv.js` | 136 B | JavaScript | OK | `js/_nuxt/BTkscHHv.js` | `https://mola-zone.com/_nuxt/BTkscHHv.js` |
| `BX-hYl93.js` | 158 B | JavaScript | OK | `js/_nuxt/BX-hYl93.js` | `https://mola-zone.com/_nuxt/BX-hYl93.js` |
| `C6iblEAH.js` | 913 B | JavaScript | OK | `js/_nuxt/C6iblEAH.js` | `https://mola-zone.com/_nuxt/C6iblEAH.js` |
| `C9MRYmc3.js` | 1.8 KiB | JavaScript | OK | `js/_nuxt/C9MRYmc3.js` | `https://mola-zone.com/_nuxt/C9MRYmc3.js` |
| `Cb-8nAAM.js` | 682 B | JavaScript | OK | `js/_nuxt/Cb-8nAAM.js` | `https://mola-zone.com/_nuxt/Cb-8nAAM.js` |
| `DJvR05L8.js` | 2.5 KiB | JavaScript | OK | `js/_nuxt/DJvR05L8.js` | `https://mola-zone.com/_nuxt/DJvR05L8.js` |
| `DQq2lNzJ.js` | 1.3 KiB | JavaScript | OK | `js/_nuxt/DQq2lNzJ.js` | `https://mola-zone.com/_nuxt/DQq2lNzJ.js` |
| `DruHaZim.js` | 17.2 KiB | JavaScript | OK | `js/_nuxt/DruHaZim.js` | `https://mola-zone.com/_nuxt/DruHaZim.js` |
| `DyW3_eXW.js` | 826 B | JavaScript | OK | `js/_nuxt/DyW3_eXW.js` | `https://mola-zone.com/_nuxt/DyW3_eXW.js` |
| `JN6A2mNk.js` | 8.3 KiB | JavaScript | OK | `js/_nuxt/JN6A2mNk.js` | `https://mola-zone.com/_nuxt/JN6A2mNk.js` |
| `gpNsPhdA.js` | 2.11 MiB | JavaScript | OK | `js/_nuxt/gpNsPhdA.js` | `https://mola-zone.com/_nuxt/gpNsPhdA.js` |
| `l6e20DzW.js` | 4.5 KiB | JavaScript | OK | `js/_nuxt/l6e20DzW.js` | `https://mola-zone.com/_nuxt/l6e20DzW.js` |
| `rocket-loader.min.js` | 12.0 KiB | JavaScript | OK | `js/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js` | `https://mola-zone.com/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js` |

### 3.12 数据 / 配置 JSON（12 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `leaderboard.json` | 18 B | JSON | OK | `data/.netlify/functions/leaderboard.json` | `https://mola-zone.com/.netlify/functions/leaderboard` |
| `87806528-efd4-4924-9449-95ff46fefcc2.json` | 607 B | JSON | OK | `data/_nuxt/builds/meta/87806528-efd4-4924-9449-95ff46fefcc2.json` | `https://mola-zone.com/_nuxt/builds/meta/87806528-efd4-4924-9449-95ff46fefcc2.json` |
| `speculation.json` | 151 B | JSON | OK | `data/cdn-cgi/speculation.json` | `https://mola-zone.com/cdn-cgi/speculation` |
| `_payload.json` | 69 B | JSON | OK | `data/en/_payload.json` | `https://mola-zone.com/en/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| `_payload.json` | 69 B | JSON | OK | `data/en/posts/credits/_payload.json` | `https://mola-zone.com/en/posts/credits/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| `_payload.json` | 69 B | JSON | OK | `data/en/posts/molazone/_payload.json` | `https://mola-zone.com/en/posts/molazone/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| `_payload.json` | 69 B | JSON | OK | `data/en/posts/premium/_payload.json` | `https://mola-zone.com/en/posts/premium/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| `_payload.json` | 69 B | JSON | OK | `data/en/posts/radio/_payload.json` | `https://mola-zone.com/en/posts/radio/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| `_payload.json` | 69 B | JSON | OK | `data/en/posts/roi/_payload.json` | `https://mola-zone.com/en/posts/roi/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| `_payload.json` | 69 B | JSON | OK | `data/en/posts/shop/_payload.json` | `https://mola-zone.com/en/posts/shop/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| `_payload.json` | 69 B | JSON | OK | `data/en/posts/tourdates/_payload.json` | `https://mola-zone.com/en/posts/tourdates/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| `d-nvidia.json` | 143.4 KiB | JSON | OK | `data/unpkg.com/detect-gpu@5.0.70/dist/benchmarks/d-nvidia.json` | `https://unpkg.com/detect-gpu@5.0.70/dist/benchmarks/d-nvidia.json` |

### 3.13 第三方脚本（不建议复用）（6 个）

| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |
| --- | ---: | --- | :---: | --- | --- |
| `checksiteconfig.json` | 917 B | JSON | OK | `third-party/api.hcaptcha.com/checksiteconfig.json` | `https://api.hcaptcha.com/checksiteconfig?v=b7cb55144cfb1f79ab8b18a24ea5786dc178370e&host=mola-zone.com&sitekey=316e5a4a-73ce-4fba-a75e-1682354cbcf6&sc=1&swa=1&spst=1` |
| `api.js` | 409.8 KiB | application/javascript | OK | `third-party/js.hcaptcha.com/1/api.js` | `https://js.hcaptcha.com/1/api.js?hl=fr` |
| `hsw.js` | 1.49 MiB | application/javascript | OK | `third-party/newassets.hcaptcha.com/c/bddd3aa2629b4bd972d50f1b7d788bf71dcd9dc47dfc2e029484ee008b231476/hsw.js` | `https://newassets.hcaptcha.com/c/bddd3aa2629b4bd972d50f1b7d788bf71dcd9dc47dfc2e029484ee008b231476/hsw.js` |
| `hcaptcha.html` | 681.4 KiB | text/html | OK | `third-party/newassets.hcaptcha.com/captcha/v1/b7cb55144cfb1f79ab8b18a24ea5786dc178370e/static/hcaptcha.html` | `https://newassets.hcaptcha.com/captcha/v1/b7cb55144cfb1f79ab8b18a24ea5786dc178370e/static/hcaptcha.html` |
| `script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js` | 4.7 KiB | application/javascript | OK | `third-party/plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js` | `https://plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js` |
| `vce701823e78c4301a35b7e07294d87301792088814092.js` | 31.1 KiB | text/javascript | OK | `third-party/static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d87301792088814092.js` | `https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d87301792088814092` |

## 4. 重点文件深度检查

### 4.1 GLB 模型三件套

#### `scene_v6.16.4.glb`

| 属性 | 值 |
| --- | --- |
| 请求序号 / 状态 | #72 / HTTP 200 |
| 原始 URL | `https://mola-zone.com/3d/Scene/scene_v6.16.4.glb` |
| MIME / HAR 编码 | `application/octet-stream` / base64 |
| 解码后大小 | 6.32 MiB (6,631,384 B) |
| 提取路径 | `extracted/models/3d/Scene/scene_v6.16.4.glb` |
| 完整性 | OK: magic/version/length/chunks 全部一致；JSON / BIN chunk 齐全，声明长度 == 实际长度 |
| 生成器 | glTF-Transform v4.2.0 |
| 结构 | {'scenes': 1, 'nodes': 168, 'meshes': 118, 'materials': 100, 'images': 58, 'textures': 58, 'samplers': 1, 'buffers': 1, 'bufferViews': 222, 'accessors': 615} |
| 必需扩展 (`extensionsRequired`) | `KHR_draco_mesh_compression, KHR_texture_basisu, KHR_texture_transform` |
| 使用扩展 (`extensionsUsed`) | `EXT_mesh_gpu_instancing, KHR_draco_mesh_compression, KHR_materials_specular, KHR_materials_unlit, KHR_texture_basisu, KHR_texture_transform` |
| 贴图格式 | {'image/ktx2': 58}；KTX2/BasisU 贴图 58 张 |
| Draco 压缩 primitive | 124 个 |
| 外部依赖 | 图片 URI 0 个 / buffer URI 0 个 → **全部内嵌，无外链** |
| 内置动画 | 无（静态模型） |

#### `bike_v9.7.glb`

| 属性 | 值 |
| --- | --- |
| 请求序号 / 状态 | #80 / HTTP 200 |
| 原始 URL | `https://mola-zone.com/3d/Library/bike/bike_v9.7.glb` |
| MIME / HAR 编码 | `application/octet-stream` / base64 |
| 解码后大小 | 3.02 MiB (3,171,448 B) |
| 提取路径 | `extracted/models/3d/Library/bike/bike_v9.7.glb` |
| 完整性 | OK: magic/version/length/chunks 全部一致；JSON / BIN chunk 齐全，声明长度 == 实际长度 |
| 生成器 | glTF-Transform v4.2.0 |
| 结构 | {'scenes': 1, 'nodes': 105, 'meshes': 14, 'materials': 12, 'animations': 12, 'images': 11, 'textures': 11, 'samplers': 1, 'buffers': 1, 'bufferViews': 32, 'accessors': 539, 'skins': 1} |
| 必需扩展 (`extensionsRequired`) | `KHR_draco_mesh_compression, KHR_texture_basisu` |
| 使用扩展 (`extensionsUsed`) | `KHR_draco_mesh_compression, KHR_materials_specular, KHR_materials_transmission, KHR_texture_basisu` |
| 贴图格式 | {'image/ktx2': 11}；KTX2/BasisU 贴图 11 张 |
| Draco 压缩 primitive | 14 个 |
| 外部依赖 | 图片 URI 0 个 / buffer URI 0 个 → **全部内嵌，无外链** |
| 内置动画（12 个） | `Idle Action, Left Action, Right Action, Head Character Action, Idle Character Action, Left Character Action, Right Character Action, Stop Action, wind_float, wind_influence, Left Axle Action, Right Axle Action` |

#### `oiseau_v1.glb`

| 属性 | 值 |
| --- | --- |
| 请求序号 / 状态 | #89 / HTTP 200 |
| 原始 URL | `https://mola-zone.com/3d/Library/oiseau_v1.glb` |
| MIME / HAR 编码 | `application/octet-stream` / base64 |
| 解码后大小 | 33.1 KiB (33,936 B) |
| 提取路径 | `extracted/models/3d/Library/oiseau_v1.glb` |
| 完整性 | OK: magic/version/length/chunks 全部一致；JSON / BIN chunk 齐全，声明长度 == 实际长度 |
| 生成器 | Khronos glTF Blender I/O v4.4.55 |
| 结构 | {'scenes': 1, 'nodes': 1, 'meshes': 1, 'materials': 1, 'images': 1, 'textures': 1, 'samplers': 1, 'buffers': 1, 'bufferViews': 8, 'accessors': 8} |
| 必需扩展 (`extensionsRequired`) | `KHR_draco_mesh_compression` |
| 使用扩展 (`extensionsUsed`) | `KHR_draco_mesh_compression` |
| 贴图格式 | {'image/png': 1}；KTX2/BasisU 贴图 0 张 |
| Draco 压缩 primitive | 1 个 |
| 外部依赖 | 图片 URI 0 个 / buffer URI 0 个 → **全部内嵌，无外链** |
| 内置动画 | 无（静态模型） |

### 4.2 `state_v9.json`

| 属性 | 值 |
| --- | --- |
| 请求序号 / 状态 | #59 / HTTP 200 |
| 原始 URL | `https://mola-zone.com/3d/state_v9.json` |
| 大小 | 189.2 KiB (193,745 B)，纯文本 JSON（非 Base64） |
| 提取路径 | `extracted/scenes/3d/state_v9.json` |
| 类型 | Theatre.js 场景/动画状态 (state sheet) |
| definitionVersion | 0.4.0 |
| 顶层键 | `sheetsById, definitionVersion, revisionHistory` |
| revisionHistory | 50 条修订记录 |
| 字符串编码瑕疵 | 无 |

| Sheet 名 | 静态覆盖对象数 | 序列轨道数 |
| --- | ---: | ---: |
| `game` | 22 | 0 |
| `World` | 181 | 0 |
| `bike` | 26 | 0 |
| `Orbital Sequence` | 5 | 14 |

说明：这是 **Theatre.js 的状态/动画数据表**，记录场景对象（`objects / cactus_05_v1_reference / day` 等）的 `directColor` / `indirectColor` 等静态覆盖值，以及 `Orbital Sequence` 的 14 条相机/对象动画轨道。它**不是** glTF 场景文件，不含几何体；必须与 GLB 模型 + Theatre.js 运行时配合使用才有意义，数据本身完整可解析。

### 4.3 `logo_anim_v3.json`

| 属性 | 值 |
| --- | --- |
| 请求序号 / 状态 | #39, #40（重复请求，已去重）/ HTTP 200 |
| 原始 URL | `https://mola-zone.com/3d/tmp-cdn-patch/logo_anim_v3.json` |
| 大小 | 28.4 KiB (29,115 B)，纯文本 JSON（非 Base64） |
| 提取路径 | `extracted/animations/3d/tmp-cdn-patch/logo_anim_v3.json` |
| 类型 | Lottie / Bodymovin 动画，版本 5.7.0 |
| 画布 / 帧率 / 时长 | 800×400 / 60 fps / 约 4.98 s（0→299 帧） |
| 图层 | 2 个（均为预合成图层 `ty:0`） |
| assets | 2 个，**均为内嵌预合成图层（自带 layers）**，无外部图片 / 无 `u`/`p` 外链 |
| 生成工具 | `@lottiefiles/toolkit-js 0.63.1` |
| 字符串编码瑕疵 | **有 Mojibake**：图层名显示为 `Logo YamÃª Lottie`（UTF-8 被按 Latin-1 二次编码），不影响动画播放，仅影响图层名显示 |

说明：**完全自包含**，配合 `lottie-web` / `lottie-player` 即可直接播放 Logo 动画，无需任何额外素材。

## 5. Base64 与编码检查

- HAR 中共 **42 条** 响应以 `content.encoding = "base64"` 保存；其余 93 条中，69 条为明文 UTF-8 文本、24 条无响应体（304/503/204/202 等）。
- 这 42 条覆盖 40 个唯一提取文件：3 个 GLB、全部 WebP/PNG/JPEG/ICO 位图、7 个 MP3、3 个 WOFF2、2 个 WASM，以及 1 个 JS chunk（`DruHaZim.js`）。
- **提取时已全部 Base64 解码还原为原始二进制**，落盘文件不再带 Base64 包装；解码后字节数与 `content.size` 逐一比对，93/93 一致。

| 保存方式 | 涉及文件数 | 主要类型 |
| --- | ---: | --- |
| HAR Base64（`content.encoding`） | 40 | GLB / 位图 / 音频 / 字体 / WASM |
| HAR 明文（`content.text`） | 53 | HTML / CSS / JS / JSON / SVG |

### 5.1 文件内部的内联 `data:` Base64（共 10 处）

这些是**嵌入在 JS/HTML 源码里的** Base64 数据，不是独立请求；提取时原样保留在源文件中，未单独拆出。

| 请求 # | 宿主文件 | 数量 | 内联类型 |
| ---: | --- | ---: | --- |
| 8 | `https://mola-zone.com/_nuxt/gpNsPhdA.js` | 4 | `application/wasm×1, audio/wav×3` |
| 73 | `https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_wasm_wrapper.js` | 2 | `application/octet-stream×2` |
| 75 | `https://mola-zone.com/3d/basis/basis_transcoder.js` | 1 | `application/octet-stream×1` |
| 111 | `https://newassets.hcaptcha.com/captcha/v1/b7cb55144cfb1f79ab8b18a24ea5786dc178370e/static/hcaptcha.html` | 3 | `image/gif×1, image/png×2` |

含义：`gpNsPhdA.js` 内联 1 个 WASM + 3 个 WAV；Draco / Basis 的 JS 包装器内联了 WASM 回退二进制；hcaptcha 页面内联 3 张图。**独立的 `.wasm` 文件也已单独抓到并提取**，因此无需从 JS 里抠 Base64。

## 6. 完整性、损坏与解码器检查

### 6.1 校验方法与结果

对每个提取文件执行：GLB 魔数 `glTF` / version 2 / 声明长度 / 逐 chunk 偏移；PNG `\x89PNG` + IEND；JPEG SOI/EOI；WebP RIFF 长度；SVG 根元素；WOFF2 `wOF2`；ICO 头；MP3 ID3 / 帧同步；WASM `\x00asm` v1；JSON `json.loads`；文本 UTF-8 可解码；以及解码字节数 vs `content.size`。

- **结果：93 / 93 全部通过，0 个损坏、0 个截断、0 个大小不一致、0 个 JSON 解析失败。**
- 另抽查 PNG IHDR 尺寸：`three-tone.png` 3×1（三色阶 LUT）、`dust.png` 200×200、`arrows.png` 72×18，均为有效图像。
- 16 个 304 字体请求无响应体，但各自对应的 200 版本（`Kern-Medium/Regular/Bold.woff2`）均已抓到并提取，**全部可恢复**。

### 6.2 3D 资源是否缺少解码器 → 不缺

| 必需扩展 | 影响文件 | 需要的加载器 | HAR 中是否提供 | 提取路径 |
| --- | --- | --- | --- | --- |
| `KHR_draco_mesh_compression` | 全部 3 个 GLB | Three.js `DRACOLoader` + `draco_decoder.wasm` / `draco_wasm_wrapper.js` | ✅ Draco **1.5.7** | `decoders/www.gstatic.com/draco/versioned/decoders/1.5.7/` |
| `KHR_texture_basisu` (KTX2) | scene / bike（共 69 张贴图） | Three.js `KTX2Loader` + `basis_transcoder.js/.wasm` | ✅ 已提供 | `decoders/3d/basis/` |
| `KHR_texture_transform` | scene | Three.js 内置支持 | 无需额外文件 | — |
| `EXT_mesh_gpu_instancing`（Used 非 Required） | scene | 可选，Three.js 支持 | 无需额外文件 | — |
| `KHR_materials_specular` / `_unlit` / `_transmission` | scene / bike | Three.js 内置材质扩展 | 无需额外文件 | — |

**结论**：三个 GLB 都是 **glTF-Transform v4.2.0** 导出的高度优化模型（Draco 几何压缩 + KTX2 纹理压缩），所有贴图与 buffer **全部内嵌、零外部 URI**，文件本身完整自洽。只要渲染端配置 `DRACOLoader`（三个都要）与 `KTX2Loader`（scene/bike 要），并使用本次提取的同版本解码器，即可直接加载。

注意：KTX2 转码目标格式取决于运行设备的 GPU 纹理支持（ETC1S/UASTC → WebGL 压缩纹理或 RGBA32 回退），这是**运行时兼容性**问题，不是文件损坏或解码器缺失。

### 6.3 缺失 / 不可恢复资源

| 请求 # | URL | 问题 | 是否可恢复 |
| ---: | --- | --- | :---: |
| 0 | `https://mola-zone.com/en?ref=landing.love` | HTTP 301  | 否 |
| 12 | `https://mola-zone.com/_nuxt/BTEu00bY.js` | HTTP 503  | 否 |
| 13 | `https://mola-zone.com/_nuxt/BdRKPyVd.js` | HTTP 503  | 否 |
| 32 | `https://mola-zone.com/cdn-cgi/rum?` | HTTP 204  | 否 |
| 35 | `https://plausible.io/api/event` | HTTP 202  | 否 |
| 63 | `https://plausible.io/api/event` | HTTP 202  | 否 |
| 90 | `https://plausible.io/api/event` | HTTP 202  | 否 |
| 110 | `https://b6fe06ad871f.w.hcaptcha.com/logo.png` | 200 但响应体为空/未保存 | 否 |
| 113 | `https://a582e0858473.w.hcaptcha.com/logo.png` | 200 但响应体为空/未保存 | 否 |
| 130 | `https://plausible.io/api/event` | HTTP 202  | 否 |
| 134 | `https://plausible.io/api/event` | HTTP 202  | 否 |

其中真正影响站点 JS 完整性的只有 **#12 `BTEu00bY.js` 与 #13 `BdRKPyVd.js`**（503 且无后续重试成功）；`#11 BTkscHHv.js` 在 #62 重试成功，已提取 136 B 有效内容（`preventHotReload` 模块）。其余为重定向、埋点 202/204 应答、hcaptcha 空图片等，不含可复用资源。

## 7. 哪些资源可以直接使用（最终结论）

### A 级 — 开箱即用（无解码器、无运行时特殊要求）

| 类别 | 数量 | 提取位置 | 备注 |
| --- | ---: | --- | --- |
| 纹理贴图 | 12 | `textures/` | WebP ×6、JPEG ×2、PNG ×4，含地面混合图、天空盒、水面、三色阶 LUT、尘埃 |
| UI 图片 / 图标 | 19 | `images/` | Loader 背景与形状、社媒 SVG、favicon、箭头等 |
| 音频 | 7 | `audio/` | 引擎巡航/怠速、环境音（desert/forest/reverb）、电台 BIZARRE/CELINE |
| 字体 | 3 | `fonts/` | Kern Medium / Regular / Bold (WOFF2) |
| HTML / CSS / JS | 1 / 10 / 14 | `html/` `css/` `js/` | Nuxt 构建产物，明文，可留档或参考 |
| 数据 JSON | 12 | `data/` | 页面 payload、build meta、detect-gpu 基准、leaderboard、speculation rules |

### B 级 — 数据完整、配播放器/运行时即可用

| 资源 | 提取位置 | 需要的运行时 | 自包含 |
| --- | --- | --- | :---: |
| `logo_anim_v3.json` | `animations/3d/tmp-cdn-patch/` | `lottie-web` / `lottie-player` | ✅ 无外链（图层名有编码瑕疵） |
| `state_v9.json` | `scenes/3d/` | Theatre.js 0.4.0 + 对应 GLB 场景对象 | ✅ 纯数据 |

### C 级 — 完整无损，但必须配套已提取的解码器

| 模型 | 大小 | 依赖 | 内置动画 | 推荐度 |
| --- | ---: | --- | --- | --- |
| `oiseau_v1.glb` | 33.1 KiB | 仅 Draco（贴图为内嵌 PNG） | 无 | ⭐ 最简单，优先试用 |
| `bike_v9.7.glb` | 3.02 MiB | Draco + KTX2 | **12 个**（Idle / Left / Right / Stop / Character / wind 等） | ⭐ 摩托车主体，动画齐全 |
| `scene_v6.16.4.glb` | 6.32 MiB | Draco + KTX2 + texture_transform + GPU instancing | 无（静态场景） | 场景主体，168 节点 / 118 mesh / 58 张 KTX2 |

配套解码器位于 `extracted/decoders/`：Draco 1.5.7 的 `draco_wasm_wrapper.js` + `draco_decoder.wasm`，Basis 的 `basis_transcoder.js` + `basis_transcoder.wasm`。**四个文件齐全，不缺解码器。**

### D 级 — 不建议 / 无法直接使用

- 6 个 `third-party/` 文件（hcaptcha、Plausible、Cloudflare Insights）：跨域、依赖外部服务、含站点专用密钥，**不可直接复用**。
- `#12`/`#13` 两个 503 的 Nuxt chunk：HAR 内缺失，需要重新抓取。
- hcaptcha 的 2 个 `logo.png`：0 字节。
- JS 源码内的 10 处内联 `data:` Base64：需另行从宿主文件中拆出（但对应的独立 WASM 已提取，通常无需拆）。

## 8. 目录结构与产物说明

**命名与目录策略**：保留每个资源的**原始文件名**；`extracted/` 下先按资源类别分目录，类别内部保留**原始 URL 路径层级**（第三方资源额外加一层主机名），确保不重名且可反查来源。

```
E:/workbuddy/fastbike/
├── RESOURCE_MANIFEST.md            ← 本清单
├── analysis/
│   ├── har_probe.py                结构概览脚本
│   ├── har_probe2.py               重点文件深挖脚本
│   ├── har_extract.py              主解析/提取/校验脚本（可重复运行）
│   ├── make_manifest.py            本清单生成脚本
│   ├── requests.csv                全部 135 条请求的完整统计表（UTF-8 BOM）
│   ├── har_report.json             机器可读完整报告
│   └── probe_out.txt / extract_out.txt  运行日志
└── extracted/                      93 个资源文件
    ├── _extraction_map.json        原始 URL → 提取路径 映射表
    ├── models/3d/...               3 个 GLB
    ├── scenes/3d/state_v9.json
    ├── animations/3d/tmp-cdn-patch/logo_anim_v3.json
    ├── decoders/                   Draco 1.5.7 + Basis transcoder (JS+WASM)
    ├── textures/3d/Library/...    地面/水面/通用纹理
    ├── images/3d/tmp-cdn-patch/... UI 图片与图标
    ├── fonts/3d/tmp-cdn-patch/fonts/Kern/
    ├── audio/3d/tmp-cdn-patch/audios/ (含 radio/)
    ├── html/  css/  js/  data/
    └── third-party/                第三方脚本（留档）
```

全部 135 条请求的逐条字段（URL、状态码、MIME、资源类型、`content.size`、`bodySize`、`_transferSize`、HTTP 压缩、HAR Base64 标记、解码后字节、去重标记、提取路径）见 `analysis/requests.csv`；附录 9 为精简索引。

## 9. 附录：全部 135 条请求索引

| # | 状态 | 方法 | MIME | 分类 | 大小(B, 解压后) | 传输(B) | HAR编码 | 已提取 | URL |
| ---: | :---: | --- | --- | --- | ---: | ---: | --- | :---: | --- |
| 0 | 301 | GET | `text/html` | html | 0 | 1,376 | 明文 | — | `https://mola-zone.com/en?ref=landing.love` |
| 1 | 200 | GET | `text/html` | html | 144,787 | 21,130 | 明文 | ✅ | `https://mola-zone.com/en/?ref=landing.love` |
| 2 | 200 | GET | `application/speculationrules+json` | data | 151 | 462 | 明文 | ✅ | `https://mola-zone.com/cdn-cgi/speculation` |
| 3 | 200 | GET | `text/css` | css | 65,268 | 7,756 | 明文 | ✅ | `https://mola-zone.com/_nuxt/entry.B2OHENv6.css` |
| 4 | 200 | GET | `font/woff2` | fonts | 26,592 | 26,947 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Medium.woff2` |
| 5 | 200 | GET | `font/woff2` | fonts | 26,016 | 26,411 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |
| 6 | 200 | GET | `font/woff2` | fonts | 26,560 | 26,902 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| 7 | 200 | GET | `application/json` | data | 69 | 503 | 明文 | ✅ | `https://mola-zone.com/en/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 8 | 200 | GET | `application/javascript` | js | 2,215,265 | 593,769 | 明文 | ✅ | `https://mola-zone.com/_nuxt/gpNsPhdA.js` |
| 9 | 200 | GET | `application/javascript` | js | 158 | 512 | 明文 | ✅ | `https://mola-zone.com/_nuxt/BX-hYl93.js` |
| 10 | 200 | GET | `application/json` | data | 607 | 595 | 明文 | ✅ | `https://mola-zone.com/_nuxt/builds/meta/87806528-efd4-4924-9449-95ff46fefcc2.json` |
| 11 | 503 | GET | `text/plain` | js | 0 | 206 | 明文 | ↺ | `https://mola-zone.com/_nuxt/BTkscHHv.js` |
| 12 | 503 | GET | `text/plain` | js | 0 | 37 | 明文 | — | `https://mola-zone.com/_nuxt/BTEu00bY.js` |
| 13 | 503 | GET | `text/plain` | js | 0 | 37 | 明文 | — | `https://mola-zone.com/_nuxt/BdRKPyVd.js` |
| 14 | 200 | GET | `image/svg+xml` | images | 3,295 | 1,790 | 明文 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/nav-focus-icon.svg` |
| 15 | 200 | GET | `image/webp` | images | 161,500 | 162,079 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_background01.webp` |
| 16 | 200 | GET | `image/webp` | images | 112,758 | 113,255 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_background02.webp` |
| 17 | 200 | GET | `image/webp` | images | 59,924 | 60,396 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_background03.webp` |
| 18 | 200 | GET | `image/webp` | images | 96,874 | 97,353 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_background04.webp` |
| 19 | 200 | GET | `image/webp` | images | 104,080 | 104,524 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_leftShape.webp` |
| 20 | 200 | GET | `image/webp` | images | 58,924 | 59,414 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_topShape.webp` |
| 21 | 200 | GET | `image/webp` | images | 73,620 | 74,056 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_bottomShape.webp` |
| 22 | 200 | GET | `image/webp` | images | 102,254 | 102,677 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_rightShape.webp` |
| 23 | 200 | GET | `image/svg+xml` | images | 329 | 628 | 明文 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/youtube.svg` |
| 24 | 200 | GET | `image/svg+xml` | images | 1,241 | 974 | 明文 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/instagram.svg` |
| 25 | 200 | GET | `image/svg+xml` | images | 323 | 605 | 明文 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/tiktok.svg` |
| 26 | 200 | GET | `application/javascript` | js | 12,332 | 4,500 | 明文 | ✅ | `https://mola-zone.com/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js` |
| 27 | 200 | GET | `text/javascript` | third-party | 31,853 | 10,351 | 明文 | ✅ | `https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d87301792088814092` |
| 28 | 200 | GET | `image/webp` | images | 18,076 | 18,498 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/loader_centerShape.webp` |
| 29 | 200 | GET | `application/javascript` | third-party | 4,857 | 2,821 | 明文 | ✅ | `https://plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.tagged-events.js` |
| 30 | 200 | GET | `audio/mpeg` | audio | 217,465 | 218,126 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/audios/SFX_desert.mp3` |
| 31 | 200 | GET | `audio/mpeg` | audio | 109,112 | 109,603 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/audios/SFX_forest.mp3` |
| 32 | 204 | POST | `text/plain` | data | 0 | 351 | 明文 | — | `https://mola-zone.com/cdn-cgi/rum?` |
| 33 | 200 | GET | `image/svg+xml` | images | 14,453 | 4,581 | 明文 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/favicon.svg` |
| 34 | 200 | GET | `application/javascript` | js | 17,610 | 4,123 | base64 | ✅ | `https://mola-zone.com/_nuxt/DruHaZim.js` |
| 35 | 202 | POST | `text/plain` | third-party | 2 | 520 | 明文 | — | `https://plausible.io/api/event` |
| 36 | 200 | GET | `image/vnd.microsoft.icon` | images | 34,494 | 4,017 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/favicon.ico` |
| 37 | 200 | GET | `application/json` | data | 69 | 441 | 明文 | ↺ | `https://mola-zone.com/en/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 38 | 200 | GET | `audio/mpeg` | audio | 74,140 | 74,589 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/audios/reverb.mp3` |
| 39 | 200 | GET | `application/json` | animations | 29,115 | 6,308 | 明文 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/logo_anim_v3.json` |
| 40 | 200 | GET | `application/json` | animations | 29,115 | 6,251 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/logo_anim_v3.json` |
| 41 | 200 | GET | `image/svg+xml` | images | 14,453 | 4,559 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/favicon.svg` |
| 42 | 200 | GET | `application/javascript` | js | 1,373 | 1,021 | 明文 | ✅ | `https://mola-zone.com/_nuxt/DQq2lNzJ.js` |
| 43 | 200 | GET | `text/css` | css | 2,584 | 1,131 | 明文 | ✅ | `https://mola-zone.com/_nuxt/tourdates.D-K9VRmN.css` |
| 44 | 200 | GET | `application/javascript` | js | 2,603 | 1,480 | 明文 | ✅ | `https://mola-zone.com/_nuxt/DJvR05L8.js` |
| 45 | 200 | GET | `text/css` | css | 3,343 | 1,210 | 明文 | ✅ | `https://mola-zone.com/_nuxt/shop.kCGlADTP.css` |
| 46 | 200 | GET | `application/javascript` | js | 8,490 | 3,681 | 明文 | ✅ | `https://mola-zone.com/_nuxt/JN6A2mNk.js` |
| 47 | 200 | GET | `application/javascript` | js | 1,431 | 1,011 | 明文 | ✅ | `https://mola-zone.com/_nuxt/BBmSEAfM.js` |
| 48 | 200 | GET | `text/css` | css | 2,011 | 883 | 明文 | ✅ | `https://mola-zone.com/_nuxt/FormField.CmJslRV7.css` |
| 49 | 200 | GET | `text/css` | css | 12,413 | 2,002 | 明文 | ✅ | `https://mola-zone.com/_nuxt/premium.BUj5YXut.css` |
| 50 | 200 | GET | `application/json` | data | 69 | 413 | 明文 | ✅ | `https://mola-zone.com/en/posts/tourdates/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 51 | 200 | GET | `application/json` | data | 69 | 420 | 明文 | ✅ | `https://mola-zone.com/en/posts/shop/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 52 | 200 | GET | `application/json` | data | 69 | 445 | 明文 | ✅ | `https://mola-zone.com/en/posts/premium/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 53 | 200 | GET | `image/vnd.microsoft.icon` | images | 34,494 | 3,993 | base64 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/favicon.ico` |
| 54 | 304 | GET | `font/woff2` | fonts | 26,560 | 1,208 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| 55 | 304 | GET | `font/woff2` | fonts | 26,016 | 487 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |
| 56 | 304 | GET | `font/woff2` | fonts | 26,560 | 477 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| 57 | 304 | GET | `font/woff2` | fonts | 26,016 | 242 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |
| 58 | 200 | GET | `application/json` | data | 146,892 | 11,497 | 明文 | ✅ | `https://unpkg.com/detect-gpu@5.0.70/dist/benchmarks/d-nvidia.json` |
| 59 | 200 | GET | `application/json` | scenes | 193,745 | 13,146 | 明文 | ✅ | `https://mola-zone.com/3d/state_v9.json` |
| 60 | 304 | GET | `font/woff2` | fonts | 26,560 | 264 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| 61 | 304 | GET | `font/woff2` | fonts | 26,016 | 293 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |
| 62 | 200 | GET | `application/javascript` | js | 136 | 561 | 明文 | ✅ | `https://mola-zone.com/_nuxt/BTkscHHv.js` |
| 63 | 202 | POST | `text/plain` | third-party | 2 | 519 | 明文 | — | `https://plausible.io/api/event` |
| 64 | 200 | GET | `image/jpeg` | textures | 20,223 | 20,596 | base64 | ✅ | `https://mola-zone.com/3d/Library/ground/skybox-day.jpg` |
| 65 | 200 | GET | `image/webp` | textures | 87,156 | 87,580 | base64 | ✅ | `https://mola-zone.com/3d/Library/ground/map_ground_v2.1.webp` |
| 66 | 200 | GET | `image/png` | textures | 131 | 508 | base64 | ✅ | `https://mola-zone.com/3d/texture/three-tone.png` |
| 67 | 200 | GET | `image/png` | textures | 15,674 | 16,032 | base64 | ✅ | `https://mola-zone.com/3d/Library/ground/skybox-night.png` |
| 68 | 200 | GET | `image/webp` | textures | 91,522 | 92,039 | base64 | ✅ | `https://mola-zone.com/3d/Library/ground/R_rock.webp` |
| 69 | 200 | GET | `image/webp` | textures | 16,336 | 16,726 | base64 | ✅ | `https://mola-zone.com/3d/Library/ground/G_sand.webp` |
| 70 | 200 | GET | `image/webp` | textures | 50,380 | 50,843 | base64 | ✅ | `https://mola-zone.com/3d/Library/ground/B_marble.webp` |
| 71 | 200 | GET | `image/webp` | textures | 73,510 | 73,914 | base64 | ✅ | `https://mola-zone.com/3d/Library/ground/blendmap.webp` |
| 72 | 200 | GET | `application/octet-stream` | models | 6,631,384 | 6,639,272 | base64 | ✅ | `https://mola-zone.com/3d/Scene/scene_v6.16.4.glb` |
| 73 | 200 | GET | `text/javascript` | decoders | 58,763 | 11,915 | 明文 | ✅ | `https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_wasm_wrapper.js` |
| 74 | 200 | GET | `application/wasm` | decoders | 285,948 | 88,971 | base64 | ✅ | `https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.wasm` |
| 75 | 200 | GET | `application/javascript` | decoders | 80,020 | 17,850 | 明文 | ✅ | `https://mola-zone.com/3d/basis/basis_transcoder.js` |
| 76 | 200 | GET | `application/wasm` | decoders | 499,935 | 231,638 | base64 | ✅ | `https://mola-zone.com/3d/basis/basis_transcoder.wasm` |
| 77 | 200 | GET | `image/jpeg` | textures | 11,798 | 12,193 | base64 | ✅ | `https://mola-zone.com/3d/Library/water/water.jpeg` |
| 78 | 200 | GET | `image/webp` | textures | 200,140 | 200,764 | base64 | ✅ | `https://mola-zone.com/3d/Library/ground/noise.webp` |
| 79 | 200 | GET | `image/jpeg` | textures | 92,269 | 92,708 | base64 | ✅ | `https://mola-zone.com/3d/Library/water/sea_foam_albedo.jpg` |
| 80 | 200 | GET | `application/octet-stream` | models | 3,171,448 | 3,175,365 | base64 | ✅ | `https://mola-zone.com/3d/Library/bike/bike_v9.7.glb` |
| 81 | 200 | GET | `audio/mpeg` | audio | 525,500 | 526,447 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/audios/motor-cruise.mp3` |
| 82 | 200 | GET | `audio/mpeg` | audio | 45,369 | 45,829 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/audios/motor-stopped.mp3` |
| 83 | 200 | GET | `image/png` | textures | 4,389 | 4,809 | base64 | ✅ | `https://mola-zone.com/3d/texture/dust.png` |
| 84 | 200 | GET | `application/javascript` | js | 682 | 930 | 明文 | ✅ | `https://mola-zone.com/_nuxt/Cb-8nAAM.js` |
| 85 | 200 | GET | `text/css` | css | 1,226 | 817 | 明文 | ✅ | `https://mola-zone.com/_nuxt/roi.BoUQHJvp.css` |
| 86 | 200 | GET | `application/json` | data | 69 | 444 | 明文 | ✅ | `https://mola-zone.com/en/posts/roi/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 87 | 304 | GET | `font/woff2` | fonts | 26,016 | 291 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |
| 88 | 304 | GET | `font/woff2` | fonts | 26,560 | 287 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| 89 | 200 | GET | `application/octet-stream` | models | 33,936 | 34,304 | base64 | ✅ | `https://mola-zone.com/3d/Library/oiseau_v1.glb` |
| 90 | 202 | POST | `text/plain` | third-party | 2 | 520 | 明文 | — | `https://plausible.io/api/event` |
| 91 | 200 | GET | `audio/mpeg` | audio | 876,684 | 878,002 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/audios/radio/BIZARRE.mp3` |
| 92 | 200 | GET | `image/svg+xml` | images | 154 | 532 | 明文 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/chevron.svg` |
| 93 | 200 | GET | `application/javascript` | js | 4,633 | 2,311 | 明文 | ✅ | `https://mola-zone.com/_nuxt/l6e20DzW.js` |
| 94 | 200 | GET | `text/css` | css | 4,411 | 1,378 | 明文 | ✅ | `https://mola-zone.com/_nuxt/molazone.D9f-kKp9.css` |
| 95 | 200 | GET | `application/json` | data | 69 | 526 | 明文 | ✅ | `https://mola-zone.com/en/posts/molazone/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 96 | 200 | GET | `image/png` | images | 7,926 | 8,327 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/favicon-196x196.png` |
| 97 | 200 | GET | `application/javascript` | js | 826 | 874 | 明文 | ✅ | `https://mola-zone.com/_nuxt/DyW3_eXW.js` |
| 98 | 200 | GET | `text/css` | css | 1,684 | 827 | 明文 | ✅ | `https://mola-zone.com/_nuxt/credits.Ct6LYxGg.css` |
| 99 | 200 | GET | `application/json` | data | 69 | 394 | 明文 | ✅ | `https://mola-zone.com/en/posts/credits/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 100 | 304 | GET | `font/woff2` | fonts | 26,560 | 364 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| 101 | 304 | GET | `font/woff2` | fonts | 26,016 | 346 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |
| 102 | 304 | GET | `font/woff2` | fonts | 26,560 | 233 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| 103 | 304 | GET | `font/woff2` | fonts | 26,016 | 314 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |
| 104 | 200 | GET | `application/json` | data | 69 | 465 | 明文 | ↺ | `https://mola-zone.com/en/posts/molazone/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 105 | 200 | GET | `application/json` | data | 69 | 528 | 明文 | ↺ | `https://mola-zone.com/en/posts/shop/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 106 | 200 | GET | `image/png` | images | 471 | 860 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/arrows.png` |
| 107 | 200 | GET | `image/svg+xml` | images | 368 | 613 | 明文 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/images/stroke-normal.svg` |
| 108 | 200 | GET | `application/javascript` | third-party | 419,658 | 120,305 | 明文 | ✅ | `https://js.hcaptcha.com/1/api.js?hl=fr` |
| 109 | 200 | GET | `application/json` | data | 18 | 548 | 明文 | ✅ | `https://mola-zone.com/.netlify/functions/leaderboard` |
| 110 | 200 | GET | `image/png` | third-party | 0 | 3,327 | 明文 | — | `https://b6fe06ad871f.w.hcaptcha.com/logo.png` |
| 111 | 200 | GET | `text/html` | third-party | 697,721 | 204,589 | 明文 | ✅ | `https://newassets.hcaptcha.com/captcha/v1/b7cb55144cfb1f79ab8b18a24ea5786dc178370e/static/hcaptcha.html` |
| 112 | 200 | GET | `text/html` | third-party | 697,721 | 213,507 | 明文 | ↺ | `https://newassets.hcaptcha.com/captcha/v1/b7cb55144cfb1f79ab8b18a24ea5786dc178370e/static/hcaptcha.html` |
| 113 | 200 | GET | `image/png` | third-party | 2,593 | 3,327 | 明文 | — | `https://a582e0858473.w.hcaptcha.com/logo.png` |
| 114 | 200 | POST | `application/json` | third-party | 917 | 1,080 | 明文 | ✅ | `https://api.hcaptcha.com/checksiteconfig?v=b7cb55144cfb1f79ab8b18a24ea5786dc178370e&host=mola-zone.com&sitekey=316e5a4a-73ce-4fba-a75e-1682354cbcf6&sc=1&swa=1&spst=1` |
| 115 | 200 | GET | `application/javascript` | third-party | 1,564,157 | 679,300 | 明文 | ✅ | `https://newassets.hcaptcha.com/c/bddd3aa2629b4bd972d50f1b7d788bf71dcd9dc47dfc2e029484ee008b231476/hsw.js` |
| 116 | 200 | POST | `application/json` | data | 14 | 326 | 明文 | ↺ | `https://mola-zone.com/.netlify/functions/leaderboard` |
| 117 | 200 | GET | `application/javascript` | js | 1,841 | 1,287 | 明文 | ✅ | `https://mola-zone.com/_nuxt/C9MRYmc3.js` |
| 118 | 200 | GET | `text/css` | css | 2,248 | 800 | 明文 | ✅ | `https://mola-zone.com/_nuxt/video.FwYnGhR5.css` |
| 119 | 200 | GET | `application/javascript` | js | 913 | 941 | 明文 | ✅ | `https://mola-zone.com/_nuxt/C6iblEAH.js` |
| 120 | 200 | GET | `text/css` | css | 1,204 | 734 | 明文 | ✅ | `https://mola-zone.com/_nuxt/radio.DjQLCONZ.css` |
| 121 | 200 | GET | `application/json` | data | 69 | 402 | 明文 | ✅ | `https://mola-zone.com/en/posts/radio/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 122 | 200 | GET | `application/json` | data | 69 | 359 | 明文 | ↺ | `https://mola-zone.com/en/posts/tourdates/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 123 | 200 | GET | `application/json` | data | 69 | 395 | 明文 | ↺ | `https://mola-zone.com/en/posts/shop/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 124 | 200 | GET | `application/json` | data | 69 | 588 | 明文 | ↺ | `https://mola-zone.com/en/posts/premium/_payload.json?87806528-efd4-4924-9449-95ff46fefcc2` |
| 125 | 304 | GET | `font/woff2` | fonts | 26,560 | 428 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| 126 | 304 | GET | `font/woff2` | fonts | 26,016 | 289 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |
| 127 | 304 | GET | `font/woff2` | fonts | 26,560 | 263 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Bold.woff2` |
| 128 | 304 | GET | `font/woff2` | fonts | 26,016 | 234 | 明文 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/fonts/Kern/Kern-Regular.woff2` |
| 129 | 200 | GET | `image/png` | images | 471 | 830 | base64 | ↺ | `https://mola-zone.com/3d/tmp-cdn-patch/images/arrows.png` |
| 130 | 202 | POST | `text/plain` | third-party | 2 | 520 | 明文 | — | `https://plausible.io/api/event` |
| 131 | 200 | GET | `audio/mpeg` | audio | 1,236,975 | 1,238,753 | base64 | ✅ | `https://mola-zone.com/3d/tmp-cdn-patch/audios/radio/CELINE.mp3` |
| 132 | 200 | GET | `application/json` | data | 18 | 612 | 明文 | ↺ | `https://mola-zone.com/.netlify/functions/leaderboard` |
| 133 | 200 | POST | `application/json` | data | 14 | 301 | 明文 | ↺ | `https://mola-zone.com/.netlify/functions/leaderboard` |
| 134 | 202 | POST | `text/plain` | third-party | 2 | 520 | 明文 | — | `https://plausible.io/api/event` |

> 图例：✅ = 该条目被选为导出源；↺ = 重复/304 请求，内容已由同 URL 的其他条目导出；— = 无响应体或不需要导出。

---

*本清单由 `analysis/har_extract.py` + `analysis/make_manifest.py` 自动生成，数据来自单一 HAR 文件，可重复验证。第一阶段到此结束，未进行任何网页开发。*
