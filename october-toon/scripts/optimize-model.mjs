/**
 * 十月-test.glb（305 MB / 669 万三角，C4D 导出白模）→ Web 可用的 october.glb（~27 MB）
 *
 * 用法：npm run model -- <输入.glb> <输出.glb> [simplifyRatio=0.35] [simplifyError=0.0015]
 *   npm run model -- ../model/十月-test.glb public/models/october.glb
 *
 * 步骤：去 UV（无贴图，Toon shader 不需要）→ dedup（合并重复网格/材质）→ weld →
 *       meshopt simplify → resample 动画 → prune（保留空节点：相机/车的动画挂在空节点上）→
 *       量化 + EXT_meshopt_compression。节点名与层级保留（配色按节点路径分配）。
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, weld, simplify, quantize, meshopt, resample } from '@gltf-transform/functions'
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer'

const [, , inp, out, ratio = '0.35', err = '0.0015'] = process.argv
if (!inp || !out) {
  console.error('usage: optimize-model.mjs <in.glb> <out.glb> [ratio] [error]')
  process.exit(1)
}
await MeshoptSimplifier.ready
await MeshoptEncoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptEncoder })
const doc = await io.read(inp)

const triangles = () =>
  doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0)
console.log('triangles before', triangles())

for (const m of doc.getRoot().listMeshes()) {
  for (const p of m.listPrimitives()) if (p.getAttribute('TEXCOORD_0')) p.setAttribute('TEXCOORD_0', null)
}

await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: +ratio, error: +err, lockBorder: false }),
  resample(),
  prune({ keepLeaves: true })
)
console.log('triangles after', triangles(), 'meshes', doc.getRoot().listMeshes().length)

await doc.transform(
  quantize({ quantizePosition: 16, quantizeNormal: 10 }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' })
)
await io.write(out, doc)
console.log('written', out)
