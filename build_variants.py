#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parse cjkvi-tables into equivalence groups (简/繁/异体/日本新旧字体).
Output: variants.json  ->  { "char": "all_equivalent_chars_string", ... }
Only chars belonging to a group of size>1 are emitted.
"""
import json, re, sys, os

SRC = sys.argv[1] if len(sys.argv) > 1 else "cjkvi-tables"
OUT = sys.argv[2] if len(sys.argv) > 2 else "variants.json"

parent = {}
def find(x):
    parent.setdefault(x, x)
    root = x
    while parent[root] != root:
        root = parent[root]
    while parent[x] != root:
        parent[x], x = root, parent[x]
    return root
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra

def is_cjk(c):
    o = ord(c)
    return (0x3400 <= o <= 0x9FFF) or (0x20000 <= o <= 0x2FFFF) or (0xF900 <= o <= 0xFAFF)

def link(head, others):
    if not head or not is_cjk(head):
        return
    for c in others:
        if is_cjk(c):
            union(head, c)

def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.readlines()

stats = {}

# 1) 简繁汉字对照表 zibiao2009-5.txt :  简[繁] / 简*[繁] / (续行)　[繁]
n = 0; last_head = None
for line in read("zibiao2009-5.txt"):
    s = line.rstrip("\n")
    m = re.match(r'^(\S)\*?\[(.+?)\]', s)          # 字头行(字头非空白)
    if m:
        last_head = m.group(1); link(last_head, m.group(2)); n += 1; continue
    m = re.match(r'^\s+\[(.+?)\]', s)              # 续行(多繁体)
    if m and last_head:
        link(last_head, m.group(1)); n += 1
stats["zibiao2009-5(简繁)"] = n

# 2) 简化字总表 zongbiao1986.txt :  简〔繁〕 / (续行)　〔繁〕
n = 0; last_head = None
for line in read("zongbiao1986.txt"):
    s = line.rstrip("\n")
    m = re.match(r'^(\S)〔([^〕]+)〕', s)
    if m:
        last_head = m.group(1); link(last_head, m.group(2)); n += 1; continue
    m = re.match(r'^\s+〔([^〕]+)〕', s)
    if m and last_head:
        link(last_head, m.group(1)); n += 1
stats["zongbiao1986(简化字总表)"] = n

# 3) 第一批异体字整理表 yyb1995.txt :  正 ［异体...］
n = 0
for line in read("yyb1995.txt"):
    m = re.match(r'^(\S)\s*[［〔]([^］〕]+)[］〕]', line)
    if m:
        link(m.group(1), m.group(2)); n += 1
stats["yyb1995(异体字整理表)"] = n

# 4) 日本新旧字体 joyo2010.txt :  新\t旧\t...
n = 0
for line in read("joyo2010.txt"):
    if line.startswith("#"):
        continue
    cols = line.rstrip("\n").split("\t")
    if len(cols) >= 2 and cols[0] and cols[1]:
        link(cols[0], cols[1]); n += 1
stats["joyo2010(日本新旧字体)"] = n

# ---- collect groups ----
groups = {}
for c in list(parent.keys()):
    groups.setdefault(find(c), set()).add(c)

table = {}; sizes = []
for members in groups.values():
    if len(members) < 2:
        continue
    sizes.append(len(members))
    joined = "".join(sorted(members))
    for c in members:
        table[c] = joined

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(table, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

print("解析统计(配对数):")
for k, v in stats.items():
    print(f"  {k}: {v}")
print(f"等价字组数: {len(sizes)} ; 覆盖字头数: {len(table)}")
print(f"最大组: {max(sizes)} ; 平均: {sum(sizes)/len(sizes):.2f}")
for g in sorted(groups.values(), key=len, reverse=True)[:5]:
    print("  大组:", "".join(sorted(g)))
print(f"输出: {OUT} ({os.path.getsize(OUT)} bytes)")
