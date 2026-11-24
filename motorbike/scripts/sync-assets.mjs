/**
 * 静态资源同步脚本（npm run assets:sync）
 *
 * 将第一阶段提取的资源镜像到 Nuxt 的 public/ 目录：
 *   extracted/**            -> public/assets/**   （保留原始层级，93 个资源）
 *   extracted/.../Kern/*.woff2 -> public/fonts/   （供全局 CSS @font-face 引用）
 *
 * 特性：
 *   - extracted/ 原目录永不修改（只读源）
 *   - 幂等：重复执行结果一致
 *   - 同步后按 _extraction_map.json 逐一核对，报告缺失
 */
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'extracted')
const DEST = join(ROOT, 'public', 'assets')
const FONTS_SRC = join(ROOT, 'extracted', 'fonts', '3d', 'tmp-cdn-patch', 'fonts', 'Kern')
const FONTS_DEST = join(ROOT, 'public', 'fonts')

if (!existsSync(SRC)) {
  console.error(`[assets:sync] 找不到源目录 ${SRC}，请先完成第一阶段提取。`)
  process.exit(1)
}

// 1) 镜像 extracted/ -> public/assets/
rmSync(DEST, { recursive: true, force: true })
cpSync(SRC, DEST, { recursive: true })
// 映射表属于分析产物，不对外服务
rmSync(join(DEST, '_extraction_map.json'), { force: true })

// 2) 字体 -> public/fonts/
mkdirSync(FONTS_DEST, { recursive: true })
cpSync(FONTS_SRC, FONTS_DEST, { recursive: true })

// 3) 依据第一阶段映射表核对
const map = JSON.parse(readFileSync(join(SRC, '_extraction_map.json'), 'utf8')).mapping
const missing = Object.values(map).filter((rel) => !existsSync(join(DEST, rel)))
const fontOk = ['Kern-Regular.woff2', 'Kern-Medium.woff2', 'Kern-Bold.woff2']
  .every((f) => existsSync(join(FONTS_DEST, f)))

console.log(`[assets:sync] 资源镜像完成：${Object.keys(map).length - missing.length}/${Object.keys(map).length} 个文件就绪`)
console.log(`[assets:sync] 字体就绪：${fontOk ? 'Kern Regular/Medium/Bold ✓' : '缺失！'}`)
if (missing.length) {
  console.error('[assets:sync] 缺失文件：')
  for (const m of missing) console.error('   -', m)
  process.exit(1)
}
