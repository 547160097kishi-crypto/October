# -*- coding: utf-8 -*-
"""
HAR 资源分析与提取（第一阶段主脚本）
- 解析完整 HAR，统计每条请求
- 分类 / 去重 / base64 解码 / 落盘（保留原始文件名与 URL 目录层级）
- 逐文件完整性校验（魔数、长度、JSON 可解析、编码）
- 对重点 3D 资源做深度结构分析
输出: analysis/requests.csv, analysis/har_report.json, extracted/** 与映射表
"""
import sys, os, json, base64, struct, hashlib, collections, re, csv
from pathlib import Path
from urllib.parse import urlparse, unquote

sys.stdout.reconfigure(encoding="utf-8")

HAR = Path(r"E:/文档/摩托车抓包/download")
ROOT = Path(r"E:/workbuddy/fastbike")
OUT = ROOT / "extracted"
ANA = ROOT / "analysis"
ANA.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

with HAR.open("r", encoding="utf-8") as f:
    log = json.load(f)["log"]
entries = log["entries"]

# ---------------- 基础工具 ----------------
EXT_BY_MIME = {
    "text/html": ".html", "text/css": ".css",
    "application/javascript": ".js", "text/javascript": ".js",
    "application/json": ".json", "application/speculationrules+json": ".json",
    "text/plain": ".txt", "application/wasm": ".wasm",
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
    "image/svg+xml": ".svg", "image/vnd.microsoft.icon": ".ico",
    "font/woff2": ".woff2", "audio/mpeg": ".mp3",
}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".gif", ".avif", ".ktx2", ".basis"}
AUDIO_EXT = {".mp3", ".ogg", ".wav", ".m4a", ".flac"}
FONT_EXT = {".woff2", ".woff", ".ttf", ".otf", ".eot"}
MODEL_EXT = {".glb", ".gltf"}

THIRD_HOSTS_OK = {"www.gstatic.com", "unpkg.com"}  # 3D 运行依赖，单独归类


def hdr(e):
    return {h["name"].lower(): h["value"] for h in e["response"]["headers"]}


def decode_body(e):
    """返回 (bytes|None, 说明)"""
    c = e["response"]["content"]
    t = c.get("text")
    if t is None or t == "":
        return None, "no-content"
    if c.get("encoding") == "base64":
        try:
            return base64.b64decode(t, validate=False), "base64-decoded"
        except Exception as ex:
            return None, "base64-error:" + str(ex)
    return t.encode("utf-8"), "utf8-text"


def path_segments(e):
    p = urlparse(e["request"]["url"])
    host, path = p.netloc, p.path
    seg = [unquote(s) for s in path.split("/") if s]
    mime = e["response"]["content"].get("mimeType", "")
    ext = EXT_BY_MIME.get(mime, "")
    if not seg or path.endswith("/"):
        seg.append("index" + (ext or ".bin"))
    elif "." not in seg[-1]:
        seg[-1] = seg[-1] + (ext or ".bin")
    # Windows 非法字符清理
    seg = [re.sub(r'[<>:"|?*\x00-\x1f]', "_", s) for s in seg]
    return host, path, seg


def filename_of(e):
    _, _, seg = path_segments(e)
    return seg[-1]


def ext_of(e):
    return ("." + filename_of(e).rsplit(".", 1)[-1].lower()) if "." in filename_of(e) else ""


def classify(e):
    url = e["request"]["url"]
    host, path, seg = path_segments(e)
    name = seg[-1].lower()
    ext = ("." + name.rsplit(".", 1)[-1]) if "." in name else ""
    mime = e["response"]["content"].get("mimeType", "")
    rt = e.get("_resourceType", "")

    # --- 3D 重点 ---
    if ext in MODEL_EXT:
        return "models"
    if re.match(r"state_v\d+\.json$", name):
        return "scenes"
    if "logo_anim" in name or ("anim" in name and ext == ".json"):
        return "animations"
    if "draco_" in url or "basis_transcoder" in url or ext == ".wasm":
        return "decoders"

    # --- 第三方 ---
    if host != "mola-zone.com" and host not in THIRD_HOSTS_OK:
        return "third-party"

    # --- 站点资源 ---
    if ext in FONT_EXT or mime.startswith("font/"):
        return "fonts"
    if ext in AUDIO_EXT or mime.startswith("audio/"):
        return "audio"
    if "/3d/library/" in path.lower() or "/3d/texture/" in path.lower():
        return "textures"
    if ext in IMAGE_EXT or mime.startswith("image/"):
        return "images"
    if mime == "text/html" or ext in (".html", ".htm"):
        return "html"
    if mime == "text/css" or ext == ".css":
        return "css"
    if "javascript" in mime or ext in (".js", ".mjs"):
        return "js"
    if mime == "application/octet-stream" and rt == "wasm":
        return "decoders"
    return "data"


