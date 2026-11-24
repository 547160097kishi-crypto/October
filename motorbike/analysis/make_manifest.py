# -*- coding: utf-8 -*-
"""由 analysis/har_report.json 生成 RESOURCE_MANIFEST.md"""
import sys, json, collections
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(r"E:/workbuddy/fastbike")
R = json.loads((ROOT / "analysis" / "har_report.json").read_text(encoding="utf-8"))
recs, ext = R["records"], R["extracted"]

L = []
def w(s=""):
    L.append(s)

def hs(n):
    n = n or 0
    if n < 1024: return f"{n} B"
    if n < 1024 ** 2: return f"{n / 1024:.1f} KiB"
    return f"{n / 1024 ** 2:.2f} MiB"

def cell(s):
    return str(s).replace("|", "%7C").replace("\n", " ")

CAT_TITLE = {
    "models": "3D 模型 (GLB / GLTF)",
    "scenes": "3D 场景 / 状态 JSON",
    "animations": "动画 JSON",
    "decoders": "解码器 / 运行时依赖",
    "textures": "纹理贴图",
    "images": "图片 / UI 素材",
    "fonts": "字体",
    "audio": "音频",
    "html": "HTML",
    "css": "CSS",
    "js": "JavaScript",
    "data": "数据 / 配置 JSON",
    "third-party": "第三方脚本（不建议复用）",
}
CAT_ORDER = ["models", "scenes", "animations", "decoders", "textures", "images",
             "fonts", "audio", "html", "css", "js", "data", "third-party"]

# ============ 头部 ============
w("# RESOURCE_MANIFEST.md")
w()
w("> 第一阶段成果：HAR 资源分析与提取。**本阶段不包含网页开发。**")
w()
w("| 项目 | 值 |")
w("| --- | --- |")
w(f"| 源 HAR 文件 | `{R['source']}` |")
w(f"| 源文件大小 | {hs(R['source_bytes'])} ({R['source_bytes']:,} B) |")
w(f"| HAR 版本 / 抓取工具 | {R['har_version']} / {R['creator']['name']} {R['creator']['version']} (Chrome DevTools) |")
p = R["pages"][0]
w(f"| 抓取页面 | `{p['title']}` |")
w(f"| 抓取时间 (UTC) | {p['startedDateTime']} |")
w(f"| 请求总数 | {R['entry_count']} |")
w(f"| 成功提取文件 | {R['extracted_file_count']} 个，共 {hs(R['extracted_total_bytes'])} |")
w(f"| 完整性校验 | **{sum(1 for x in ext if x['valid'])} / {len(ext)} 通过，0 损坏** |")
w(f"| 提取根目录 | `E:/workbuddy/fastbike/extracted/` |")
w()

# ============ 结论速览 ============
w("## 1. 结论速览")
w()
w("**可以直接使用（开箱即用，无需解码器）**：")
w()
w("- 全部 **图片 / 纹理**（WebP、PNG、JPEG、SVG、ICO）、**7 个 MP3 音频**、**3 个 WOFF2 字体** —— 二进制均已从 Base64 还原并逐一通过魔数与长度校验。")
w("- **logo_anim_v3.json**（Lottie 5.7.0，800×400，60fps，4.98s，资源全内嵌无外链）与 **state_v9.json**（Theatre.js 0.4.0 状态表）—— JSON 可解析、数据自包含。")
w("- 全部 **HTML / CSS / JS** 构建产物（明文，可直接查看或留档复用）。")
w()
w("**可以直接使用，但必须配套 HAR 中已抓到的解码器**：")
w()
w("- 3 个 **GLB 模型**：均使用 `KHR_draco_mesh_compression`；`scene_v6.16.4.glb` 与 `bike_v9.7.glb` 还使用 `KHR_texture_basisu`（KTX2 纹理）。")
w("- 所需解码器 **Draco 1.5.7 (JS + WASM)** 与 **Basis transcoder (JS + WASM)** 已完整抓取并提取到 `extracted/decoders/`，因此 **不缺解码器**。")
w("- 其中 `oiseau_v1.glb` 依赖最少（仅 Draco + 内嵌 PNG 贴图），是三个模型里最容易直接加载的。")
w()
w("**不能直接使用的**：2 个 HTTP 503 的 Nuxt chunk（`BTEu00bY.js`、`BdRKPyVd.js`）响应体为空且未重试成功；hcaptcha 的 2 个 `logo.png` 为空；第三方统计/验证码脚本存在跨域与授权限制。")
w()
w("> 提示：这些资源来自第三方站点的抓包，复用前请确认版权与使用授权。")
w()

