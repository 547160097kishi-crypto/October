/**
 * 十月模型的 Toon 配色。
 *
 * 源模型（C4D 导出）1013 个材质全部是白色、没有贴图，颜色无法从模型读取，因此按节点路径分配色板。
 * 色板格式与 motorbike 的 toon-colors.json 一致：
 *   d  = directColor（受光面）   i  = indirectColor（背光 / 阴影）   l  = luminance
 *   nd / ni / nl = 「暮色」版本（对应 motorbike 原站的 night 色板，用 setToonPaletteMix 插值）
 *
 * 两类来源：
 *  1. 十月场景里有一批资源与 motorbike 场景同源（arch0xx / big_arch / palace / stair / terasse /
 *     rock_dune_xx_root / batiment ……），这些直接复用 motorbike 逆向出的 toon-colors.json 原值。
 *  2. 其余（凯旋门、圣心教堂、巴黎圣母院、枫树、老爷车……）是十月独有的，这里按「十月 / 秋日」主题配色。
 *     这一类用「屏幕上想看到的 sRGB 颜色」书写，再转线性写进 uniform —— 因为渲染管线最后会做一次
 *     sRGB 编码（与 motorbike 一致），这样屏幕呈现正好等于这里写的十六进制色。
 */
import * as THREE from 'three'
import type { ToonPalette } from './toonMaterial'
import motorbikeColors from './motorbike-toon-colors.json'

const MB_WORLD = (motorbikeColors as { world: Record<string, ToonPalette> }).world

const _c = new THREE.Color()
function lin(hex: string): [number, number, number] {
  _c.set(hex) // three 的 ColorManagement 会把 sRGB hex 转成线性
  return [_c.r, _c.g, _c.b]
}

/** 用 sRGB hex 定义色板；暮色版：受光面偏橙红、阴影偏紫蓝 */
function pal(direct: string, indirect: string, opts: { l?: number; dusk?: [string, string] } = {}): ToonPalette {
  const d = lin(direct)
  const i = lin(indirect)
  const nd = opts.dusk ? lin(opts.dusk[0]) : ([d[0] * 0.9, d[1] * 0.55, d[2] * 0.42] as [number, number, number])
  const ni = opts.dusk ? lin(opts.dusk[1]) : ([i[0] * 0.5, i[1] * 0.42, i[2] * 0.9] as [number, number, number])
  return { d, i, l: opts.l ?? 1, nd, ni, nl: (opts.l ?? 1) * 0.95 }
}

/** motorbike 原值（没有 night 版本的补一个暮色版） */
function mb(key: string): ToonPalette | undefined {
  const p = MB_WORLD[key]
  if (!p) return undefined
  const night = p.nd && (p.nd[0]! + p.nd[1]! + p.nd[2]! > 0) ? p.nd : [p.d[0]! * 0.9, p.d[1]! * 0.55, p.d[2]! * 0.42]
  const nightI = p.ni && (p.ni[0]! + p.ni[1]! + p.ni[2]! > 0) ? p.ni : [p.i[0]! * 0.5, p.i[1]! * 0.42, p.i[2]! * 0.9]
  return { d: p.d, i: p.i, l: p.l, nd: night, ni: nightI, nl: p.nl ?? p.l }
}

export const PALETTES: Record<string, ToonPalette> = {
  // ---- 地标建筑 ----
  arc: pal('#e2cfb0', '#8a7487'), // 凯旋门：暖石灰岩
  sacre: pal('#f1ece0', '#9c97b3'), // 圣心教堂：白色石灰华
  notre: pal('#d3c3a8', '#7d6e80'), // 巴黎圣母院：灰米色
  stone: pal('#cdbfae', '#76697a'), // 桥 / 长廊 / 水池 / 杂项石构
  pillar: pal('#dccbb2', '#85707d'), // 柱子
  gallery: pal('#b9a58c', '#5e4f5c'), // 柱子画廊 顶棚
  frame: pal('#e9dfcd', '#4a3d45'), // 画框
  signBoard: pal('#2f4a3e', '#13201d'), // 牌子
  signText: pal('#efe6d2', '#8c7f86'),
  console: pal('#6f978c', '#2e4248'), // 操作台：复古青绿
  wood: pal('#7a5034', '#33201d'),
  building: pal('#ddd6cb', '#8a7a7c'),

  // ---- 植物（十月：枫红、银杏黄、枯草）----
  maple: pal('#f05a28', '#8e2328', { dusk: ['#e0482c', '#4c1838'] }), // 枫叶
  mapleDeep: pal('#d23c22', '#6c1a24', { dusk: ['#b83224', '#3c1230'] }),
  fallen: pal('#e08a3a', '#8a3f2c'), // 落叶堆
  trunk: pal('#5e4032', '#2a1a1c'),
  leafStem: pal('#7a4a2a', '#341c1a'),
  ginkgo: pal('#f2b631', '#93582b', { dusk: ['#e49030', '#57303f'] }), // 秋树：金黄
  grass: pal('#d9b65a', '#7b6436'), // 枯草
  soil: pal('#a47c58', '#55403f'),
  cactus: pal('#7f8c52', '#3a4430'),

  // ---- 石头 / 地面 / 水 ----
  rock: pal('#b5a28e', '#625362'),
  rockWarm: pal('#c09a7c', '#6a4b4f'),
  ground: pal('#d8b98e', '#8d6f68', { dusk: ['#c78a62', '#4f3a52'] }),
  groundAlt: pal('#b99a6c', '#6e5852'),
  water: pal('#7fb3c2', '#3a5f7a', { dusk: ['#a07f9c', '#2a2f55'] }),
  // 喷泉水柱：受光色与河面 / 水池同一个蓝（water.d），背光只比它深一点（两阶、差距小 → 显得轻）
  waterJet: pal('#7fb3c2', '#6a9fb2', { dusk: ['#a07f9c', '#8a7193'] }),

  // ---- 老爷车（按 C4D 材质名：漆面 / 镍银 / 枪灰 / 胎面 / 皮革 / 尾灯 / 玻璃）----
  carPaint: pal('#8e1f2b', '#3d0d1c', { dusk: ['#8a1c24', '#260a1e'] }), // 酒红
  carNickel: pal('#e9e7e2', '#5f6472', { dusk: ['#f0b48a', '#3b3456'] }),
  carGun: pal('#4a4c52', '#17181d'),
  carTread: pal('#26262a', '#0b0b0e'),
  carLeather: pal('#7b4a2e', '#311b15'),
  carLight: pal('#e8402e', '#7a1a18'),
  carGlass: pal('#3c4a5c', '#11161f'),

  fallback: pal('#d2c6b6', '#7a6d7a')
}