def out_relpath(e, category):
    host, path, seg = path_segments(e)
    parts = [] if host == "mola-zone.com" else [host]
    return str(Path(category, *parts, *seg)).replace("\\", "/")


# ---------------- 完整性与格式校验 ----------------
def check_bytes(data, ext, mime, category):
    issues, fmt = [], ""
    n = len(data)
    if data[:4] == b"glTF":
        fmt = "GLB(glTF 2.0 binary)"
        if len(data) < 20:
            issues.append("GLB 文件过短")
        else:
            ver, declared = struct.unpack("<II", data[4:12])
            if ver != 2:
                issues.append(f"非常规 glTF version={ver}")
            if declared != n:
                issues.append(f"GLB 头声明长度 {declared} != 实际 {n}（截断/损坏）")
            # chunk 完整性
            off, seen = 12, []
            while off + 8 <= n:
                clen, ctype = struct.unpack("<I4s", data[off:off + 8])
                if off + 8 + clen > n:
                    issues.append(f"chunk {ctype!r} 声明 {clen} 字节但越界")
                    break
                seen.append(ctype.decode("latin1").rstrip("\0"))
                off += 8 + clen
            if off != n:
                issues.append(f"chunk 结束偏移 {off} != 文件长度 {n}")
            if "JSON" not in seen:
                issues.append("缺少 JSON chunk")
            if not any(s.startswith("BIN") for s in seen):
                issues.append("缺少 BIN chunk")
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        fmt = "PNG"
        if not data.rstrip(b"\0").endswith(b"IEND\xaeB`\x82"):
            issues.append("PNG 缺少 IEND 结束块（可能截断）")
    elif data[:3] == b"\xff\xd8\xff":
        fmt = "JPEG"
        if not data.rstrip().endswith(b"\xff\xd9"):
            issues.append("JPEG 缺少 EOI 结束标记（可能截断）")
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        fmt = "WebP"
        riff_size = struct.unpack("<I", data[4:8])[0]
        if riff_size + 8 != n:
            issues.append(f"WebP RIFF 声明 {riff_size + 8} != 实际 {n}")
    elif data[:4] == b"wOF2":
        fmt = "WOFF2"
    elif data[:4] == b"wOFF" or data[:4] == b"\x00\x01\x00\x00" or data[:4] == b"OTTO":
        fmt = "WOFF/TTF/OTF"
    elif data[:4] == b"\x00\x00\x01\x00":
        fmt = "ICO"
    elif data[:4] == b"\x00asm":
        fmt = "WebAssembly"
        if struct.unpack("<I", data[4:8])[0] != 1:
            issues.append("WASM 版本非 1")
    elif data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        fmt = "MP3"
    elif ext == ".svg" or (data[:200].lstrip().startswith(b"<svg") or data[:200].lstrip().startswith(b"<?xml")):
        fmt = "SVG/XML"
        if b"<svg" not in data[:2000]:
            issues.append("SVG 中未找到 <svg> 根元素")
    elif ext == ".json" or "json" in mime:
        fmt = "JSON"
        try:
            json.loads(data.decode("utf-8"))
        except Exception as ex:
            issues.append("JSON 解析失败: " + str(ex)[:80])
    elif category in ("html", "css", "js"):
        fmt = {"html": "HTML", "css": "CSS", "js": "JavaScript"}[category]
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            issues.append("UTF-8 解码失败（可能非文本/编码不符）")
    else:
        fmt = mime or ext or "unknown"
    if n == 0:
        issues.append("空文件（0 字节）")
    return {"format": fmt, "bytes": n, "valid": not issues, "issues": issues,
            "sha256": hashlib.sha256(data).hexdigest()[:16]}