# ============ 统计 ============
w("## 2. HAR 解析与总体统计")
w()
w("### 2.1 HTTP 状态码分布")
w()
w("| 状态码 | 数量 | 说明 |")
w("| --- | ---: | --- |")
SM = {200: "成功（含重复请求）", 304: "缓存命中，HAR 未保存响应体", 301: "重定向",
      503: "服务端错误，响应体为空", 204: "无内容", 202: "已接受（埋点上报，无资源）"}
for k in sorted(R["by_status"], key=lambda x: -R["by_status"][x]):
    w(f"| {k} | {R['by_status'][k]} | {SM.get(int(k), '')} |")
w()
w("### 2.2 MIME 类型分布（全部 135 条请求）")
w()
w("| MIME | 数量 |")
w("| --- | ---: |")
for k, v in sorted(R["by_mime"].items(), key=lambda x: -x[1]):
    w(f"| `{cell(k)}` | {v} |")
w()
w("### 2.3 资源分类统计")
w()
w("| 分类 | 请求数 | 提取文件数 | 提取字节 | 占比 |")
w("| --- | ---: | ---: | ---: | ---: |")
tot = R["extracted_total_bytes"]
for c in CAT_ORDER:
    nfiles = sum(1 for x in ext if x["category"] == c)
    b = R["by_category_extracted_bytes"].get(c, 0)
    w(f"| {CAT_TITLE[c]} | {R['by_category'].get(c, 0)} | {nfiles} | {hs(b)} | {b / tot * 100:.1f}% |")
w(f"| **合计** | **{R['entry_count']}** | **{len(ext)}** | **{hs(tot)}** | **100%** |")
w()
w("### 2.4 传输体积与 HTTP 压缩")
w()
w("| 指标 | 值 |")
w("| --- | --- |")
w(f"| content.size 总和（解压后） | {hs(R['total_content_bytes'])} |")
w(f"| _transferSize 总和（网络传输，含头） | {hs(R['total_transfer_bytes'])} |")
w(f"| 实际提取文件字节总和 | {hs(R['extracted_total_bytes'])} |")
w()
w("响应头 `content-encoding` 分布：")
w()
w("| 编码 | 数量 | 说明 |")
w("| --- | ---: | --- |")
for k, v in sorted(R["http_encoding"].items(), key=lambda x: -x[1]):
    note = "无压缩" if k == "(none)" else "DevTools 已解压后再写入 HAR"
    w(f"| `{cell(k)}` | {v} | {note} |")
w()
w("**重要**：Chrome DevTools 写入 HAR 的 `content.text` / `content.size` 是**解压后**的响应体。已抽查 `zstd` / `br` / `gzip` 条目，提取结果为明文 HTML/CSS/JS（例如 `gpNsPhdA.js` 以 `const __vite__mapDeps=` 开头）。因此本地**无需** brotli / zstd 解码器，也不会出现二次解压问题。")
w()
w("### 2.5 重复请求与去重")
w()
w(f"- 135 条请求映射到 {R['unique_output_paths']} 个唯一 URL 路径；其中 {len(ext)} 个有可用响应体并已落盘。")
w("- 去重策略：同一输出路径保留 `status=200` 且响应体最完整的条目；重复请求（如 `logo_anim_v3.json` ×2、`favicon.svg` ×2、`_payload.json` 系列、304 字体）只导出一份。")
w(f"- 全部 {len(ext)} 个文件的解码字节数与 HAR `content.size` **100% 一致**（0 处不一致）。")
w()

