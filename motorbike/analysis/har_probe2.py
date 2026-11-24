# -*- coding: utf-8 -*-
"""针对性深挖：重点文件结构、压缩头、内联 data URI、GLB 头。"""
import sys, json, base64, collections, re

sys.stdout.reconfigure(encoding="utf-8")
HAR = r"E:/文档/摩托车抓包/download"
with open(HAR, "r", encoding="utf-8") as f:
    entries = json.load(f)["log"]["entries"]

def body(e):
    c = e["response"]["content"]
    t = c.get("text")
    if t is None:
        return None
    if c.get("encoding") == "base64":
        try:
            return base64.b64decode(t)
        except Exception as ex:
            return ("ERR", str(ex))
    return t.encode("utf-8")

def find(sub):
    return [e for e in entries if sub in e["request"]["url"]]

print("=== 响应头 content-encoding 分布 ===")
ce = collections.Counter()
for e in entries:
    hs = {h["name"].lower(): h["value"] for h in e["response"]["headers"]}
    ce[hs.get("content-encoding", "(none)")] += 1
print(dict(ce))
print()

print("=== content.compression 非空条目 ===")
for e in entries:
    c = e["response"]["content"]
    if c.get("compression"):
        print("  ", c.get("compression"), e["request"]["url"][:120])
print()

print("=== 内联 data:...;base64 扫描（正文内容中） ===")
pat = re.compile(r"data:([^;,\"')\s]*);base64,")
total = 0
for i, e in enumerate(entries):
    c = e["response"]["content"]
    t = c.get("text")
    if not t or c.get("encoding") == "base64":
        continue
    m = pat.findall(t)
    if m:
        kinds = collections.Counter(m)
        total += len(m)
        print(f"  [{i:3d}] {len(m):4d} 处 {dict(kinds)}  {e['request']['url'][:100]}")
print("  内联 data URI 总数:", total)
print()

print("=== 重点 JSON 结构 ===")
for name in ["state_v9.json", "logo_anim_v3.json"]:
    hits = find(name)
    e = hits[0]
    b = body(e)
    print(f"--- {name} : {len(hits)} 次请求, 解码字节 {len(b) if isinstance(b,bytes) else b}")
    print("    前 400 字节:", repr(b[:400]))
    try:
        obj = json.loads(b.decode("utf-8"))
        if isinstance(obj, dict):
            print("    顶层键:", list(obj.keys())[:40])
            for k, v in list(obj.items())[:12]:
                t = type(v).__name__
                n = len(v) if isinstance(v, (list, dict, str)) else ""
                print(f"      {k:28s} {t:8s} {n}")
        elif isinstance(obj, list):
            print("    顶层是数组, 长度", len(obj), "首元素类型", type(obj[0]).__name__ if obj else "-")
    except Exception as ex:
        print("    JSON 解析失败:", ex)
    print("    所有请求索引:", [entries.index(x) for x in hits])
print()

print("=== GLB 头 / chunk 结构 ===")
for name in ["scene_v6.16.4.glb", "bike_v9.7.glb", "oiseau_v1.glb"]:
    hits = find(name)
    e = hits[0]
    b = body(e)
    print(f"--- {name}: HAR content.size={e['response']['content'].get('size')} 解码字节={len(b)}")
    print("    head16:", b[:16].hex(), "magic:", repr(b[:4]))
    if b[:4] == b"glTF":
        import struct
        ver, total_len = struct.unpack("<II", b[4:12])
        print(f"    version={ver} declared_length={total_len} actual={len(b)} match={total_len==len(b)}")
        off = 12
        idx = 0
        while off + 8 <= len(b) and idx < 10:
            clen, ctype = struct.unpack("<I4s", b[off:off+8])
            print(f"    chunk[{idx}] type={ctype!r} len={clen}")
            if ctype == b"JSON":
                try:
                    j = json.loads(b[off+8:off+8+clen].decode("utf-8").rstrip("\0 "))
                    print("       extensionsUsed  :", j.get("extensionsUsed"))
                    print("       extensionsRequired:", j.get("extensionsRequired"))
                    print("       generator       :", j.get("asset", {}).get("generator"))
                    for key in ["scenes","nodes","meshes","materials","animations","images","textures","samplers","buffers","bufferViews","accessors","skins","cameras"]:
                        if key in j:
                            print(f"       {key:14s}: {len(j[key])}")
                    ext_uris = [x.get("uri") for x in j.get("images", []) if x.get("uri")]
                    buf_uris = [x.get("uri") for x in j.get("buffers", []) if x.get("uri")]
                    print("       外部 image uri  :", ext_uris[:10], "共", len(ext_uris))
                    print("       外部 buffer uri :", buf_uris[:10], "共", len(buf_uris))
                except Exception as ex:
                    print("       JSON chunk 解析失败:", ex)
            off += 8 + clen
            idx += 1
    print()