# ---------------- GLB 深度分析 ----------------
def deep_glb(data):
    out = {}
    if data[:4] != b"glTF":
        return out
    declared = struct.unpack("<I", data[8:12])[0]
    off = 12
    j = None
    chunks = []
    while off + 8 <= len(data):
        clen, ctype = struct.unpack("<I4s", data[off:off + 8])
        chunks.append({"type": ctype.decode("latin1").rstrip("\0"), "length": clen})
        if ctype == b"JSON":
            j = json.loads(data[off + 8:off + 8 + clen].decode("utf-8").rstrip("\0 "))
        off += 8 + clen
    out["chunks"] = chunks
    if not j:
        return out
    out["generator"] = j.get("asset", {}).get("generator")
    out["extensionsUsed"] = j.get("extensionsUsed", [])
    out["extensionsRequired"] = j.get("extensionsRequired", [])
    out["counts"] = {k: len(j[k]) for k in
                     ["scenes", "nodes", "meshes", "materials", "animations", "images",
                      "textures", "samplers", "buffers", "bufferViews", "accessors", "skins", "cameras"]
                     if k in j}
    out["external_image_uris"] = [x.get("uri") for x in j.get("images", []) if x.get("uri")]
    out["external_buffer_uris"] = [x.get("uri") for x in j.get("buffers", []) if x.get("uri")]
    out["image_mime_types"] = dict(collections.Counter(
        x.get("mimeType", "bufferView(KTX2/内嵌)") for x in j.get("images", [])))
    draco = 0
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            if "KHR_draco_mesh_compression" in p.get("extensions", {}):
                draco += 1
    out["draco_primitives"] = draco
    out["basisu_textures"] = sum(1 for t in j.get("textures", []) if "KHR_texture_basisu" in t.get("extensions", {}))
    out["animation_names"] = [a.get("name") for a in j.get("animations", [])][:20]
    out["scene_name"] = j.get("scenes", [{}])[0].get("name") if j.get("scenes") else None
    out["node_names_sample"] = [x.get("name") for x in j.get("nodes", [])[:8] if x.get("name")]
    out["material_names_sample"] = [x.get("name") for x in j.get("materials", [])[:8] if x.get("name")]
    return out


def deep_json(data, name):
    out = {}
    try:
        j = json.loads(data.decode("utf-8"))
    except Exception as ex:
        return {"parse_error": str(ex)}
    if not isinstance(j, dict):
        return {"type": type(j).__name__, "length": len(j)}
    out["top_keys"] = list(j.keys())
    if "sheetsById" in j:  # Theatre.js state
        s = j["sheetsById"]
        out["kind"] = "Theatre.js 场景/动画状态 (state sheet)"
        out["definitionVersion"] = j.get("definitionVersion")
        out["revisionHistory_count"] = len(j.get("revisionHistory", []))
        out["sheets"] = {}
        for k, v in s.items():
            entry = {"keys": list(v.keys()) if isinstance(v, dict) else []}
            if isinstance(v, dict):
                so = v.get("staticOverrides", {}).get("byObject", {})
                entry["staticOverride_objects"] = len(so)
                entry["sequence_tracks"] = len(v.get("sequence", {}).get("tracksByObject", {}))
                entry["subKeys"] = {kk: (len(vv) if isinstance(vv, (list, dict)) else str(vv)[:60])
                                    for kk, vv in list(v.items())[:10]}
            out["sheets"][k] = entry
    if "layers" in j and "fr" in j:  # Lottie
        out["kind"] = "Lottie / Bodymovin 动画"
        out["lottie_version"] = j.get("v")
        out["name"] = j.get("nm")
        out["width"] = j.get("w")
        out["height"] = j.get("h")
        out["frameRate"] = j.get("fr")
        out["inPoint"] = j.get("ip")
        out["outPoint"] = j.get("op")
        out["duration_sec"] = round((j.get("op", 0) - j.get("ip", 0)) / j.get("fr", 1), 2) if j.get("fr") else None
        out["layers"] = [{"name": l.get("nm"), "type": l.get("ty"), "ind": l.get("ind")} for l in j.get("layers", [])]
        assets = j.get("assets", [])
        out["assets"] = [{"id": a.get("id"), "name": a.get("nm"), "path": a.get("u"),
                          "file": a.get("p"), "embedded": str(a.get("p", "")).startswith("data:")}
                         for a in assets]
        out["external_assets"] = [a for a in assets if a.get("u") and not str(a.get("p", "")).startswith("data:")]
    # 检查 mojibake（UTF-8 被按 latin1 再编码的典型特征）
    raw = data.decode("utf-8", errors="replace")
    out["mojibake_detected"] = bool(re.search(r"Ã.|Â.|â\x80", raw))
    return out