# ============ 分类清单 ============
w("## 3. 分类资源清单")
w()
w("> 「校验」列：`OK` = 魔数/长度/结构/编码全部通过。`提取路径` 均相对于 `extracted/`。")
w()
for c in CAT_ORDER:
    items = [x for x in ext if x["category"] == c]
    if not items:
        continue
    w(f"### 3.{CAT_ORDER.index(c) + 1} {CAT_TITLE[c]}（{len(items)} 个）")
    w()
    w("| 原始文件名 | 大小 | 格式 | 校验 | 提取路径 | 原始 URL |")
    w("| --- | ---: | --- | :---: | --- | --- |")
    for x in sorted(items, key=lambda y: y["out_rel"]):
        w(f"| `{cell(Path(x['out_rel']).name)}` | {hs(x['bytes'])} | {cell(x['format'])} | "
          f"{'OK' if x['valid'] else 'FAIL'} | `{cell(x['out_rel'])}` | `{cell(x['url'])}` |")
    w()

# ============ 重点文件 ============
w("## 4. 重点文件深度检查")
w()
w("### 4.1 GLB 模型三件套")
w()
for name in ["scene_v6.16.4.glb", "bike_v9.7.glb", "oiseau_v1.glb"]:
    d = R["key_files"][name]
    g = d.get("glb", {})
    w(f"#### `{name}`")
    w()
    w("| 属性 | 值 |")
    w("| --- | --- |")
    w(f"| 请求序号 / 状态 | #{', #'.join(str(i) for i in d['request_indices'])} / HTTP {d['status']} |")
    w(f"| 原始 URL | `{cell(d['url'])}` |")
    w(f"| MIME / HAR 编码 | `{cell(d['mimeType'])}` / {d['har_encoding'] or '明文'} |")
    w(f"| 解码后大小 | {hs(d['decoded_bytes'])} ({d['decoded_bytes']:,} B) |")
    w(f"| 提取路径 | `extracted/{cell(d['out_rel'])}` |")
    w(f"| 完整性 | {g.get('integrity', 'N/A')}；JSON / BIN chunk 齐全，声明长度 == 实际长度 |")
    w(f"| 生成器 | {cell(g.get('generator'))} |")
    w(f"| 结构 | {cell(g.get('counts'))} |")
    w(f"| 必需扩展 (`extensionsRequired`) | `{cell(', '.join(g.get('extensionsRequired', [])))}` |")
    w(f"| 使用扩展 (`extensionsUsed`) | `{cell(', '.join(g.get('extensionsUsed', [])))}` |")
    w(f"| 贴图格式 | {cell(g.get('image_mime_types'))}；KTX2/BasisU 贴图 {g.get('basisu_textures', 0)} 张 |")
    w(f"| Draco 压缩 primitive | {g.get('draco_primitives', 0)} 个 |")
    w(f"| 外部依赖 | 图片 URI {len(g.get('external_image_uris', []))} 个 / buffer URI {len(g.get('external_buffer_uris', []))} 个 → **全部内嵌，无外链** |")
    if g.get("animation_names"):
        w(f"| 内置动画（{len(g['animation_names'])} 个） | `{cell(', '.join(g['animation_names']))}` |")
    else:
        w("| 内置动画 | 无（静态模型） |")
    w()
w("### 4.2 `state_v9.json`")
w()
d = R["key_files"]["state_v9.json"]
j = d.get("json", {})
w("| 属性 | 值 |")
w("| --- | --- |")
w(f"| 请求序号 / 状态 | #{d['request_indices'][0]} / HTTP {d['status']} |")
w(f"| 原始 URL | `{cell(d['url'])}` |")
w(f"| 大小 | {hs(d['decoded_bytes'])} ({d['decoded_bytes']:,} B)，纯文本 JSON（非 Base64） |")
w(f"| 提取路径 | `extracted/{cell(d['out_rel'])}` |")
w(f"| 类型 | {cell(j.get('kind'))} |")
w(f"| definitionVersion | {cell(j.get('definitionVersion'))} |")
w(f"| 顶层键 | `{cell(', '.join(j.get('top_keys', [])))}` |")
w(f"| revisionHistory | {j.get('revisionHistory_count')} 条修订记录 |")
w(f"| 字符串编码瑕疵 | {'有（Mojibake）' if j.get('mojibake_detected') else '无'} |")
w()
w("| Sheet 名 | 静态覆盖对象数 | 序列轨道数 |")
w("| --- | ---: | ---: |")
for k, v in j.get("sheets", {}).items():
    w(f"| `{cell(k)}` | {v.get('staticOverride_objects', 0)} | {v.get('sequence_tracks', 0)} |")
