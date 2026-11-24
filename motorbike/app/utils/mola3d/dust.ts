import * as THREE from 'three'

/**
 * 后轮扬尘（原站 `initBikeParticles` / particleState）。
 *
 * 原站参数（gpNsPhdA.js）：
 *  - count 400，贴图 /3d/texture/dust.png（200×200 RGBA），挂在 bike root 下 z=0.9
 *  - emitter rate = speed·2.6·rateFactor·200（<50 时为 0），lifetime .4
 *  - spread 0 → .05 → .55 → .1，size 100 → 600 → 1100 → 500 → 0
 *  - 两条 CatmullRom 曲线（左右各一）作为粒子运动轨迹，整体往后下方甩
 *  - 颜色 #be8769，`Dust / rateFactor` 轨道（0 / 100 / 70 / 0）控制浓度，
 *    `Dust / color` 轨道控制颜色
 *
 * 这里用单个 Points + 自定义 shader 复刻：同样的寿命/尺寸曲线/染色，
 * 轨迹用「出生点 + 速度」近似原站的曲线采样，视觉等价。
 */

const COUNT = 400
const LIFETIME = 0.4
/** 出生点（bike root 局部坐标，原站 P.position.z = 0.9） */
const SPAWN = new THREE.Vector3(0, 0, 0.9)

interface Particle {
  alive: boolean
  age: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  /** 出生时的侧向铺开量，对应原站 spread 曲线 */
  spread: number
  tile: number
}

export interface DustTrail {
  object: THREE.Points
  /** speed：0..0.02 的轨道速度（原站 bikeState.speed 同量纲） */
  update(dt: number, speed: number, rateFactor: number): void
  setColor(color: THREE.Color): void
  setOpacity(v: number): void
  dispose(): void
}

export function createDustTrail(map: THREE.Texture): DustTrail {
  const positions = new Float32Array(COUNT * 3)
  const sizes = new Float32Array(COUNT)
  const alphas = new Float32Array(COUNT)
  const tiles = new Float32Array(COUNT)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('aTile', new THREE.BufferAttribute(tiles, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setDrawRange(0, COUNT)

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: map },
      uColor: { value: new THREE.Color('#be8769') },
      uOpacity: { value: 1 }
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute float aTile;
      varying float vAlpha;
      varying float vTile;
      void main() {
        vAlpha = aAlpha;
        vTile = aTile;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // 原站 size 是「世界单位 × ~600」，这里换算成像素并做透视衰减
        gl_PointSize = aSize * 600.0 / max(0.001, -mv.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      varying float vTile;
      void main() {
        // 原站用 2×2 图集（tile 0.5）随机取样，避免所有粒子长得一样
        vec2 cell = vec2(mod(vTile, 2.0), floor(vTile / 2.0)) * 0.5;
        vec4 tex = texture2D(uMap, cell + gl_PointCoord * 0.5);
        float a = max(tex.a, tex.r) * vAlpha * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'dust_trail'
  points.frustumCulled = false
  points.position.copy(SPAWN)
  // 不参与描边的 identity pass
  points.layers.set(1)

  const particles: Particle[] = []
  for (let i = 0; i < COUNT; i++) {
    particles.push({ alive: false, age: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spread: 0, tile: i % 4 })
  }

  let acc = 0
  let cursor = 0
  let rate = 0

  const tmp = new THREE.Vector3()

  return {
    object: points,
    update(dt, speed, rateFactor) {
      // 原站：(game ? speed*2.6 : |speed|) * rateFactor → rate = value*200，<50 视为 0
      const v = speed * 2.6 * rateFactor
      rate = Math.floor(v * 200)
      if (rate < 50) rate = 0
      // uSize = V*0.4 + 0.6（原站）
      const sizeScale = v * 0.4 + 0.6

      acc += dt * rate
      let spawn = Math.floor(acc)
      acc -= spawn
      while (spawn-- > 0) {
        const p = particles[cursor]!
        cursor = (cursor + 1) % COUNT
        const side = Math.random() < 0.5 ? -1 : 1
        const spread = Math.random() * 0.1
        p.alive = true
        p.age = 0
        p.spread = spread
        p.pos.set(side * spread, 0, 0)
        // 轨迹近似：主要往车后（局部 -z）甩，带一点侧向与上抛
        p.vel.set(
          side * (0.6 + Math.random() * 1.6) * (0.4 + v * 0.6),
          (0.15 + Math.random() * 0.5) * (0.5 + v * 0.5),
          -(4 + Math.random() * 4) * (0.5 + v * 0.7)
        )
      }

      for (let i = 0; i < COUNT; i++) {
        const p = particles[i]!
        if (!p.alive) {
          alphas[i] = 0
          sizes[i] = 0
          continue
        }
        p.age += dt
        const t = p.age / LIFETIME
        if (t >= 1) {
          p.alive = false
          alphas[i] = 0
          sizes[i] = 0
          continue
        }
        tmp.copy(p.vel).multiplyScalar(dt)
        p.pos.add(tmp)
        // 阻力：越到后期越慢（近似原站曲线末端的收束）
        p.vel.multiplyScalar(1 - 2.2 * dt)

        positions[i * 3] = p.pos.x
        positions[i * 3 + 1] = p.pos.y
        positions[i * 3 + 2] = p.pos.z

        // size 曲线：1.0 → 6 → 11 → 5 → 0（原站 100→1100→0 的归一化）
        const sizeCurve =
          t < 0.15
            ? THREE.MathUtils.lerp(1, 6, t / 0.15)
            : t < 0.3
              ? THREE.MathUtils.lerp(6, 11, (t - 0.15) / 0.15)
              : t < 0.9
                ? THREE.MathUtils.lerp(11, 5, (t - 0.3) / 0.6)
                : THREE.MathUtils.lerp(5, 0, (t - 0.9) / 0.1)
        sizes[i] = sizeCurve * 0.02 * sizeScale
        // 快速淡入、缓慢淡出
        alphas[i] = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85
        tiles[i] = p.tile
      }

      geometry.attributes.position!.needsUpdate = true
      geometry.attributes.aSize!.needsUpdate = true
      geometry.attributes.aAlpha!.needsUpdate = true
      geometry.attributes.aTile!.needsUpdate = true
    },
    setColor(color) {
      ;(material.uniforms.uColor!.value as THREE.Color).copy(color)
    },
    setOpacity(v) {
      material.uniforms.uOpacity!.value = v
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      points.removeFromParent()
    }
  }
}