# ---------------- 主流程 ----------------
records = []
for i, e in enumerate(entries):
    req, resp, c = e["request"], e["response"], e["response"]["content"]
    h = hdr(e)
    host, path, seg = path_segments(e)
    ext = ext_of(e)
    cat = classify(e)
    data, note = decode_body(e)
    rec = {
        "index": i,
        "url": req["url"],
        "host": host,
        "path": path,
        "filename": seg[-1],
        "method": req.get("method"),
        "status": resp.get("status"),
        "statusText": resp.get("statusText"),
        "mimeType": c.get("mimeType", ""),
        "resourceType": e.get("_resourceType", ""),
        "content_size": c.get("size"),
        "bodySize": resp.get("bodySize"),
        "transferSize": resp.get("_transferSize"),
        "http_content_encoding": h.get("content-encoding", ""),
        "har_encoding": c.get("encoding") or "",
        "har_compression": c.get("compression"),
        "text_chars": len(c.get("text") or ""),
        "decoded_bytes": len(data) if data is not None else 0,
        "body_note": note,
        "category": cat,
        "out_rel": out_relpath(e, cat),
        "extractable": bool(data) and resp.get("status") == 200,
    }
    # size 一致性
    sz = c.get("size") or 0
    rec["size_match"] = (rec["decoded_bytes"] == sz)
    records.append(rec)

# 去重：同一输出路径选最佳（200 + 有内容 + 字节最多）
best = {}
for r in records:
    key = r["out_rel"]
    score = (1 if r["extractable"] else 0, r["decoded_bytes"], -r["index"])
    if key not in best or score > best[key][0]:
        best[key] = (score, r)
chosen = {k: v[1] for k, v in best.items()}

# 记录重复
dup = collections.Counter(r["out_rel"] for r in records)
for r in records:
    r["duplicate_count"] = dup[r["out_rel"]]
    r["chosen_for_extraction"] = (chosen.get(r["out_rel"], {}).get("index") == r["index"])

# 提取 + 校验
extracted = []
written = set()   # 本次运行已写入的相对路径（保证脚本幂等，重跑不产生 __2 副本）
for rel, r in chosen.items():
    if not r["extractable"]:
        continue
    e = entries[r["index"]]
    data, note = decode_body(e)
    target = OUT / rel
    # 不同 URL 映射到同一路径时加序号
    if rel in written:
        stem, suf = target.stem, target.suffix
        k = 2
        while True:
            cand = f"{stem}__{k}{suf}"
            cand_rel = str((target.parent / cand).relative_to(OUT)).replace("\\", "/")
            if cand_rel not in written:
                break
            k += 1
        target = target.parent / cand
        rel = cand_rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    written.add(rel)
    chk = check_bytes(data, ("." + r["filename"].rsplit(".", 1)[-1].lower()) if "." in r["filename"] else "",
                      r["mimeType"], r["category"])
    chk.update({"out_rel": rel, "url": r["url"], "category": r["category"],
                "status": r["status"], "har_encoding": r["har_encoding"],
                "declared_size": r["content_size"], "size_match": chk["bytes"] == r["content_size"],
                "sha256_16": chk.pop("sha256")})
    extracted.append(chk)

extracted.sort(key=lambda x: x["out_rel"])

# 重点文件深度分析
deep = {}
KEY_NAMES = ["scene_v6.16.4.glb", "bike_v9.7.glb", "oiseau_v1.glb", "state_v9.json", "logo_anim_v3.json"]
for name in KEY_NAMES:
    hits = [r for r in records if r["filename"] == name]
    r = next((x for x in hits if x["extractable"]), hits[0] if hits else None)
    if not r:
        deep[name] = {"found": False}
        continue
    data, _ = decode_body(entries[r["index"]])
    info = {"found": True, "request_indices": [x["index"] for x in hits],
            "url": r["url"], "status": r["status"], "mimeType": r["mimeType"],
            "content_size": r["content_size"], "decoded_bytes": len(data) if data else 0,
            "har_encoding": r["har_encoding"], "out_rel": next(
                (x["out_rel"] for x in extracted if x["url"] == r["url"]), None)}
    if data and data[:4] == b"glTF":
        info["glb"] = deep_glb(data)
        info["glb"]["integrity"] = "OK: magic/version/length/chunks 全部一致"
    elif data:
        info["json"] = deep_json(data, name)
    deep[name] = info

# 解码器依赖分析
decoders = [x for x in extracted if x["category"] == "decoders"]
inline_b64 = []
pat = re.compile(r"data:([^;,\"')\s]*);base64,")
for i, e in enumerate(entries):
    c = e["response"]["content"]
    t = c.get("text")
    if not t or c.get("encoding") == "base64":
        continue
    m = pat.findall(t)
    if m:
        inline_b64.append({"index": i, "url": e["request"]["url"],
                           "count": len(m), "types": dict(collections.Counter(m))})