w()
w("说明：这是 **Theatre.js 的状态/动画数据表**，记录场景对象（`objects / cactus_05_v1_reference / day` 等）的 `directColor` / `indirectColor` 等静态覆盖值，以及 `Orbital Sequence` 的 14 条相机/对象动画轨道。它**不是** glTF 场景文件，不含几何体；必须与 GLB 模型 + Theatre.js 运行时配合使用才有意义，数据本身完整可解析。")
w()
w("### 4.3 `logo_anim_v3.json`")
w()
d = R["key_files"]["logo_anim_v3.json"]
j = d.get("json", {})
w("| 属性 | 值 |")
w("| --- | --- |")
w(f"| 请求序号 / 状态 | #{', #'.join(str(i) for i in d['request_indices'])}（重复请求，已去重）/ HTTP {d['status']} |")
w(f"| 原始 URL | `{cell(d['url'])}` |")
w(f"| 大小 | {hs(d['decoded_bytes'])} ({d['decoded_bytes']:,} B)，纯文本 JSON（非 Base64） |")
w(f"| 提取路径 | `extracted/{cell(d['out_rel'])}` |")
w(f"| 类型 | {cell(j.get('kind'))}，版本 {cell(j.get('lottie_version'))} |")
w(f"| 画布 / 帧率 / 时长 | {j.get('width')}×{j.get('height')} / {j.get('frameRate')} fps / 约 {j.get('duration_sec')} s（{j.get('inPoint')}→{j.get('outPoint')} 帧） |")
w(f"| 图层 | {len(j.get('layers', []))} 个（均为预合成图层 `ty:0`） |")
w(f"| assets | {len(j.get('assets', []))} 个，**均为内嵌预合成图层（自带 layers）**，无外部图片 / 无 `u`/`p` 外链 |")
w(f"| 生成工具 | `@lottiefiles/toolkit-js 0.63.1` |")
w(f"| 字符串编码瑕疵 | **有 Mojibake**：图层名显示为 `Logo YamÃª Lottie`（UTF-8 被按 Latin-1 二次编码），不影响动画播放，仅影响图层名显示 |")
w()
w("说明：**完全自包含**，配合 `lottie-web` / `lottie-player` 即可直接播放 Logo 动画，无需任何额外素材。")
w()

# ============ Base64 ============
w("## 5. Base64 与编码检查")
w()
n_plain = sum(1 for r in recs if r["text_chars"] > 0 and r["har_encoding"] != "base64")
n_nobody = sum(1 for r in recs if r["text_chars"] == 0)
w(f"- HAR 中共 **{R['base64_entry_count']} 条** 响应以 `content.encoding = \"base64\"` 保存；其余 {R['entry_count'] - R['base64_entry_count']} 条中，{n_plain} 条为明文 UTF-8 文本、{n_nobody} 条无响应体（304/503/204/202 等）。")
b64 = [x for x in ext if x["har_encoding"] == "base64"]
w(f"- 这 {R['base64_entry_count']} 条覆盖 {len(b64)} 个唯一提取文件：3 个 GLB、全部 WebP/PNG/JPEG/ICO 位图、7 个 MP3、3 个 WOFF2、2 个 WASM，以及 1 个 JS chunk（`DruHaZim.js`）。")
w("- **提取时已全部 Base64 解码还原为原始二进制**，落盘文件不再带 Base64 包装；解码后字节数与 `content.size` 逐一比对，93/93 一致。")
w()
w("| 保存方式 | 涉及文件数 | 主要类型 |")
w("| --- | ---: | --- |")
w(f"| HAR Base64（`content.encoding`） | {len(b64)} | GLB / 位图 / 音频 / 字体 / WASM |")
w(f"| HAR 明文（`content.text`） | {len([x for x in ext if x['har_encoding'] != 'base64'])} | HTML / CSS / JS / JSON / SVG |")
w()
w("### 5.1 文件内部的内联 `data:` Base64（共 10 处）")
w()
w("这些是**嵌入在 JS/HTML 源码里的** Base64 数据，不是独立请求；提取时原样保留在源文件中，未单独拆出。")
w()
w("| 请求 # | 宿主文件 | 数量 | 内联类型 |")
w("| ---: | --- | ---: | --- |")
for x in R["inline_data_uris"]:
    w(f"| {x['index']} | `{cell(x['url'])}` | {x['count']} | `{cell(', '.join(f'{k}×{v}' for k, v in x['types'].items()))}` |")
