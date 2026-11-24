/**
 * 原站赛璐璐（Toon）渲染移植
 *
 * 全部 GLSL 与参数逐字取自原站 gpNsPhdA.js：
 * - `MeshRampNoiseToonMaterial`（类定义 + extendCallback）
 *   替换 fragment 的 <common> / <lights_toon_pars_fragment> / <opaque_fragment>：
 *   直接光只取梯度贴图的灰度，再用 uDirectColor / uIndirectColor 二色混合，
 *   因此画面是「纯平色块 + 硬阴影」，与原站完全一致。
 * - `MeshBlendRampNoiseToonMaterial`（地面）：R/G/B 三张 albedo 细节按 blendmap 权重混合，
 *   再乘 map_ground（预烘焙沙色）。
 * - 渐变贴图 /assets/textures/3d/texture/three-tone.png（3×1，值 46/158/255，Nearest）
 *
 * 颜色来源见 toon-colors.json（World / bike 的 directColor / indirectColor / luminance），
 * 这些数字是「sRGB 编码值」，原站以 setRGB(..., LinearSRGBColorSpace) 原样喂给 uniform，
 * 这里同样原样写入 Vector4，不做任何色彩空间转换。
 */
import * as THREE from 'three'

export interface ToonPalette {
  /** directColor（受光面），sRGB 数字，原样进 uniform */
  d: number[]
  /** indirectColor（背光面），sRGB 数字，原样进 uniform */
  i: number[]
  /** 亮度倍数 */
  l: number
  /** night 版 directColor（原站每个对象存 day+night 两套） */
  nd?: number[]
  /** night 版 indirectColor */
  ni?: number[]
  /** night 版亮度 */
  nl?: number
}

/** 原站默认色：#dab79c / #605d87（线性）→ 编码成 sRGB 数字 */
export const DEFAULT_PALETTE: ToonPalette = {
  d: [0.854, 0.718, 0.612],
  i: [0.376, 0.365, 0.529],
  l: 1
}

// ---------------------------------------------------------------------------
// 原站 FogBundle：自定义噪波指数雾
//
// 逐字取自 gpNsPhdA.js 的 fog_pars_vertex / fog_vertex / fog_pars_fragment /
// fog_fragment。要点：
//  - `applyFog(shader)` 手动写死 defines.USE_FOG / FOG_EXP2，因此即使材质本身
//    fog:false 也会被强制开启（原站 Toon 材质就是 fog:false）；
//  - 雾密度 = `Fog / intensity * 0.02`（setFogIntensity），雾色固定 #550000；
//  - 用 3D simplex 噪声（cnoise）扰动雾深度，`fogTime` 每帧 += delta*0.01
//    让雾缓慢流动 —— 森林/宫殿段的那层红棕色流动空气感就来自这里。
// ---------------------------------------------------------------------------
const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float fogDepth;
  varying vec3 vFogWorldPosition;
#endif
`
const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  fogDepth = - mvPosition.z;
  vFogWorldPosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;
#endif
`
const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  vec3 windDir = vec3(0.0, 0.0, fogTime);
  vec3 scrollingPos = vFogWorldPosition.xyz + fogNoiseSpeed * windDir;
  float noise = cnoise(fogNoiseFreq * scrollingPos.xyz);
  float vFogDepth = (1.0 - fogNoiseImpact * noise) * fogDepth;
  #ifdef FOG_EXP2
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif

  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix(fogNearColor, fogColor, fogFactor), fogFactor );
#endif
`
const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  vec3 fade(vec3 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}

  float cnoise(vec3 P){
    vec3 Pi0 = floor(P);
    vec3 Pi1 = Pi0 + vec3(1.0);
    Pi0 = mod(Pi0, 289.0);
    Pi1 = mod(Pi1, 289.0);
    vec3 Pf0 = fract(P);
    vec3 Pf1 = Pf0 - vec3(1.0);
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 iz0 = Pi0.zzzz;
    vec4 iz1 = Pi1.zzzz;

    vec4 ixy = permute(permute(ix) + iy);
    vec4 ixy0 = permute(ixy + iz0);
    vec4 ixy1 = permute(ixy + iz1);

    vec4 gx0 = ixy0 / 7.0;
    vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
    gx0 = fract(gx0);
    vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
    vec4 sz0 = step(gz0, vec4(0.0));
    gx0 -= sz0 * (step(0.0, gx0) - 0.5);
    gy0 -= sz0 * (step(0.0, gy0) - 0.5);

    vec4 gx1 = ixy1 / 7.0;
    vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
    gx1 = fract(gx1);
    vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
    vec4 sz1 = step(gz1, vec4(0.0));
    gx1 -= sz1 * (step(0.0, gx1) - 0.5);
    gy1 -= sz1 * (step(0.0, gy1) - 0.5);

    vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
    vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
    vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
    vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
    vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
    vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
    vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
    vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

    vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
    g000 *= norm0.x;
    g010 *= norm0.y;
    g100 *= norm0.z;
    g110 *= norm0.w;
    vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
    g001 *= norm1.x;
    g011 *= norm1.y;
    g101 *= norm1.z;
    g111 *= norm1.w;

    float n000 = dot(g000, Pf0);
    float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
    float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
    float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
    float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
    float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
    float n111 = dot(g111, Pf1);

    vec3 fade_xyz = fade(Pf0);
    vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
    vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
    float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
    return 2.2 * n_xyz;
  }

  uniform vec3 fogColor;
  uniform vec3 fogNearColor;
  varying float fogDepth;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  varying vec3 vFogWorldPosition;
  uniform float fogTime;
  uniform float fogNoiseSpeed;
  uniform float fogNoiseFreq;
  uniform float fogNoiseImpact;
#endif
`

