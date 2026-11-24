import core, { types } from '@theatre/core'

/**
 * 原站动画运行时。
 *
 * state_v9.json 是 Theatre.js 的 project state 导出（definitionVersion 0.4.0），
 * 结构为 sheetsById{game,World,bike,Orbital Sequence} + staticOverrides + sequence。
 * 只有 `Orbital Sequence` 带 sequence（PositionalSequence，length 10，
 * subUnitsPerUnit 30），其中 14 组对象轨道（相机 ×4、Zone Visibility ×2、
 * Dust、Day-Night、Door、DoorEnd、Fog、Sound ×3）。
 *
 * 经验证 @theatre/core 0.7.2 可以直接消费该 state：
 * project ready 后 `sheet('Orbital Sequence').object('Camera / Views / HomeDesktop')`
 * 在 t=0 读出 (-1.102, 0.6, 1.8)/(0.1, 0.4, 0.2)/fov 91/far 200，
 * 与实测原站首页机位一致。
 *
 * 驱动方式（原站 SequenceBundle.updateCameraSequence）：
 *   sequence.position = ((2π - phi mod 2π) + 2π) mod 2π × 10 / 2π
 * 即摩托绕轨道的角度映射为时间轴位置，所有轨道随之联动。
 */
export interface OrbitalTheatre {
  project: unknown
  sheet: any
  sequence: any
}

let instance: Promise<OrbitalTheatre> | null = null

export { types }

export function loadOrbitalTheatre(
  stateUrl = '/assets/scenes/3d/state_v9.json'
): Promise<OrbitalTheatre> {
  if (!instance) {
    instance = (async () => {
      const res = await fetch(stateUrl)
      if (!res.ok) throw new Error(`[theatre] state fetch failed: ${res.status}`)
      const state = await res.json()
      const project = (core as any).getProject('Molazone', { state })
      await project.ready
      const sheet = project.sheet('Orbital Sequence')
      return { project, sheet, sequence: sheet.sequence }
    })()
  }
  return instance
}

/** 相机视图对象的默认 props（key 必须与 state 中一致，否则 Theatre 无法回填） */
export const CAMERA_VIEW_PROPS = {
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  lookAtX: 0,
  lookAtY: 0,
  lookAtZ: 0,
  fov: 55,
  far: 150
} as const

/**
 * 原站 SequenceBundle.create$4 的区组列表（顺序一致）：
 *   objects = [...].map(name => getScene().getObjectByName(name)).filter(Boolean)
 *   props   = objects.reduce((o, g) => (o[g.name] = types.boolean(g.visible), o), {})
 * 注意是 `shop` 不是 `flare`；且默认值取 GLB 节点自身的 visible，
 * 而不是统一 false —— 没有关键帧覆盖的组（palace_outer / shop / birds /
 * zone_1_2 / zone_2_3）会一直保持 GLB 的初始可见状态。
 */
export const ZONE_KEYS = [
  'zone_0',
  'zone_0_1',
  'zone_1',
  'zone_1_2',
  'zone_2',
  'zone_2_3',
  'zone_3',
  'palace_inner',
  'palace_outer',
  'shop',
  'birds'
] as const

/** 原站 updateCameraSequence：bike 的 phi → sequence position（0..10） */
export function phiToSequencePosition(phi: number): number {
  const TAU = Math.PI * 2
  const s = ((TAU - (phi % TAU)) + TAU) % TAU
  return (s * 10) / TAU
}