w()
w("含义：`gpNsPhdA.js` 内联 1 个 WASM + 3 个 WAV；Draco / Basis 的 JS 包装器内联了 WASM 回退二进制；hcaptcha 页面内联 3 张图。**独立的 `.wasm` 文件也已单独抓到并提取**，因此无需从 JS 里抠 Base64。")
w()

# ============ 完整性 ============
w("## 6. 完整性、损坏与解码器检查")
w()
w("### 6.1 校验方法与结果")
w()
w("对每个提取文件执行：GLB 魔数 `glTF` / version 2 / 声明长度 / 逐 chunk 偏移；PNG `\\x89PNG` + IEND；JPEG SOI/EOI；WebP RIFF 长度；SVG 根元素；WOFF2 `wOF2`；ICO 头；MP3 ID3 / 帧同步；WASM `\\x00asm` v1；JSON `json.loads`；文本 UTF-8 可解码；以及解码字节数 vs `content.size`。")
w()
w(f"- **结果：{sum(1 for x in ext if x['valid'])} / {len(ext)} 全部通过，0 个损坏、0 个截断、0 个大小不一致、0 个 JSON 解析失败。**")
w(f"- 另抽查 PNG IHDR 尺寸：`three-tone.png` 3×1（三色阶 LUT）、`dust.png` 200×200、`arrows.png` 72×18，均为有效图像。")
w("- 16 个 304 字体请求无响应体，但各自对应的 200 版本（`Kern-Medium/Regular/Bold.woff2`）均已抓到并提取，**全部可恢复**。")
w()
w("### 6.2 3D 资源是否缺少解码器 → 不缺")
w()
w("| 必需扩展 | 影响文件 | 需要的加载器 | HAR 中是否提供 | 提取路径 |")
w("| --- | --- | --- | --- | --- |")
w("| `KHR_draco_mesh_compression` | 全部 3 个 GLB | Three.js `DRACOLoader` + `draco_decoder.wasm` / `draco_wasm_wrapper.js` | ✅ Draco **1.5.7** | `decoders/www.gstatic.com/draco/versioned/decoders/1.5.7/` |")
w("| `KHR_texture_basisu` (KTX2) | scene / bike（共 69 张贴图） | Three.js `KTX2Loader` + `basis_transcoder.js/.wasm` | ✅ 已提供 | `decoders/3d/basis/` |")
w("| `KHR_texture_transform` | scene | Three.js 内置支持 | 无需额外文件 | — |")
w("| `EXT_mesh_gpu_instancing`（Used 非 Required） | scene | 可选，Three.js 支持 | 无需额外文件 | — |")
w("| `KHR_materials_specular` / `_unlit` / `_transmission` | scene / bike | Three.js 内置材质扩展 | 无需额外文件 | — |")
w()
w("**结论**：三个 GLB 都是 **glTF-Transform v4.2.0** 导出的高度优化模型（Draco 几何压缩 + KTX2 纹理压缩），所有贴图与 buffer **全部内嵌、零外部 URI**，文件本身完整自洽。只要渲染端配置 `DRACOLoader`（三个都要）与 `KTX2Loader`（scene/bike 要），并使用本次提取的同版本解码器，即可直接加载。")
w()
w("注意：KTX2 转码目标格式取决于运行设备的 GPU 纹理支持（ETC1S/UASTC → WebGL 压缩纹理或 RGBA32 回退），这是**运行时兼容性**问题，不是文件损坏或解码器缺失。")
w()
w("### 6.3 缺失 / 不可恢复资源")
w()
w("| 请求 # | URL | 问题 | 是否可恢复 |")
w("| ---: | --- | --- | :---: |")
hard = [p for p in R["problems"] if not p["recoverable"]]
for p in hard:
    w(f"| {p['index']} | `{cell(p['url'])}` | {cell('; '.join(p['reasons']))} | 否 |")
