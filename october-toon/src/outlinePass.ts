/**
 * 原站描边后处理移植 —— MoebiusEffect
 *
 * 原站渲染分三步（gpNsPhdA.js create$7）：
 *   1) 用 MoebiusSelectMaterial 作为 scene.overrideMaterial，把场景画进一张 RT：
 *      每个 mesh 输出一个「唯一 identity 颜色 + gl_FragCoord.z * 0.05」，
 *      没有 identity 的对象（地面 / 天空）discard → 保持背景色。
 *   2) 正常渲染场景（EffectComposer 的 RenderPass）。
 *   3) MoebiusEffect 用 3×3 Sobel 对 identity RT 的 luma 求边缘，
 *      outline = length(gradient) * uIntensity，再把颜色 mix 成黑色。
 *
 * 由于 identity 图内部是纯色块，Sobel 只会在物体轮廓处响应 → 得到「手绘描边」，
 * 且保留透明度边缘。这里用一张 RT + 一个全屏合成 pass 复刻同样流程。
 */
import * as THREE from 'three'

/** 原站 rendererConfig.moebius（desktop） */
export const MOEBIUS_CONFIG = {
  frequency: 0.3,
  amplitude: 0,
  intensity: 100,
  /** 原站创建时用的是 mobile 值，GUI 未操作过就是 0.02 */
  thickness: 0.02
}

const SELECT_VERT = /* glsl */ `
  uniform vec3 uIdentity;
  attribute vec3 aIdentity;

  varying vec4 vColor;

  #include <skinning_pars_vertex>

  void main() {
    vec3 transformed = position;

    #include <skinbase_vertex>
    #include <skinning_vertex>

    vec4 mvPosition = vec4( transformed, 1.0 );

    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
    #endif

    vec3 ident = uIdentity;
    #ifdef USE_INSTANCING
      ident = aIdentity;
    #endif

    vColor = vec4( ident, 1.0 );

    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const SELECT_FRAG = /* glsl */ `
  varying vec4 vColor;

  void main() {
    float depth = gl_FragCoord.z * 0.05;
    gl_FragColor = vec4( vColor.rgb + vec3( depth ), 1.0 );
  }
