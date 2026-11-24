# -*- coding: utf-8 -*-
"""HAR 结构概览：只做只读统计，不写任何资源文件。"""
import sys, json, collections, os

sys.stdout.reconfigure(encoding="utf-8")

HAR = r"E:/文档/摩托车抓包/download"

with open(HAR, "r", encoding="utf-8") as f:
    data = json.load(f)

log = data["log"]
entries = log["entries"]
print("HAR version :", log.get("version"))
print("creator     :", log.get("creator"))
print("pages       :", len(log.get("pages", [])))
for p in log.get("pages", []):
    print("   page     :", p.get("title"), p.get("startedDateTime"), p.get("id"))
print("entries     :", len(entries))
print()

# 顶层 key 集合
topkeys = collections.Counter()
for e in entries:
    topkeys.update(e.keys())
print("=== entry 顶层字段出现次数 ===")
for k, v in topkeys.most_common():
    print(f"  {k:24s} {v}")
print()

reqkeys = collections.Counter()
respkeys = collections.Counter()
contentkeys = collections.Counter()
for e in entries:
    reqkeys.update(e.get("request", {}).keys())
    respkeys.update(e.get("response", {}).keys())
    contentkeys.update(e.get("response", {}).get("content", {}).keys())
print("=== request 字段 ===", dict(reqkeys))
print("=== response 字段 ===", dict(respkeys))
print("=== content 字段 ===", dict(contentkeys))
print()

status = collections.Counter()
mime = collections.Counter()
rtype = collections.Counter()
enc = collections.Counter()
has_text = 0
text_base64 = 0
empty_text = 0
method = collections.Counter()
for e in entries:
    r = e.get("response", {})
    c = r.get("content", {})
    status[r.get("status")] += 1
    mime[c.get("mimeType", "(none)")] += 1
    rtype[e.get("_resourceType", "(none)")] += 1
    enc[c.get("encoding", "(none)")] += 1
    method[e.get("request", {}).get("method", "?")] += 1
    t = c.get("text")
    if t is not None:
        has_text += 1
        if c.get("encoding") == "base64":
            text_base64 += 1
        if t == "":
            empty_text += 1
    else:
        empty_text += 1

print("=== status ===", dict(status))
print("=== method ===", dict(method))
print("=== _resourceType ===", dict(rtype))
print("=== content.encoding ===", dict(enc))
print("=== mimeType ===")
for k, v in mime.most_common():
    print(f"   {v:5d}  {k}")
print()
print(f"entries 带 content.text : {has_text} / {len(entries)}")
print(f"其中 base64 编码        : {text_base64}")
print(f"content.text 为空/缺失  : {empty_text}")
print()

print("=== 全部 URL（按序号） ===")
for i, e in enumerate(entries):
    r = e.get("response", {})
    c = r.get("content", {})
    u = e.get("request", {}).get("url", "")
    print(f"[{i:3d}] {r.get('status')} {c.get('mimeType','')[:28]:28s} sz={c.get('size',0):>9} enc={str(c.get('encoding','')):7s} text={len(c.get('text') or ''):>9}  {u[:180]}")