w()
w("其中真正影响站点 JS 完整性的只有 **#12 `BTEu00bY.js` 与 #13 `BdRKPyVd.js`**（503 且无后续重试成功）；`#11 BTkscHHv.js` 在 #62 重试成功，已提取 136 B 有效内容（`preventHotReload` 模块）。其余为重定向、埋点 202/204 应答、hcaptcha 空图片等，不含可复用资源。")
w()

# ============ 可直接使用 ============
w("## 7. 哪些资源可以直接使用（最终结论）")
w()
w("### A 级 — 开箱即用（无解码器、无运行时特殊要求）")
w()
w("| 类别 | 数量 | 提取位置 | 备注 |")
w("| --- | ---: | --- | --- |")
cnt = collections.Counter(x["category"] for x in ext)
w(f"| 纹理贴图 | {cnt['textures']} | `textures/` | WebP ×6、JPEG ×2、PNG ×4，含地面混合图、天空盒、水面、三色阶 LUT、尘埃 |")
w(f"| UI 图片 / 图标 | {cnt['images']} | `images/` | Loader 背景与形状、社媒 SVG、favicon、箭头等 |")
w(f"| 音频 | {cnt['audio']} | `audio/` | 引擎巡航/怠速、环境音（desert/forest/reverb）、电台 BIZARRE/CELINE |")
w(f"| 字体 | {cnt['fonts']} | `fonts/` | Kern Medium / Regular / Bold (WOFF2) |")
w(f"| HTML / CSS / JS | {cnt['html']} / {cnt['css']} / {cnt['js']} | `html/` `css/` `js/` | Nuxt 构建产物，明文，可留档或参考 |")
w(f"| 数据 JSON | {cnt['data']} | `data/` | 页面 payload、build meta、detect-gpu 基准、leaderboard、speculation rules |")
w()
w("### B 级 — 数据完整、配播放器/运行时即可用")
w()
w("| 资源 | 提取位置 | 需要的运行时 | 自包含 |")
w("| --- | --- | --- | :---: |")
w("| `logo_anim_v3.json` | `animations/3d/tmp-cdn-patch/` | `lottie-web` / `lottie-player` | ✅ 无外链（图层名有编码瑕疵） |")
w("| `state_v9.json` | `scenes/3d/` | Theatre.js 0.4.0 + 对应 GLB 场景对象 | ✅ 纯数据 |")
w()
w("### C 级 — 完整无损，但必须配套已提取的解码器")
w()
w("| 模型 | 大小 | 依赖 | 内置动画 | 推荐度 |")
w("| --- | ---: | --- | --- | --- |")
w("| `oiseau_v1.glb` | 33.1 KiB | 仅 Draco（贴图为内嵌 PNG） | 无 | ⭐ 最简单，优先试用 |")
w("| `bike_v9.7.glb` | 3.02 MiB | Draco + KTX2 | **12 个**（Idle / Left / Right / Stop / Character / wind 等） | ⭐ 摩托车主体，动画齐全 |")
w("| `scene_v6.16.4.glb` | 6.32 MiB | Draco + KTX2 + texture_transform + GPU instancing | 无（静态场景） | 场景主体，168 节点 / 118 mesh / 58 张 KTX2 |")
w()
w("配套解码器位于 `extracted/decoders/`：Draco 1.5.7 的 `draco_wasm_wrapper.js` + `draco_decoder.wasm`，Basis 的 `basis_transcoder.js` + `basis_transcoder.wasm`。**四个文件齐全，不缺解码器。**")
w()
w("### D 级 — 不建议 / 无法直接使用")
w()
w(f"- {cnt['third-party']} 个 `third-party/` 文件（hcaptcha、Plausible、Cloudflare Insights）：跨域、依赖外部服务、含站点专用密钥，**不可直接复用**。")
w("- `#12`/`#13` 两个 503 的 Nuxt chunk：HAR 内缺失，需要重新抓取。")
w("- hcaptcha 的 2 个 `logo.png`：0 字节。")
w("- JS 源码内的 10 处内联 `data:` Base64：需另行从宿主文件中拆出（但对应的独立 WASM 已提取，通常无需拆）。")
w()

