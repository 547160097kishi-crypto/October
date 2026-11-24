/**
 * 描边 + 合成 + 抗锯齿（十月版，基于 motorbike 的 MoebiusEffect 移植改写）
 *
 * motorbike / 原站做法：identity pass（每个物体一个灰度 + gl_FragCoord.z·0.05）→ 3×3 Sobel，
 * 采样偏移 uThickness 个像素，结果 ×100 截断成黑线。问题：
 *   - 线宽以「像素」计：1080p 上粗、5K 上细，换屏就要重调；
 *   - ×100 截断让线宽在 0.05~1 之间几乎不随参数变化；
 *   - 纯黑线，远近一样重，远景小石子变成一片黑点；
 *   - 整个画面没有抗锯齿（渲染器 antialias:false）。
 *
 * 现在的管线（每帧 5 个 pass）：
 *   1. identity pass  → idTarget   R = 物体 identity，G = 线性深度 / far（HalfFloat）
 *   2. color pass     → colorTarget（线性 HDR，HalfFloat）
 *   3. edge pass      → edgeTarget  只在「前景一侧」标 1 像素边：
 *        - 物体边：相邻像素 identity 不同，深度更近的那一侧（等深时 identity 大的一侧）；
 *        - 深度边：1/z 的二阶差分（平面上恒为 0，斜看的地面不会误报），
 *          同一个模型自己前后遮挡的地方也能出线。
 *   4. ink composite  → ldrTarget   以边缘像素为中心按距离场画线，线宽 = 每 1080 像素高 N 像素
 *        （与分辨率无关），覆盖率自带抗锯齿；线色 = 所属物体颜色压暗 + 深梅棕墨色；
 *        按距离变细变淡（远处的线也带着雾色）；最后手动编码 sRGB。
 *   5. FXAA           → 画布        补上几何边、色带边、阴影边的抗锯齿。
 */
import * as THREE from 'three'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'

/** 描边参数（可由 main.ts / 网址参数覆盖） */
export const INK_DEFAULTS = {
  /** 线宽：每 1080 像素画面高度对应的像素数（1024 高的长条屏 ≈ 0.95 倍） */
  width: 1.2,
  /** 线色：0 = 纯墨色（深梅棕），1 = 完全取物体颜色压暗 */
  colorMix: 0.35,
  /** 距离衰减（世界单位）：near 之内满宽满浓，far 之外降到 farWidth / farAlpha */
  fadeNear: 80,
  fadeFar: 450,
  farWidth: 0.75,
  farAlpha: 0.7,
  /** 折线（法线夹角）：阈值角度、相对主线的宽度与浓度、最远绘制距离 */
  creaseAngle: 42,
  creaseWidth: 0.75,
  creaseAlpha: 0.7,
  creaseMaxZ: 160
}

/** identity pass 的深度归一化（= 相机 far） */
export const ID_FAR = 3000

const SELECT_VERT = /* glsl */ `
  uniform vec3 uIdentity;
  attribute vec3 aIdentity;
  varying float vIdent;
  varying float vViewZ;
  varying vec3 vNormal;

  #include <skinning_pars_vertex>

  void main() {
    vec3 transformed = position;
    #include <skinbase_vertex>
    #include <skinning_vertex>

    vec4 mvPosition = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
    #endif

    vIdent = uIdentity.r;
    #ifdef USE_INSTANCING
      vIdent = aIdentity.r;
    #endif

    mvPosition = modelViewMatrix * mvPosition;
    vViewZ = -mvPosition.z;
    vNormal = normalize( normalMatrix * normal );
    gl_Position = projectionMatrix * mvPosition;
  }
`

/** 八面体编码：单位法线 → 2 个分量（写进 identity 的 B、A） */
export const OCT_ENCODE = /* glsl */ `
  vec2 octEncode( vec3 n ) {
    n /= ( abs( n.x ) + abs( n.y ) + abs( n.z ) );
    vec2 s = vec2( n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0 );
    return n.z >= 0.0 ? n.xy : ( 1.0 - abs( n.yx ) ) * s;
  }
`

