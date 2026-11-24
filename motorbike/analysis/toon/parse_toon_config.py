#!/usr/bin/env python3
"""
从原站 gpNsPhdA.js 提取 Toon 配色配置，并与 state_v9.json 的 Theatre 覆盖值合并，
生成运行时使用的 toon-colors.json。

原站逻辑（gpNsPhdA.js generateMeshRampNoiseToonMaterial）：
  1) 默认值来自 WORLD_MOEBIUS_CONFIG / getBikeMoebiusConfig()，颜色为 three.Color
  2) 注册到 Theatre 时执行 convertLinearToSRGB()，即把线性值编码成 sRGB 数字后存进工程
  3) onValuesChange 读回时用 setRGB(r,g,b, LinearSRGBColorSpace) → 数字原样使用
  因此运行时 uniform 收到的是「sRGB 编码后的数字」，本脚本输出的就是这些数字。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JS = ROOT / 'extracted/js/_nuxt/gpNsPhdA.js'
STATE = ROOT / 'extracted/scenes/3d/state_v9.json'
OUT = ROOT / 'app/utils/mola3d/toon-colors.json'

DEFAULT_DAY = ((0.854, 0.718, 0.612), (0.376, 0.365, 0.529))  # #dab79c / #605d87


def linear_to_srgb(c: float) -> float:
    if c <= 0.0031308:
        return c * 12.92
    return 1.055 * (c ** (1 / 2.4)) - 0.055


def parse_color(text: str):
    """解析 new Color$1(...) / new Color$1().setRGB(...) 为 [r,g,b] 线性浮点。"""
    m = re.search(r'new Color\$1\(([^)]*)\)((?:\.setRGB\([^)]*\))?)', text)
    if not m:
        return None
    args, chain = m.group(1).strip(), m.group(2)
    if chain:
        nums = [float(x) for x in re.search(r'setRGB\(([^)]*)\)', chain).group(1).split(',')]
        return nums[:3]
    if not args:
        return [1.0, 1.0, 1.0]
    parts = [p.strip() for p in args.split(',')]
    if len(parts) == 1:
        p = parts[0]
        if p.startswith('"') or p.startswith("'"):
            h = p.strip('"\'#')
            n = int(h, 16)
            srgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
            # Color(hex) 按 sRGB 解码 → 线性
            return [((c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in srgb]
        n = int(float(p))
        srgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
        return [((c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in srgb]
    return [float(x) for x in parts[:3]]


def split_entries(body: str):
    """把 `{k:{...},k2:{...}}` 拆成 [(key, body)]，只处理一层。"""
    out, i, n = [], 0, len(body)
    while i < n:
        while i < n and body[i] in ' ,\n\t':
            i += 1
        m = re.compile(r'([\w.\-$]+)\s*:').match(body, i)
        if not m:
            break
        key = m.group(1)
        i = m.end()
        if body[i] != '{':
            # 标量值：跳到当前层级（括号外）的下一个逗号
            j, paren = i, 0
            while j < n:
                ch = body[j]
                if ch == '(':
                    paren += 1
                elif ch == ')':
                    paren -= 1
                elif ch == ',' and paren == 0:
                    break
                j += 1
            out.append((key, body[i:j].strip()))
            i = j + 1
            continue
        depth, start = 0, i
        while i < n:
            if body[i] == '{':
                depth += 1
            elif body[i] == '}':
                depth -= 1
                if depth == 0:
                    i += 1
                    break
            i += 1
        out.append((key, body[start:i]))
    return out


def parse_config(body: str):
    cfg = {}
    for name, block in split_entries(body.strip()[1:-1]):
        entry = {}
        for k, v in split_entries(block[1:-1]):
            if k in ('day', 'night'):
                inner = {}
                for kk, vv in split_entries(v[1:-1]):
                    if 'Color' in vv:
                        inner[kk] = parse_color(vv)
                    else:
                        try:
                            inner[kk] = float(vv)
                        except ValueError:
                            pass
                entry[k] = inner
            elif 'Color' in v:
                entry[k] = parse_color(v)
            else:
                try:
                    entry[k] = float(v)
                except ValueError:
                    pass
        cfg[name] = entry
    return cfg


def extract(path: Path, marker: str, skip: int = 0):
    s = path.read_text(encoding='utf-8', errors='replace')
    i = s.index(marker) + skip
    j = s.index('{', i)
    depth = 0
    for k in range(j, len(s)):
        if s[k] == '{':
            depth += 1
        elif s[k] == '}':
            depth -= 1
            if depth == 0:
                return s[j:k + 1]
    raise ValueError('unbalanced')


def resolve(cfg, overrides, prefix='objects / '):
    """合并：Theatre 静态覆盖优先，缺项回落到代码默认值（线性→sRGB）。

    同时产出 day / night 两套（原站 generateMeshRampNoiseToonMaterial 为每个
    对象保存 day+night，运行时按 SCENE_CONFIG.dayNightMix 线性插值）。
    输出扁平字段：d/i/l = day，nd/ni/nl = night。
    """
    out = {}
    for name, entry in cfg.items():
        rec = {}
        for mode, dflt, suffix in (
            ('day', DEFAULT_DAY, ('d', 'i', 'l')),
            ('night', DEFAULT_DAY, ('nd', 'ni', 'nl')),
        ):
            m = entry.get(mode, {})
            d = m.get('directColor') or list(dflt[0])
            i = m.get('indirectColor') or list(dflt[1])
            rec[suffix[0]] = [round(linear_to_srgb(c), 5) for c in d]
            rec[suffix[1]] = [round(linear_to_srgb(c), 5) for c in i]
            rec[suffix[2]] = m.get('luminance', 1) or 1
        out[name] = rec
    for key, val in overrides.items():
        if not key.startswith(prefix):
            continue
        for mode, suffix in ((' / day', ('d', 'i', 'l')), (' / night', ('nd', 'ni', 'nl'))):
            if not key.endswith(mode):
                continue
            name = key[len(prefix):-len(mode)]
            d = val.get('directColor')
            if not d:
                continue
            rec = out.setdefault(name, {
                'd': [0, 0, 0], 'i': [0, 0, 0], 'l': 1,
                'nd': [0, 0, 0], 'ni': [0, 0, 0], 'nl': 1
            })
            rec[suffix[0]] = [round(d['r'], 5), round(d['g'], 5), round(d['b'], 5)]
            ic = val.get('indirectColor')
            if ic:
                rec[suffix[1]] = [round(ic['r'], 5), round(ic['g'], 5), round(ic['b'], 5)]
            if val.get('luminance') is not None:
                rec[suffix[2]] = val['luminance']
    return out


def main():
    world = parse_config(extract(JS, 'WORLD_MOEBIUS_CONFIG='))
    bike = parse_config(extract(JS, 'getBikeMoebiusConfig(){return', len('getBikeMoebiusConfig(){return')))
    state = json.loads(STATE.read_text(encoding='utf-8'))
    world_ov = state['sheetsById']['World']['staticOverrides']['byObject']
    bike_ov = state['sheetsById']['bike']['staticOverrides']['byObject']

    world_colors = resolve(world, world_ov)
    bike_colors = resolve(bike, bike_ov)

    # 覆盖表里存在、但代码配置没有的对象（原站会用全局默认色 #dab79c / #605d87）
    for key, val in world_ov.items():
        if not key.startswith('objects / ') or not key.endswith(' / day'):
            continue
        name = key[len('objects / '):-len(' / day')]
        default = [round(linear_to_srgb(c), 5) for c in DEFAULT_DAY[0]]
        default_i = [round(linear_to_srgb(c), 5) for c in DEFAULT_DAY[1]]
        world_colors.setdefault(name, {
            'd': default, 'i': default_i, 'l': 1,
            'nd': default, 'ni': default_i, 'nl': 1
        })

    data = {
        '_source': 'gpNsPhdA.js WORLD_MOEBIUS_CONFIG / getBikeMoebiusConfig + state_v9.json Theatre staticOverrides (day)',
        '_note': '颜色为 sRGB 编码数字，直接作为 uniform 原始值（与原站 setRGB(..., LinearSRGBColorSpace) 一致）',
        'world': dict(sorted(world_colors.items())),
        'bike': dict(sorted(bike_colors.items())),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'world {len(data["world"])} / bike {len(data["bike"])} -> {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
