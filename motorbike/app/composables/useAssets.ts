/**
 * 静态资源路径工具（composable，自动导入）
 *
 * 第一阶段资源镜像在 public/assets/ 下，保留了原始 URL 层级。
 * 用法：const { asset } = useAssets();  asset('models/3d/Scene/scene_v6.16.4.glb')
 */
export function useAssets() {
  const ASSET_BASE = '/assets'

  /** 将 extracted/ 下的相对路径转为可直接访问的 URL */
  const asset = (relativePath: string): string => {
    const clean = relativePath.replace(/^\/+/, '')
    return `${ASSET_BASE}/${clean}`
  }

  /** 第一阶段重点资源的常用快捷路径 */
  const keyAssets = {
    sceneGlb: `${ASSET_BASE}/models/3d/Scene/scene_v6.16.4.glb`,
    bikeGlb: `${ASSET_BASE}/models/3d/Library/bike/bike_v9.7.glb`,
    birdGlb: `${ASSET_BASE}/models/3d/Library/oiseau_v1.glb`,
    theatreState: `${ASSET_BASE}/scenes/3d/state_v9.json`,
    logoLottie: `${ASSET_BASE}/animations/3d/tmp-cdn-patch/logo_anim_v3.json`,
    dracoDecoder: `${ASSET_BASE}/decoders/www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.wasm`,
    dracoWrapper: `${ASSET_BASE}/decoders/www.gstatic.com/draco/versioned/decoders/1.5.7/draco_wasm_wrapper.js`,
    basisTranscoderJs: `${ASSET_BASE}/decoders/3d/basis/basis_transcoder.js`,
    basisTranscoderWasm: `${ASSET_BASE}/decoders/3d/basis/basis_transcoder.wasm`
  } as const

  return { asset, keyAssets }
}