const SELECT_FRAG = /* glsl */ `
  uniform float uFar;
  varying float vIdent;
  varying float vViewZ;
  varying vec3 vNormal;
  ${OCT_ENCODE}
  void main() {
    vec3 n = normalize( vNormal );
    // 背面（双面材质）翻转，保证折线判断一致
    if ( !gl_FrontFacing ) n = -n;
    gl_FragColor = vec4( vIdent, vViewZ / uFar, octEncode( n ) );
  }
`

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`

const EDGE_FRAG = /* glsl */ `
  uniform sampler2D uId;
  uniform vec2 uTexel;
  uniform float uDepthK;
  varying vec2 vUv;

  uniform float uCreaseCos;
  uniform float uCreaseMaxZ;
  uniform float uFar;

  vec2 S( vec2 o ) { return texture2D( uId, vUv + o * uTexel ).rg; }
  vec4 S4( vec2 o ) { return texture2D( uId, vUv + o * uTexel ); }

  vec3 octDecode( vec2 e ) {
    vec3 n = vec3( e, 1.0 - abs( e.x ) - abs( e.y ) );
    if ( n.z < 0.0 ) n.xy = ( 1.0 - abs( n.yx ) ) * vec2( n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0 );
    return normalize( n );
  }

  // 折线：同一物体、深度连续，但法线夹角大于阈值（只和 +x、+y 邻居比，线只落在一侧 → 1 像素）
  float crease( vec4 c, vec4 n ) {
    if ( abs( c.x - n.x ) >= 0.015 ) return 0.0;
    if ( abs( c.y - n.y ) > 0.02 * c.y ) return 0.0;
    return dot( octDecode( c.ba ), octDecode( n.ba ) ) < uCreaseCos ? 1.0 : 0.0;
  }

  // c 与邻居 n 是不同物体，且 c 在前（更近；几乎等深时 identity 大的一侧）
  float idEdge( vec2 c, vec2 n ) {
    if ( abs( c.x - n.x ) < 0.015 ) return 0.0;
    float tie = 0.004 * max( n.y, 1e-4 );
    if ( c.y < n.y - tie ) return 1.0;
    if ( abs( c.y - n.y ) <= tie && c.x > n.x ) return 1.0;
    return 0.0;
  }

  // 1/z 在平面上沿屏幕是仿射的 → 二阶差分 ≈ 0；c 在深度断层的前侧时 lap 明显为负
  float depthEdge( vec2 c, vec2 a, vec2 b ) {
    // 地面（identity 0）不做深度边：斜看时地形坡度的拐折会让 1/z 二阶差分误报成横贯画面的线
    if ( c.x < 0.01 ) return 0.0;
    float ic = 1.0 / max( c.y, 1e-5 );
    float ia = 1.0 / max( a.y, 1e-5 );
    float ib = 1.0 / max( b.y, 1e-5 );
    float lap = ia + ib - 2.0 * ic;
    return lap < -uDepthK * ic ? 1.0 : 0.0;
  }

  void main() {
    vec2 c = S( vec2( 0.0 ) );
    if ( c.y >= 0.999 ) { gl_FragColor = vec4( 0.0 ); return; } // 背景
    vec2 r = S( vec2( 1.0, 0.0 ) );
    vec2 l = S( vec2( -1.0, 0.0 ) );
    vec2 u = S( vec2( 0.0, 1.0 ) );
    vec2 d = S( vec2( 0.0, -1.0 ) );
    float e = max( max( idEdge( c, r ), idEdge( c, l ) ), max( idEdge( c, u ), idEdge( c, d ) ) );
    e = max( e, max( depthEdge( c, r, l ), depthEdge( c, u, d ) ) );
    float k = 0.0;
    if ( e < 0.5 && c.y * uFar < uCreaseMaxZ ) {
      vec4 C = S4( vec2( 0.0 ) );
      k = max( crease( C, S4( vec2( 1.0, 0.0 ) ) ), crease( C, S4( vec2( 0.0, 1.0 ) ) ) );
    }
    // R = 轮廓 / 深度线（主线），G = 折线（次线）
    gl_FragColor = vec4( e, k, 0.0, 1.0 );
  }