# 失败/无内容资源
problems = []
for r in records:
    why = []
    if r["status"] != 200 and r["status"] not in (304,):
        why.append(f"HTTP {r['status']} {r['statusText']}")
    if r["status"] == 304:
        why.append("304 缓存命中，HAR 未保存响应体")
    if not r["extractable"] and r["status"] == 200:
        why.append("200 但响应体为空/未保存")
    if why:
        problems.append({"index": r["index"], "url": r["url"], "reasons": why,
                         "recoverable": r["out_rel"] in chosen and chosen[r["out_rel"]]["extractable"]})

# ---------------- 写出 ----------------
with (ANA / "requests.csv").open("w", encoding="utf-8-sig", newline="") as f:
    cols = ["index", "status", "method", "mimeType", "resourceType", "category", "content_size",
            "bodySize", "transferSize", "http_content_encoding", "har_encoding", "text_chars",
            "decoded_bytes", "size_match", "duplicate_count", "chosen_for_extraction",
            "filename", "out_rel", "extractable", "url"]
    w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in records:
        w.writerow(r)

by_status = dict(collections.Counter(r["status"] for r in records))
by_mime = dict(collections.Counter(r["mimeType"] or "(none)" for r in records))
by_cat = dict(collections.Counter(r["category"] for r in records))
by_cat_size = {c: sum(x["bytes"] for x in extracted if x["category"] == c) for c in by_cat}

report = {
    "source": str(HAR), "source_bytes": HAR.stat().st_size,
    "har_version": log.get("version"), "creator": log.get("creator"),
    "pages": log.get("pages"), "entry_count": len(entries),
    "by_status": by_status, "by_mime": by_mime, "by_category": by_cat,
    "by_category_extracted_bytes": by_cat_size,
    "total_content_bytes": sum(r["content_size"] or 0 for r in records),
    "total_transfer_bytes": sum(r["transferSize"] or 0 for r in records),
    "base64_entry_count": sum(1 for r in records if r["har_encoding"] == "base64"),
    "http_encoding": dict(collections.Counter(r["http_content_encoding"] or "(none)" for r in records)),
    "unique_output_paths": len(chosen),
    "extracted_file_count": len(extracted),
    "extracted_total_bytes": sum(x["bytes"] for x in extracted),
    "inline_data_uris": inline_b64,
    "decoders": decoders,
    "key_files": deep,
    "problems": problems,
    "size_mismatch": [{"index": r["index"], "url": r["url"], "declared": r["content_size"],
                       "decoded": r["decoded_bytes"]} for r in records
                      if r["extractable"] and not r["size_match"]],
    "records": records,
    "extracted": extracted,
}
with (ANA / "har_report.json").open("w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

with (OUT / "_extraction_map.json").open("w", encoding="utf-8") as f:
    json.dump({"note": "原始 URL -> 提取文件相对路径（extracted/ 为根）",
               "mapping": {x["url"]: x["out_rel"] for x in extracted}},
              f, ensure_ascii=False, indent=2)

# ---------------- 控制台摘要 ----------------
print("HAR entries            :", len(entries))
print("status                 :", by_status)
print("base64 编码条目         :", report["base64_entry_count"])
print("唯一输出路径            :", len(chosen))
print("实际提取文件            :", len(extracted), "共", report["extracted_total_bytes"], "字节")
print("分类统计(请求数)        :", by_cat)
print("分类统计(提取字节)      :", by_cat_size)
print("校验失败文件            :", [x["out_rel"] for x in extracted if not x["valid"]] or "无")
print("size 不一致条目         :", len(report["size_mismatch"]))
print("问题请求                :", len(problems), "其中可恢复:", sum(1 for p in problems if p["recoverable"]))
print("解码器文件              :", [x["out_rel"] for x in decoders])
print("内联 data URI           :", inline_b64)
print()
print("=== 重点文件深挖 ===")
for k, v in deep.items():
    print("--", k, "->", v.get("out_rel"), "大小", v.get("decoded_bytes"))
    if "glb" in v:
        g = v["glb"]
        print("   counts:", g.get("counts"))
        print("   required:", g.get("extensionsRequired"))
        print("   image mime:", g.get("image_mime_types"))
        print("   draco primitives:", g.get("draco_primitives"), " basisu textures:", g.get("basisu_textures"))
        print("   external refs:", len(g.get("external_image_uris", [])), len(g.get("external_buffer_uris", [])))
        print("   animations:", g.get("animation_names"))
    if "json" in v:
        j = v["json"]
        print("   kind:", j.get("kind"), "keys:", j.get("top_keys"))
        print("   sheets:", j.get("sheets"))
        print("   lottie:", {kk: j.get(kk) for kk in ["lottie_version", "width", "height", "frameRate", "duration_sec", "assets"]})
        print("   mojibake:", j.get("mojibake_detected"))