/** 已编译的 program（原站 programsParameters），用于批量改 fogDensity / fogTime */
const fogPrograms: any[] = []

export function getFogUniforms() {
  return {
    fogDensity: { value: 0 },
    fogTime: { value: 0 },
    fogNearColor: { value: new THREE.Color('#550000') },
    fogColor: { value: new THREE.Color('#550000') },
    fogNoiseFreq: { value: 0.096 },
    fogNoiseSpeed: { value: 300 },
    fogNoiseImpact: { value: 1 },
    fogNear: { value: 0 },
    fogFar: { value: 120 }
  }
}

/** 原站 setFogIntensity(S)：写 fogDensity（由 Fog/intensity * 0.02 得来） */
export function setFogIntensity(v: number) {
  for (const p of fogPrograms) p.uniforms.fogDensity.value = v
}

/** 原站 FogBundle.render：fogTime += delta * 0.01 */
export function tickFog(dt: number) {
  for (const p of fogPrograms) p.uniforms.fogTime.value += dt * 0.01
}

/** 原站 applyFog(shader)：强制开启 USE_FOG + FOG_EXP2 并替换四个 chunk */
export function applyFog(shader: any) {
  shader.defines = shader.defines ?? {}
  shader.defines.USE_FOG = ''
  shader.defines.FOG_EXP2 = ''
  const uniforms = getFogUniforms()
  for (const k of Object.keys(uniforms)) {
    shader.uniforms[k] = (uniforms as any)[k]
  }
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', FOG_PARS_VERTEX)
    .replace('#include <fog_vertex>', FOG_VERTEX)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', FOG_PARS_FRAGMENT)
    .replace('#include <fog_fragment>', FOG_FRAGMENT)
  if (!fogPrograms.includes(shader)) fogPrograms.push(shader)
}

export function disposeFogPrograms() {
  fogPrograms.length = 0
}


/** 原站 MeshRampNoiseToonMaterial.extendCallback 的 fragment 头部 */
const TOON_COMMON = /* glsl */ `
        uniform float uRandomScale;
        uniform float uRandomIntensity;
        uniform float uMinGradient;
        uniform float uMaxGradient;
        uniform vec4 uDirectColor;
        uniform vec4 uIndirectColor;
        uniform float uLuminance;

        float random (vec2 st) {
          return fract(sin(dot(st.xy,
              vec2(12.9898,78.233)))*
            43758.5453123);
        }
        float mapFunc(float value, float min1, float max1, float min2, float max2) {
          return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
        }
        #include <common>
      `

/** 原站 lights_toon_pars_fragment 整段替换（直射/间接都不走物理 BRDF，只输出灰度） */
const TOON_LIGHTS_PARS = /* glsl */ `varying vec3 vViewPosition;

struct ToonMaterial {
  vec3 diffuseColor;
};

void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
  // directColor is white
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( vec3(1.0) ); 
}

void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  // indirectColor is black
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( vec3(0.0) );
}

#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`

/** 原站 opaque_fragment 替换：二色混合写入 outgoingLight */
const TOON_OPAQUE = /* glsl */ `// Get only grey value from RE_Direct_Toon and RE_IndirectDiffuse_Toon
float toonIrradiance = reflectedLight.directDiffuse.r * uLuminance;

vec3 lightColor = uDirectColor.rgb * toonIrradiance + (1.0 - toonIrradiance) * uIndirectColor.rgb;
outgoingLight = diffuseColor.rgb * lightColor;

#include <opaque_fragment>`