`

const INK_FRAG = /* glsl */ `
  uniform sampler2D uColor;
  uniform sampler2D uEdge;
  uniform sampler2D uId;
  uniform vec2 uTexel;
  uniform int uR;
  uniform float uWidth;
  uniform float uStrength;
  uniform vec3 uInk;
  uniform vec3 uInkTint;
  uniform float uColorMix;
  uniform float uFar;
  uniform float uFadeNear;
  uniform float uFadeFar;
  uniform float uFarWidth;
  uniform float uFarAlpha;
  uniform float uCreaseWidth;
  uniform float uCreaseAlpha;
  uniform float uInkMaxLum;
  varying vec2 vUv;

  vec3 toSRGB( vec3 c ) {
    c = max( c, vec3( 0.0 ) );
    return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
  }

  void main() {
    vec3 base = texture2D( uColor, vUv ).rgb;
    float best = 0.0;
    vec2 bestOff = vec2( 0.0 );
    if ( uStrength > 0.0 ) {
      float reach = uWidth * 0.5 + 0.5;
      for ( int y = -uR; y <= uR; y++ ) {
        for ( int x = -uR; x <= uR; x++ ) {
          vec2 o = vec2( float( x ), float( y ) );
          float dist = length( o );
          if ( dist >= reach ) continue;
          vec2 uv = vUv + o * uTexel;
          vec2 eg = texture2D( uEdge, uv ).rg;
          if ( eg.r < 0.5 && eg.g < 0.5 ) continue;
          // 主线（轮廓 / 深度）满宽满浓；次线（折线）更细更淡
          bool isCrease = eg.r < 0.5;
          // 距离衰减：按边缘像素自己的深度
          float z = texture2D( uId, uv ).g * uFar;
          float f = smoothstep( uFadeNear, uFadeFar, z );
          float w = uWidth * mix( 1.0, uFarWidth, f ) * ( isCrease ? uCreaseWidth : 1.0 );
          float cov = clamp( w * 0.5 + 0.5 - dist, 0.0, 1.0 ) * mix( 1.0, uFarAlpha, f ) * ( isCrease ? uCreaseAlpha : 1.0 );
          if ( cov > best ) { best = cov; bestOff = o; }
        }
      }
    }
    vec3 col = base;
    if ( best > 0.0 ) {
      // 线色：所属物体（边缘像素处）的颜色压暗，再混入墨色
      vec3 src = texture2D( uColor, vUv + bestOff * uTexel ).rgb;
      vec3 ink = mix( uInk, src * uInkTint, uColorMix );
      // 亮度封顶：保留色相，但亮物体（白色教堂、奶油色烟尘）的线不会比别的线浅
      float lum = dot( ink, vec3( 0.2126, 0.7152, 0.0722 ) );
      ink *= min( 1.0, uInkMaxLum / max( lum, 1e-4 ) );
      col = mix( base, ink, best * uStrength );
    }
    gl_FragColor = vec4( toSRGB( col ), 1.0 );
  }