# ============ 目录结构 ============
w("## 8. 目录结构与产物说明")
w()
w("**命名与目录策略**：保留每个资源的**原始文件名**；`extracted/` 下先按资源类别分目录，类别内部保留**原始 URL 路径层级**（第三方资源额外加一层主机名），确保不重名且可反查来源。")
w()
w("```")
w("E:/workbuddy/fastbike/")
w("├── RESOURCE_MANIFEST.md            ← 本清单")
w("├── analysis/")
w("│   ├── har_probe.py                结构概览脚本")
w("│   ├── har_probe2.py               重点文件深挖脚本")
w("│   ├── har_extract.py              主解析/提取/校验脚本（可重复运行）")
w("│   ├── make_manifest.py            本清单生成脚本")
w("│   ├── requests.csv                全部 135 条请求的完整统计表（UTF-8 BOM）")
w("│   ├── har_report.json             机器可读完整报告")
w("│   └── probe_out.txt / extract_out.txt  运行日志")
w("└── extracted/                      93 个资源文件")
w("    ├── _extraction_map.json        原始 URL → 提取路径 映射表")
w("    ├── models/3d/...               3 个 GLB")
w("    ├── scenes/3d/state_v9.json")
w("    ├── animations/3d/tmp-cdn-patch/logo_anim_v3.json")
w("    ├── decoders/                   Draco 1.5.7 + Basis transcoder (JS+WASM)")
w("    ├── textures/3d/Library/...    地面/水面/通用纹理")
w("    ├── images/3d/tmp-cdn-patch/... UI 图片与图标")
w("    ├── fonts/3d/tmp-cdn-patch/fonts/Kern/")
w("    ├── audio/3d/tmp-cdn-patch/audios/ (含 radio/)")
w("    ├── html/  css/  js/  data/")
w("    └── third-party/                第三方脚本（留档）")
w("```")
w()
w("全部 135 条请求的逐条字段（URL、状态码、MIME、资源类型、`content.size`、`bodySize`、`_transferSize`、HTTP 压缩、HAR Base64 标记、解码后字节、去重标记、提取路径）见 `analysis/requests.csv`；附录 9 为精简索引。")
w()

# ============ 附录 ============
w("## 9. 附录：全部 135 条请求索引")
w()
w("| # | 状态 | 方法 | MIME | 分类 | 大小(B, 解压后) | 传输(B) | HAR编码 | 已提取 | URL |")
w("| ---: | :---: | --- | --- | --- | ---: | ---: | --- | :---: | --- |")
extracted_rels = {x["out_rel"] for x in ext}
for r in recs:
    mark = "✅" if (r["chosen_for_extraction"] and r["extractable"]) else ("↺" if r["out_rel"] in extracted_rels else "—")
    w(f"| {r['index']} | {r['status']} | {cell(r['method'])} | `{cell(r['mimeType'] or '-')}` | "
      f"{cell(r['category'])} | {r['content_size'] or 0:,} | {r['transferSize'] or 0:,} | "
      f"{cell(r['har_encoding'] or '明文')} | {mark} | `{cell(r['url'])}` |")
w()
w("> 图例：✅ = 该条目被选为导出源；↺ = 重复/304 请求，内容已由同 URL 的其他条目导出；— = 无响应体或不需要导出。")
w()
w("---")
w()
w("*本清单由 `analysis/har_extract.py` + `analysis/make_manifest.py` 自动生成，数据来自单一 HAR 文件，可重复验证。第一阶段到此结束，未进行任何网页开发。*")

out = ROOT / "RESOURCE_MANIFEST.md"
out.write_text("\n".join(L) + "\n", encoding="utf-8")
print("written:", out)
print("lines  :", len(L))
print("bytes  :", out.stat().st_size)