export interface ToonMaterialOptions {
  palette: ToonPalette
  gradientMap: THREE.Texture
  map?: THREE.Texture | null
  side?: THREE.Side
  transparent?: boolean
  opacity?: number
  alphaTest?: number
  depthWrite?: boolean
  vertexColors?: boolean
}

/**
 * 等价原站 generateMeshRampNoiseToonMaterial() 产出的材质。
 * 程序缓存键固定，同参数材质共享 program（原站用自增 key 强制每个材质单独编译，
 * 视觉相同但编译更慢，这里改为共享）。
 */
export function createToonMaterial(opts: ToonMaterialOptions): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    map: opts.map ?? null,
    gradientMap: opts.gradientMap,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    alphaTest: opts.alphaTest ?? 0,
    depthWrite: opts.depthWrite ?? true,
    vertexColors: opts.vertexColors ?? false
  })
  // 原站：需要 vUv（random/mapFunc 用到），显式打开 USE_UV
  mat.defines = { ...(mat.defines ?? {}), USE_UV: '' }

  const palette = opts.palette
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRandomScale = { value: 50000 }
    shader.uniforms.uRandomIntensity = { value: 0.5 }
    shader.uniforms.uMinGradient = { value: 0.4 }
    shader.uniforms.uMaxGradient = { value: 0.8 }
    shader.uniforms.uTime = { value: 0 }
    shader.uniforms.uDirectColor = { value: new THREE.Vector4(palette.d[0], palette.d[1], palette.d[2], 1) }
    shader.uniforms.uIndirectColor = { value: new THREE.Vector4(palette.i[0], palette.i[1], palette.i[2], 1) }
    shader.uniforms.uLuminance = { value: palette.l }
    mat.userData.parameters = shader

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', TOON_COMMON)
      .replace('#include <lights_toon_pars_fragment>', TOON_LIGHTS_PARS)
      .replace('#include <opaque_fragment>', TOON_OPAQUE)

    // 原站 applyFog：强制 USE_FOG（材质本身 fog:false 也会开）
    applyFog(shader)
  }
  mat.customProgramCacheKey = () => 'mola-ramp-toon'
  mat.userData.palette = palette
  return mat
}

/**
 * 原站 day-night 混合（generateMeshRampNoiseToonMaterial 的 update 回调）：
 *   color = day + (night - day) · mix
 *   luminance = day.l · (1 - mix) + night.l · mix
 * mix 来自 Orbital Sequence 的 `Day - Night` 轨道（t 2.67→2.9 入夜，6.63→6.67 回白天）。
 */
export function setToonPaletteMix(mat: THREE.Material, palette: ToonPalette, mix: number) {
  const uniforms = (mat.userData as any)?.parameters?.uniforms
  if (!uniforms?.uDirectColor) return
  const nd = palette.nd ?? palette.d
  const ni = palette.ni ?? palette.i
  const nl = palette.nl ?? palette.l
  const d = uniforms.uDirectColor.value as THREE.Vector4
  const i = uniforms.uIndirectColor.value as THREE.Vector4
  d.set(
    palette.d[0]! + (nd[0]! - palette.d[0]!) * mix,
    palette.d[1]! + (nd[1]! - palette.d[1]!) * mix,
    palette.d[2]! + (nd[2]! - palette.d[2]!) * mix,
    1
  )
  i.set(
    palette.i[0]! + (ni[0]! - palette.i[0]!) * mix,
    palette.i[1]! + (ni[1]! - palette.i[1]!) * mix,
    palette.i[2]! + (ni[2]! - palette.i[2]!) * mix,
    1
  )
  uniforms.uLuminance.value = palette.l * (1 - mix) + nl * mix
}

/** 原站 MeshBlendRampNoiseToonMaterial 的 fragment 头部 */
const GROUND_COMMON = /* glsl */ `
uniform float uRandomScale;
uniform float uRandomIntensity;
uniform float uMinGradient;
uniform float uMaxGradient;
uniform vec4 uDirectColor;
uniform vec4 uIndirectColor;
uniform float uLuminance;
uniform sampler2D uDefaultAlbedo;
uniform sampler2D uRAlbedo;
uniform sampler2D uGAlbedo;
uniform sampler2D uBAlbedo;
uniform sampler2D uBlendMap;
uniform vec4 uBlendScale;

float random (vec2 st) {
  return fract(sin(dot(st.xy,
      vec2(12.9898,78.233)))*
    43758.5453123);
}
float mapFunc(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

vec4 blendVector(vec4 base, vec4 r, vec4 g, vec4 b,  vec4 blend) {
  vec3 color = (
    r.xyz * blend.r 
    + g.xyz * blend.g 
    + b.xyz * blend.b
  );

  float intensity = min(1.0, blend.r + blend.g + blend.b);
  vec4 baseColor = base * max(0.0, 1.0 - intensity);

  return vec4(color, 1.0) * (1.0/intensity) + baseColor;
}

vec4 blendVectorLinear(vec4 r, vec4 g, vec4 b,  vec4 blend) {
  vec4 color = (
    r * blend.r 
    + g * blend.g 
    + b * blend.b
  ) / (blend.r + blend.g + blend.b);
  
  return color;
}
 
#include <common>`