`

const COMPOSITE_FRAG = /* glsl */ `
  uniform float uIntensity;
  uniform float uAmplitude;
  uniform float uFrequency;
  uniform float uThickness;
  uniform sampler2D uSource;
  uniform sampler2D uColor;
  uniform vec2 resolution;

  varying vec2 vUv;

  const mat3 Sx = mat3( -1, -2, -1, 0, 0, 0, 1, 2, 1 );
  const mat3 Sy = mat3( -1, 0, 1, -2, 0, 2, -1, 0, 1 );

  float hash(vec2 p) {
      vec3 p3  = fract(vec3(p.xyx) * .1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
  }

  float lumaText(sampler2D tex, vec2 uv) {
      const vec3 magic = vec3(0.2125, 0.7154, 0.0721);
      return dot(magic, texture2D(tex, uv).rgb);
  }

  void main() {
    vec2 texel = vec2( 1.0 / resolution.x, 1.0 / resolution.y );

    vec4 outlineColor = vec4(0.0, 0.0, 0.0, 1.0);

    vec2 displacement = vec2(
      (hash(gl_FragCoord.xy) * sin(gl_FragCoord.y * uFrequency)) ,
      (hash(gl_FragCoord.xy) * cos(gl_FragCoord.x * uFrequency))
    ) * uAmplitude / resolution.xy;

    float depth00 = lumaText(uSource, vUv + displacement + uThickness * texel * vec2(-1, 1));
    float depth01 = lumaText(uSource, vUv + displacement + uThickness * texel * vec2(-1, 0));
    float depth02 = lumaText(uSource, vUv + displacement + uThickness * texel * vec2(-1, -1));

    float depth10 = lumaText(uSource, vUv + displacement + uThickness * texel * vec2(0, -1));
    float depth11 = lumaText(uSource, vUv + displacement + uThickness * texel * vec2(0, 0));
    float depth12 = lumaText(uSource, vUv + displacement + uThickness * texel * vec2(0, 1));

    float depth20 = lumaText(uSource, vUv + displacement + uThickness * texel * vec2(1, -1));
    float depth21 = lumaText(uSource, vUv + displacement + uThickness * texel * vec2(1, 0));
    float depth22 = lumaText(uSource, vUv + displacement + uThickness * texel * vec2(1, 1));

    float xSobelValueDepth =
      Sx[0][0] * depth00 + Sx[1][0] * depth01 + Sx[2][0] * depth02 +
      Sx[0][1] * depth10 + Sx[1][1] * depth11 + Sx[2][1] * depth12 +
      Sx[0][2] * depth20 + Sx[1][2] * depth21 + Sx[2][2] * depth22;

    float ySobelValueDepth =
      Sy[0][0] * depth00 + Sy[1][0] * depth01 + Sy[2][0] * depth02 +
      Sy[0][1] * depth10 + Sy[1][1] * depth11 + Sy[2][1] * depth12 +
      Sy[0][2] * depth20 + Sy[1][2] * depth21 + Sy[2][2] * depth22;

    float outline = clamp(sqrt(pow(xSobelValueDepth, 2.0) + pow(ySobelValueDepth, 2.0)) * uIntensity, 0.0, 1.0);

    vec3 color = texture2D(uColor, vUv).rgb;

    gl_FragColor = vec4( mix(color, outlineColor.rgb, outline), 1.0 );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** 原站 generateColorSequenceFromLevel 的等价实现：给每个物体分配互不相同的灰度 identity */
const IDENTITY_LEVELS = [0.5, 0.19, 0.82, 0.34, 0.66, 0.07, 0.93, 0.44, 0.58, 0.26, 0.74, 0.12]
let identityCursor = 3

function nextIdentity(out: THREE.Vector3) {
  const v = IDENTITY_LEVELS[identityCursor % IDENTITY_LEVELS.length]
  identityCursor++
  out.set(v, v, v)
  return out
}

export class MoebiusOutline {
  private renderer: THREE.WebGLRenderer
  private selectMaterial: THREE.ShaderMaterial
  private compositeMaterial: THREE.ShaderMaterial
  private identityTarget: THREE.WebGLRenderTarget
  private colorTarget: THREE.WebGLRenderTarget
  private quadScene: THREE.Scene
  private quadCamera: THREE.OrthographicCamera
  private quad: THREE.Mesh
  private tmpIdentity = new THREE.Vector3()
  private width = 1
  private height = 1
  /** identity pass 期间为 true，onBeforeRender 据此写入逐物体 identity */
  private identityPass = false
  /** 是否启用描边（调试用） */
  enabled = true

  /** 原站 `rendererState.moebiusEffect.thickness`：由 `Fog / thichness` 轨道驱动 */
  setThickness(v: number) {
    this.compositeMaterial.uniforms.uThickness!.value = v
  }

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer

    this.selectMaterial = new THREE.ShaderMaterial({
      uniforms: { uIdentity: { value: new THREE.Vector3(0, 0, 0) } },
      vertexShader: SELECT_VERT,
      fragmentShader: SELECT_FRAG
    })

    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uIntensity: { value: MOEBIUS_CONFIG.intensity },
        uAmplitude: { value: MOEBIUS_CONFIG.amplitude },
        uFrequency: { value: MOEBIUS_CONFIG.frequency },
        uThickness: { value: MOEBIUS_CONFIG.thickness },
        uSource: { value: null },
        uColor: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4( position.xy, 0.0, 1.0 );
        }
      `,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false
    })

    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    this.width = size.x
    this.height = size.y
    this.compositeMaterial.uniforms.resolution.value.set(size.x, size.y)
    // identity 里叠加了 gl_FragCoord.z * 0.05 的深度项：8-bit RT 下它每跨一个 1/255 台阶，
    // Sobel × 100 就会在地面上画出一条横贯画面的假描边，所以用 HalfFloat
    this.identityTarget = this.makeTarget(size.x, size.y, THREE.HalfFloatType)
    this.colorTarget = this.makeTarget(size.x, size.y, THREE.HalfFloatType)

    this.quadScene = new THREE.Scene()
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
  }

  private makeTarget(w: number, h: number, type: THREE.TextureDataType) {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      type,
      colorSpace: THREE.NoColorSpace
    })
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    this.compositeMaterial.uniforms.resolution.value.set(w, h)
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.identityTarget.setSize(w, h)
    this.colorTarget.setSize(w, h)
  }

  /**
   * 给需要描边的对象打 identity：普通 mesh 用 uniform（onBeforeRender 逐物体写入），
   * InstancedMesh 用逐实例 attribute（原站 createUniqueAttributeId 同机制）。
   */
  register(root: THREE.Object3D, filter?: (obj: THREE.Mesh) => boolean) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      if (filter && !filter(mesh)) return
      const instanced = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh
      if (instanced) {
        const geom = mesh.geometry
        if (!geom.getAttribute('aIdentity')) {
          const im = mesh as unknown as THREE.InstancedMesh
          const count = im.count
          const colors = new Float32Array(count * 3)
          const v = new THREE.Vector3()
          for (let i = 0; i < count; i++) {
            nextIdentity(v)
            colors[i * 3] = v.x
            colors[i * 3 + 1] = v.y
            colors[i * 3 + 2] = v.z
          }
          geom.setAttribute('aIdentity', new THREE.InstancedBufferAttribute(colors, 3, false))
        }
      }
      nextIdentity(this.tmpIdentity)
      const id = this.tmpIdentity.clone()
      mesh.userData.moebiusIdentity = true
      mesh.onBeforeRender = () => {
        if (this.identityPass) this.setIdentity(id)
      }
    })
  }

  /**
   * 写入当前物体的 identity。
   * 注意 three 对「同一个材质连续绘制」不会重新上传 uniform（refreshMaterial=false），
   * override 材质在整个 identity pass 里都是同一个，所以必须置 uniformsNeedUpdate，
   * 否则所有物体都会用同一个 identity → 物体之间、物体与地面之间都没有描边，
   * 只剩与背景（天空）交界处的轮廓。motorbike 的 outlinePass.ts 也有这个问题。
   */
  private setIdentity(id: THREE.Vector3) {
    this.selectMaterial.uniforms.uIdentity!.value.copy(id)
    this.selectMaterial.uniformsNeedUpdate = true
  }

  /**
   * 不描边的对象（地面 / 水面）：identity pass 里写固定 identity。
   * 原站注释说这类对象应「保持背景色」，但移植版没给它们设 onBeforeRender，
   * 结果它们会沿用上一个物体的 identity（随绘制顺序闪烁出假描边）。这里统一写一个常量，
   * 地面与其上的物体之间仍有轮廓线，而地面各块之间不会出现接缝线。
   */
  registerFlat(root: THREE.Object3D, filter: (obj: THREE.Mesh) => boolean, value = 0.0) {
    const id = new THREE.Vector3(value, value, value)
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !filter(mesh)) return
      mesh.onBeforeRender = () => {
        if (this.identityPass) this.setIdentity(id)
      }
    })
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const renderer = this.renderer
    const prevOverride = scene.overrideMaterial
    const prevTarget = renderer.getRenderTarget()

    if (this.enabled) {
      // 1) identity pass：layer 1（天空 / 不做描边的物体）不参与
      camera.layers.disable(1)
      scene.overrideMaterial = this.selectMaterial
      this.identityPass = true
      renderer.setRenderTarget(this.identityTarget)
      renderer.clear()
      renderer.render(scene, camera)
      this.identityPass = false
      scene.overrideMaterial = prevOverride

      // 2) 正常颜色 pass
      renderer.shadowMap.needsUpdate = true
      camera.layers.enable(1)
      renderer.setRenderTarget(this.colorTarget)
      renderer.clear()
      renderer.render(scene, camera)

      // 3) 描边合成到画布
      this.compositeMaterial.uniforms.uSource.value = this.identityTarget.texture
      this.compositeMaterial.uniforms.uColor.value = this.colorTarget.texture
      renderer.setRenderTarget(null)
      renderer.render(this.quadScene, this.quadCamera)
    } else {
      camera.layers.enable(1)
      renderer.setRenderTarget(prevTarget)
      renderer.render(scene, camera)
    }
  }

  /** 调试：读取颜色 pass 的原始像素（线性 HalfFloat，未做 sRGB 编码） */
  debugReadColor(x: number, y: number): number[] | null {
    const buf = new Float32Array(4)
    try {
      this.renderer.readRenderTargetPixels(this.colorTarget, x, y, 1, 1, buf)
      return Array.from(buf).map((v) => +v.toFixed(4))
    } catch (err) {
      console.warn('[outline] debugReadColor failed', err)
      return null
    }
  }

  dispose() {
    this.identityTarget.dispose()
    this.colorTarget.dispose()
    this.selectMaterial.dispose()
    this.compositeMaterial.dispose()
    this.quad.geometry.dispose()
  }
}