`

/** 原站 generateColorSequenceFromLevel 的等价实现：给每个物体分配互不相同的灰度 identity */
const IDENTITY_LEVELS = [0.5, 0.19, 0.82, 0.34, 0.66, 0.07, 0.93, 0.44, 0.58, 0.26, 0.74, 0.12]
let identityCursor = 3

function nextIdentity(out: THREE.Vector3) {
  const v = IDENTITY_LEVELS[identityCursor % IDENTITY_LEVELS.length]!
  identityCursor++
  out.set(v, v, v)
  return out
}

const _lin = new THREE.Color()
function linear(hex: string) {
  _lin.set(hex)
  return new THREE.Vector3(_lin.r, _lin.g, _lin.b)
}

export class MoebiusOutline {
  private renderer: THREE.WebGLRenderer
  private selectMaterial: THREE.ShaderMaterial
  private edgeMaterial: THREE.ShaderMaterial
  private inkMaterial: THREE.ShaderMaterial
  private fxaaMaterial: THREE.ShaderMaterial
  private idTarget: THREE.WebGLRenderTarget
  private colorTarget: THREE.WebGLRenderTarget
  private edgeTarget: THREE.WebGLRenderTarget
  private ldrTarget: THREE.WebGLRenderTarget
  private quadScene: THREE.Scene
  private quadCamera: THREE.OrthographicCamera
  private quad: THREE.Mesh
  private tmpIdentity = new THREE.Vector3()
  private width = 1
  private height = 1
  /** 线宽：每 1080 像素高多少像素 */
  private lineWidth1080 = INK_DEFAULTS.width
  private identityPass = false
  /**
   * 自带 identity 着色器的物体（粒子、带镂空的动画水流……）：override 材质画不出它们的真实形状，
   * 所以它们各有一个「孪生体」（共享几何、identity 材质）放在这个场景里，identity pass 末尾不清屏追加绘制，
   * 与场景共用深度 → 能被前面的物体挡住，也能挡住后面物体的描边。
   */
  readonly idExtras = new THREE.Scene()
  private bgColor = new THREE.Color()
  /** 是否画描边 */
  enabled = true
  /** 是否做 FXAA */
  fxaa = true

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer

    this.selectMaterial = new THREE.ShaderMaterial({
      uniforms: { uIdentity: { value: new THREE.Vector3() }, uFar: { value: ID_FAR } },
      vertexShader: SELECT_VERT,
      fragmentShader: SELECT_FRAG
    })

    const quadMat = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VERT, fragmentShader: frag, depthTest: false, depthWrite: false })

    this.edgeMaterial = quadMat(EDGE_FRAG, {
      uId: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDepthK: { value: 0.045 },
      uCreaseCos: { value: Math.cos(THREE.MathUtils.degToRad(INK_DEFAULTS.creaseAngle)) },
      uCreaseMaxZ: { value: INK_DEFAULTS.creaseMaxZ },
      uFar: { value: ID_FAR }
    })

    this.inkMaterial = quadMat(INK_FRAG, {
      uColor: { value: null },
      uEdge: { value: null },
      uId: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uR: { value: 1 },
      uWidth: { value: 1 },
      uStrength: { value: 1 },
      // 深梅棕墨色（线性）+ 物体色压暗系数（偏暖偏紫，不发灰）
      uInk: { value: linear('#24161d') },
      uInkTint: { value: new THREE.Vector3(0.24, 0.17, 0.21) },
      uColorMix: { value: INK_DEFAULTS.colorMix },
      uFar: { value: ID_FAR },
      uFadeNear: { value: INK_DEFAULTS.fadeNear },
      uFadeFar: { value: INK_DEFAULTS.fadeFar },
      uFarWidth: { value: INK_DEFAULTS.farWidth },
      uFarAlpha: { value: INK_DEFAULTS.farAlpha },
      uCreaseWidth: { value: INK_DEFAULTS.creaseWidth },
      uCreaseAlpha: { value: INK_DEFAULTS.creaseAlpha },
      // 线色最大亮度（线性）：≈ sRGB 60
      uInkMaxLum: { value: 0.045 }
    })

    // three 的 FXAA（NVIDIA FXAA 3.11 思路）；子像素混合从 1.0 降到 0.6，保住细线和硬色块的锐度
    this.fxaaMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      vertexShader: QUAD_VERT,
      fragmentShader: FXAAShader.fragmentShader.replace('float _SubpixelBlending = 1.0;', 'float _SubpixelBlending = 0.6;'),
      depthTest: false,
      depthWrite: false
    })

    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    this.idTarget = this.makeTarget(size.x, size.y, THREE.HalfFloatType, THREE.NearestFilter)
    this.colorTarget = this.makeTarget(size.x, size.y, THREE.HalfFloatType, THREE.NearestFilter)
    this.edgeTarget = this.makeTarget(size.x, size.y, THREE.UnsignedByteType, THREE.NearestFilter, false)
    this.ldrTarget = this.makeTarget(size.x, size.y, THREE.UnsignedByteType, THREE.LinearFilter, false)
    this.setSize(size.x, size.y)

    this.quadScene = new THREE.Scene()
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.inkMaterial)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
  }

  private makeTarget(w: number, h: number, type: THREE.TextureDataType, filter: THREE.MagnificationTextureFilter, depth = true) {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      minFilter: filter,
      magFilter: filter,
      depthBuffer: depth,
      generateMipmaps: false,
      type,
      colorSpace: THREE.NoColorSpace
    })
  }

  /** 线宽（每 1080 像素高的像素数）。兼容旧接口名 */
  setThickness(v: number) {
    this.lineWidth1080 = Math.max(0.3, v)
    this.updateWidth()
  }

  setInk(opts: Partial<typeof INK_DEFAULTS>) {
    const u = this.inkMaterial.uniforms
    if (opts.width !== undefined) this.setThickness(opts.width)
    if (opts.colorMix !== undefined) u.uColorMix!.value = opts.colorMix
    if (opts.fadeNear !== undefined) u.uFadeNear!.value = opts.fadeNear
    if (opts.fadeFar !== undefined) u.uFadeFar!.value = opts.fadeFar
    if (opts.farWidth !== undefined) u.uFarWidth!.value = opts.farWidth
    if (opts.farAlpha !== undefined) u.uFarAlpha!.value = opts.farAlpha
    if (opts.creaseWidth !== undefined) u.uCreaseWidth!.value = opts.creaseWidth
    if (opts.creaseAlpha !== undefined) u.uCreaseAlpha!.value = opts.creaseAlpha
    const e = this.edgeMaterial.uniforms
    if (opts.creaseAngle !== undefined) e.uCreaseCos!.value = Math.cos(THREE.MathUtils.degToRad(opts.creaseAngle))
    if (opts.creaseMaxZ !== undefined) e.uCreaseMaxZ!.value = opts.creaseMaxZ
  }

  /** 当前分辨率下的实际线宽（像素） */
  get pixelWidth() {
    return (this.lineWidth1080 * this.height) / 1080
  }

  private updateWidth() {
    const w = Math.max(0.75, this.pixelWidth)
    const u = this.inkMaterial.uniforms
    u.uWidth!.value = w
    // 只需要搜索覆盖率 > 0 的邻域：|o| < w/2 + 0.5
    u.uR!.value = Math.min(6, Math.max(0, Math.ceil(w * 0.5 + 0.5) - 1))
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    this.edgeMaterial.uniforms.uTexel!.value.set(1 / w, 1 / h)
    this.inkMaterial.uniforms.uTexel!.value.set(1 / w, 1 / h)
    this.fxaaMaterial.uniforms.resolution!.value.set(1 / w, 1 / h)
    this.width = w
    this.height = h
    this.updateWidth()
    for (const t of [this.idTarget, this.colorTarget, this.edgeTarget, this.ldrTarget]) {
      if (t && (t.width !== w || t.height !== h)) t.setSize(w, h)
    }
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
          const colors = new Float32Array(im.count * 3)
          const v = new THREE.Vector3()
          for (let i = 0; i < im.count; i++) {
            nextIdentity(v)
            colors.set([v.x, v.y, v.z], i * 3)
          }
          geom.setAttribute('aIdentity', new THREE.InstancedBufferAttribute(colors, 3, false))
        }
      }
      const id = nextIdentity(this.tmpIdentity).clone()
      mesh.userData.moebiusIdentity = true
      mesh.onBeforeRender = () => {
        if (this.identityPass) this.setIdentity(id)
      }
    })
  }

  /**
   * 写入当前物体的 identity。
   * three 对「同一个材质连续绘制」不会重新上传 uniform，override 材质在整个 identity pass
   * 里都是同一个，所以必须置 uniformsNeedUpdate（motorbike 的 outlinePass.ts 漏了这步，
   * 导致所有物体同一个 identity，只剩与天空交界处有线）。
   */
  private setIdentity(id: THREE.Vector3) {
    this.selectMaterial.uniforms.uIdentity!.value.copy(id)
    this.selectMaterial.uniformsNeedUpdate = true
  }

  /** 给自定义 identity 的物体分配一个 identity 值 */
  allocIdentity(): number {
    return nextIdentity(this.tmpIdentity).x
  }

  /** 不单独描边的大面（地面 / 水面）：写固定 identity。地面各块之间没有接缝线，水岸有线 */
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

  private drawQuad(material: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.quadScene, this.quadCamera)
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const renderer = this.renderer
    const prevOverride = scene.overrideMaterial

    if (this.enabled) {
      // 1) identity pass：layer 1（天空 / 烟尘）不参与；背景 = identity 1、深度 1
      const prevBg = scene.background
      const prevAlpha = renderer.getClearAlpha()
      renderer.getClearColor(this.bgColor)
      scene.background = null
      renderer.setClearColor(new THREE.Color(1, 1, 0), 1)
      camera.layers.disable(1)
      scene.overrideMaterial = this.selectMaterial
      this.identityPass = true
      renderer.setRenderTarget(this.idTarget)
      renderer.clear()
      renderer.render(scene, camera)
      this.identityPass = false
      scene.overrideMaterial = prevOverride
      if (this.idExtras.children.length) {
        const prevAuto = renderer.autoClear
        renderer.autoClear = false
        renderer.render(this.idExtras, camera)
        renderer.autoClear = prevAuto
      }
      scene.overrideMaterial = prevOverride
      scene.background = prevBg
      renderer.setClearColor(this.bgColor, prevAlpha)
    }

    // 2) 颜色 pass
    renderer.shadowMap.needsUpdate = true
    camera.layers.enable(1)
    renderer.setRenderTarget(this.colorTarget)
    renderer.clear()
    renderer.render(scene, camera)

    // 3) 边缘
    if (this.enabled) {
      this.edgeMaterial.uniforms.uId!.value = this.idTarget.texture
      this.drawQuad(this.edgeMaterial, this.edgeTarget)
    }

    // 4) 墨线合成（关描边时只做 sRGB 编码，保证开关前后颜色 / 抗锯齿一致）
    const u = this.inkMaterial.uniforms
    u.uColor!.value = this.colorTarget.texture
    u.uEdge!.value = this.edgeTarget.texture
    u.uId!.value = this.idTarget.texture
    u.uStrength!.value = this.enabled ? 1 : 0
    this.drawQuad(this.inkMaterial, this.fxaa ? this.ldrTarget : null)

    // 5) FXAA → 画布
    if (this.fxaa) {
      this.fxaaMaterial.uniforms.tDiffuse!.value = this.ldrTarget.texture
      this.drawQuad(this.fxaaMaterial, null)
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
    for (const t of [this.idTarget, this.colorTarget, this.edgeTarget, this.ldrTarget]) t.dispose()
    for (const m of [this.selectMaterial, this.edgeMaterial, this.inkMaterial, this.fxaaMaterial]) m.dispose()
    this.quad.geometry.dispose()
  }
}