/** 原站地面 map_fragment 替换（vUv + uBlendScale 平铺） */
const GROUND_MAP_FRAGMENT = /* glsl */ `vec4 blend = texture2D(uBlendMap, vUv);

vec4 r_albedo = texture2D(uRAlbedo, vUv * uBlendScale.r);
vec4 g_albedo = texture2D(uGAlbedo, vUv * uBlendScale.g);
vec4 b_albedo = texture2D(uBAlbedo, vUv * uBlendScale.b);
vec4 default_albedo = texture2D(uDefaultAlbedo, vUv * uBlendScale.a);

vec4 sampledDiffuseColorBlend = blendVector(default_albedo, r_albedo, g_albedo, b_albedo, blend);

diffuseColor *= sampledDiffuseColorBlend;

#ifdef USE_MAP 
  vec4 sampledDiffuseColorMap = texture2D( map, vMapUv );
  diffuseColor *= sampledDiffuseColorMap;
#endif

diffuseColor.rgb *= uLuminance;
`

export interface GroundToonOptions {
  map: THREE.Texture
  rock: THREE.Texture
  sand: THREE.Texture
  marble: THREE.Texture
  blendMap: THREE.Texture
  gradientMap: THREE.Texture
  /** 原站 new Vector4(50,50,50,50) */
  blendScale?: number
  luminance?: number
}

/**
 * 等价原站 MeshBlendRampNoiseToonMaterial。
 * 注意：原站没有给它套 directColor/indirectColor 的二色混合（只替换 common + map_fragment），
 * 所以地面走 three 原生 Toon 光照（梯度贴图 × 平行光强度 3）。
 */
export function createGroundToonMaterial(opts: GroundToonOptions): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    map: opts.map,
    gradientMap: opts.gradientMap,
    color: new THREE.Color(1, 1, 1)
  })
  mat.defines = { ...(mat.defines ?? {}), USE_UV: '' }

  mat.onBeforeCompile = (shader) => {
    const scale = opts.blendScale ?? 50
    shader.uniforms.uRandomScale = { value: 50000 }
    shader.uniforms.uRandomIntensity = { value: 0.5 }
    shader.uniforms.uMinGradient = { value: 0.4 }
    shader.uniforms.uMaxGradient = { value: 0.8 }
    shader.uniforms.uDirectColor = { value: new THREE.Vector4(1, 1, 1, 1) }
    shader.uniforms.uIndirectColor = { value: new THREE.Vector4(0, 0, 0, 1) }
    shader.uniforms.uLuminance = { value: opts.luminance ?? 1 }
    // 原站 uDefaultAlbedo 传入的是空 Texture（采样恒为黑），这里用 1×1 黑色纹理对齐
    shader.uniforms.uDefaultAlbedo = { value: blackTexture() }
    shader.uniforms.uRAlbedo = { value: opts.rock }
    shader.uniforms.uGAlbedo = { value: opts.sand }
    shader.uniforms.uBAlbedo = { value: opts.marble }
    shader.uniforms.uBlendMap = { value: opts.blendMap }
    shader.uniforms.uBlendScale = { value: new THREE.Vector4(scale, scale, scale, scale) }
    mat.userData.parameters = shader

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', GROUND_COMMON)
      .replace('#include <map_fragment>', GROUND_MAP_FRAGMENT)
    applyFog(shader)
  }
  mat.customProgramCacheKey = () => 'mola-ground-toon'
  return mat
}

let _black: THREE.DataTexture | null = null
function blackTexture(): THREE.DataTexture {
  if (!_black) {
    _black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    _black.needsUpdate = true
  }
  return _black
}

/**
 * 渐变贴图：three-tone.png（3×1，sRGB 值 46/158/255）。
 * 原站只设 magFilter = NearestFilter，不设 colorSpace（采样原始值）。
 */
export function createGradientMap(texture?: THREE.Texture): THREE.Texture {
  // 直接用 three-tone.png 的实测像素值构造 3×1 DataTexture：
  // 46 / 158 / 255（Nearest、无 mipmap、NoColorSpace），避免图片解码/翻转带来的偏差
  const data = new Uint8Array([46, 46, 46, 255, 158, 158, 158, 255, 255, 255, 255, 255])
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  if (texture) texture.dispose()
  return tex
}