const MB_PREFIXES = /^(arch0\d\d|big_arch0\d\d|palace\d*|palace_\w+|stair_step006|stair_impo|terasse|rock_dune_0\d_root|rock_dune_05|batiment)$/

/** 'arch010_12' → 'arch010'；'rock_dune_01_root_6.1' → 'rock_dune_01_root' */
function motorbikeKey(name: string): string | null {
  let n = name.replace(/(\.\d+)+$/, '')
  for (let k = 0; k < 3; k++) {
    if (MB_PREFIXES.test(n) && MB_WORLD[n]) return n
    const m = n.match(/^(.*)_\d+$/)
    if (!m) break
    n = m[1]!
  }
  return MB_PREFIXES.test(n) && MB_WORLD[n] ? n : null
}

/** 路径规则：自上而下首个命中生效。path 是从场景根开始、用 '/' 连接的节点名 */
const RULES: [RegExp, string][] = [
  // 老爷车：子网格名带 C4D 材质名
  [/老爷车.*漆面/, 'carPaint'],
  [/老爷车.*镍银/, 'carNickel'],
  [/老爷车.*枪灰/, 'carGun'],
  [/老爷车.*胎面/, 'carTread'],
  [/老爷车.*皮革/, 'carLeather'],
  [/老爷车.*尾灯/, 'carLight'],
  [/老爷车.*OctGlossy/, 'carGlass'],
  [/老爷车/, 'carPaint'],

  // 地面 / 水
  [/河面/, 'water'],
  [/地面-OctDiffuse/, 'groundAlt'],
  [/^地面\/地面/, 'ground'],
  [/cactus|仙人掌/i, 'cactus'],
  [/^地面\/石头/, 'rockWarm'],

  // 植物
  [/叶茎/, 'leafStem'],
  [/叶片/, 'maple'],
  [/树干/, 'trunk'],
  [/-OctDiffuse3/, 'maple'],
  [/-OctDiffuse4/, 'fallen'],
  [/(枫树|P5\/左|P7\/右)\/.*石头/, 'rock'],
  [/(枫树|P5\/左|P7\/右)\/.*草/, 'grass'],
  [/(枫树|P5\/左|P7\/右)\//, 'soil'],
  [/tree_0\d_instance/, 'ginkgo'],
  [/grass_0\d/, 'grass'],

  // 建筑
  [/凯旋门/, 'arc'],
  [/圣心教堂/, 'sacre'],
  [/巴黎圣母院/, 'notre'],
  [/柱子画廊\/Group\/Group/, 'gallery'],
  [/柱子画廊\/.*(新框|Plane)$/, 'frame'],
  [/柱子画廊/, 'pillar'],
  [/柱子/, 'pillar'],
  [/牌子\/内容/, 'signText'],
  [/牌子/, 'signBoard'],
  [/操作台/, 'console'],
  [/minioso\/(门框|正门)/, 'wood'],
  [/minioso/, 'building'],
  [/statue/, 'arc'],
  [/大框架/, 'stone'],
  [/桥|长廊|水池|P5\/00/, 'stone'],
  [/石头|rock|\/\d+$|Editable_mesh-22174469-009/i, 'rock']
]

export interface PaletteChoice {
  key: string
  palette: ToonPalette
}

const mbCache = new Map<string, ToonPalette>()

export function paletteForPath(path: string): PaletteChoice {
  const leaf = path.split('/').pop() ?? ''
  const mk = motorbikeKey(leaf)
  if (mk) {
    if (!mbCache.has(mk)) mbCache.set(mk, mb(mk)!)
    return { key: `mb:${mk}`, palette: mbCache.get(mk)! }
  }
  for (const [re, key] of RULES) if (re.test(path)) return { key, palette: PALETTES[key]! }
  return { key: 'fallback', palette: PALETTES.fallback! }
}
