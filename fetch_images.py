#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1001craft 配图管线：为每款精酿抓取真实酒标/酒瓶照片，下载到 images/{id}.jpg。
主源 Open Food Facts（众包食品库，开放许可的产品正面照，按名称+酒厂匹配、要求命中 beer 类目，保守匹配防错图）。
兜底 Wikipedia REST summary（仅当摘要含 beer/ale/lager/brewery 等词，避免消歧义误配）。
生成 _images.json 清单 {id:{ok,source,src,...}}。匹配不到就留空 → 前端走 emoji 兜底。
用法: python fetch_images.py            # 全量（跳过已下载）
      python fetch_images.py --force    # 重下全部
      python fetch_images.py --ids 5,7  # 只处理指定 id
"""
import json, os, re, sys, time, urllib.parse, urllib.request, urllib.error

# Windows 控制台默认 GBK，打印重音字符(ä/é 等)会崩 → 强制 UTF-8
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

ROOT = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(ROOT, "images")
MANIFEST = os.path.join(ROOT, "_images.json")
UA = "1001craft/1.0 (educational bilingual craft-beer gallery; contact popstudy@gmail.com)"
OFF_SEARCH = "https://search.openfoodfacts.org/search"   # search-a-licious（相关性排序好）
WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary/"

# 风格/修饰词：不能用它们做酒名区分（否则 gueuze/hell/märzen 会跨酒厂误配）
STYLE = set("""beer beers ale ales ipa apa neipa dipa stout porter lager lagers pils pilsner pilsener
the of de la le du und and with by from für pour
dubbel tripel quad quadrupel wit witbier weisse weissbier weiss hefeweissbier hefeweizen weizen weizenbock
bock doppelbock eisbock maibock schwarzbier dunkel helles hell festbier oktoberfest märzen marzen kellerbier
kölsch kolsch altbier steam gueuze geuze lambic kriek framboise frambozen cassis gose berliner saison
farmhouse rauchbier smoked barleywine barley wine gruit rye
blonde blond dark red amber brown black gold golden pale strong extra special original classic premium
imperial double triple session hazy juicy west coast east fresh squeezed milk oatmeal sweet dry wild sour
pumpkin watermelon banana chocolate coffee mocha nitro brut cuvée cuvee vintage
brand brewing brewery brauerei bräu brau brouwerij brasserie company cerveza cerveja bier bière biere
grand cru reserve réserve abt trappist trappistes india""".split())

# 酒厂名里的通用词（不能靠它们判定"同酒厂"，否则 Samuel Smith 会误配 Samuel Adams）
BREW_COMMON = set("""samuel saint brasserie brouwerij brewery brewing brauerei company companie
brothers finest liquids liquid state coast beer bier brau bräu nv inc ltd co the moortgat""".split())

# 人工复核判为"同酒厂错款/变体/无法区分"的误配 —— 永久拉黑，强制走 emoji 兜底，不再抓取
# 4/16/55=维森非目标款  56=施耐德错款 59=保拉纳柠檬 64=圣伯纳三料≠白 67=柏林Radler≠Weisse
# 74=罗斯福8≠10  79=Delirium Red≠Tremens  90=早餐世涛配到KBS  94=Yeti配到巧克力橡木变体
# 100=Fuller's配到London Pride  139=Rübæus配到Centennial IPA
BAD_IDS = {4, 16, 55, 56, 59, 64, 67, 74, 79, 90, 94, 100, 139}

def norm_tokens(s):
    s = re.sub(r"[^0-9a-zA-Zäöüßéèêàâçñ ]", " ", (s or "").lower())
    return [t for t in s.split() if len(t) >= 4]

def load_beers():
    txt = open(os.path.join(ROOT, "beers.js"), encoding="utf-8").read()
    arr = txt[txt.index("["): txt.rindex("]") + 1]
    arr = re.sub(r"/\*.*?\*/", "", arr, flags=re.S)   # 去分区注释
    arr = re.sub(r",\s*]", "]", arr)                   # 去尾逗号
    return json.loads(arr)

def http_json(url, retries=2):
    last = None
    for a in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503) and a < retries:
                time.sleep(1.5 * (a + 1)); continue
            raise
    raise last

def _brands_str(p):
    b = p.get("brands", "")
    return " ".join(b) if isinstance(b, list) else (b or "")

def off_image(name_en, brewery_en):
    """Open Food Facts (search-a-licious) 严格匹配，返回 (img_url, matched) 或 None。
    高精度优先：① 必须是啤酒类目；② 必须命中【区分性酒厂词】；③ 有区分性酒名词时须在产品名命中。
    宁可漏配走 emoji 兜底，也不配错标。"""
    name_tok = norm_tokens(name_en)
    brew_tok = [t for t in norm_tokens(brewery_en) if t not in BREW_COMMON]
    # 区分性酒名词 = 酒名词 - 酒厂词 - 风格词（如 Korbinian / Oberon / Rasputin / Sculpin）
    distinct = [t for t in name_tok if t not in brew_tok and t not in STYLE]
    # 酒名里的风格词（同酒厂多风格时用来区分，如 Westmalle Dubbel vs Tripel）
    style_tok = [t for t in name_tok if t in STYLE and t not in ("beer", "beers", "ale", "ales")]
    q = urllib.parse.urlencode({
        "q": "%s %s" % (name_en, brewery_en),
        "fields": "code,product_name,brands,categories_tags,image_front_url",
        "page_size": 20,
    })
    data = http_json(OFF_SEARCH + "?" + q)
    best, best_score = None, 0
    for p in data.get("hits", []):
        img = p.get("image_front_url")
        if not img:
            continue
        pname = (p.get("product_name", "") or "").lower()
        brands = _brands_str(p).lower()
        blob = pname + " " + brands
        cats = " ".join(p.get("categories_tags", []))
        if not ("beer" in cats or "biere" in cats or "cerveza" in cats):
            continue                                   # ① 必须啤酒类目（挡掉奶酪/威士忌/三文鱼等）
        if brew_tok and not any(t in blob for t in brew_tok):
            continue                                   # ② 必须命中区分性酒厂词（挡掉错酒厂）
        if distinct:                                   # ③ 有区分性酒名词 → 必须在产品名命中
            score = sum(1 for t in distinct if t in pname)
            if score == 0:
                continue
        else:                                          # 无区分性酒名词（名字≈酒厂+风格）
            if style_tok and not any(t in pname for t in style_tok):
                continue                               # 有风格词却对不上 → 跳过（如 Dubbel 对 Tripel）
            score = 1
        if score > best_score:
            best = (img, "%s / %s" % (p.get("product_name", ""), brands))
            best_score = score
    return best

def wiki_image(name_en, brewery_en):
    """Wikipedia REST 摘要兜底：摘要须含啤酒相关词，取 thumbnail。返回 (url, title) 或 None"""
    for title in (name_en, "%s (beer)" % name_en, "%s %s" % (name_en, brewery_en)):
        try:
            enc = urllib.parse.quote(title.replace(" ", "_"))
            d = http_json(WIKI_REST + enc)
        except Exception:
            continue
        extract = (d.get("extract", "") + " " + d.get("description", "")).lower()
        if not any(w in extract for w in ("beer", "ale", "lager", "stout", "brewery", "brewed", "brewing", "pilsner", "ipa")):
            continue
        # 用 originalimage（不改宽度，避免 Wikimedia 拒绝放大的 400）；无则用 thumbnail 原样
        orig = d.get("originalimage", {}).get("source")
        thumb = d.get("thumbnail", {}).get("source")
        url = orig or thumb
        if not url or url.lower().endswith(".svg"):
            continue
        return url, d.get("title", title)
    return None

COMMONS_API = "https://commons.wikimedia.org/w/api.php"

def commons_image(name_en, brewery_en):
    """Wikimedia Commons 文件搜索兜底（很多膜拜美酒有酒瓶照）。严格：文件标题须同时含
    区分性酒名词 + (酒厂词或啤酒词)，且是位图，避免误配古籍 PDF/无关图。返回 (url, title) 或 None。"""
    name_tok = norm_tokens(name_en)
    brew_tok = [t for t in norm_tokens(brewery_en) if t not in BREW_COMMON]
    distinct = [t for t in name_tok if t not in brew_tok and t not in STYLE]
    if not distinct:
        return None                                    # 无区分性酒名词 → 不冒险
    q = urllib.parse.urlencode({
        "action": "query", "generator": "search",
        "gsrsearch": "%s %s beer" % (name_en, brewery_en),
        "gsrnamespace": 6, "gsrlimit": 12,
        "prop": "imageinfo", "iiprop": "url|mime", "iiurlwidth": 600, "format": "json",
    })
    d = http_json(COMMONS_API + "?" + q)
    pages = sorted((d.get("query", {}).get("pages") or {}).values(),
                   key=lambda p: p.get("index", 99))
    BEERWORD = ("beer", "ale", "stout", "porter", "ipa", "lager", "pilsner", "bottle", "can")
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        mime = ii.get("mime", "")
        if not mime.startswith("image/") or "svg" in mime:
            continue
        title = re.sub(r"^file:", "", (p.get("title", "") or "").lower())
        if not any(t in title for t in distinct):
            continue                                   # 须含区分性酒名词
        if not (any(t in title for t in brew_tok) or any(w in title for w in BEERWORD)):
            continue                                   # 再要求酒厂词或啤酒词，降误配
        url = ii.get("thumburl") or ii.get("url")
        if url:
            return url, p.get("title", "")
    return None

def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        blob = r.read()
    if len(blob) < 2000:
        raise ValueError("image too small (%d bytes)" % len(blob))
    with open(dest, "wb") as f:
        f.write(blob)
    return len(blob)

def main():
    force = "--force" in sys.argv
    only = None
    if "--ids" in sys.argv:
        only = set(int(x) for x in sys.argv[sys.argv.index("--ids") + 1].split(","))
    os.makedirs(IMG_DIR, exist_ok=True)
    beers = load_beers()
    manifest = {}
    if os.path.exists(MANIFEST):
        manifest = json.load(open(MANIFEST, encoding="utf-8"))

    ok = fail = skip = 0
    fails = []
    for b in beers:
        bid = b["id"]
        if only and bid not in only:
            continue
        if bid in BAD_IDS:                             # 永久拉黑：删图 + 记 ok:false，绝不抓取
            dest = os.path.join(IMG_DIR, "%d.jpg" % bid)
            if os.path.exists(dest):
                os.remove(dest)
            manifest[str(bid)] = {"ok": False, "blacklisted": True}
            continue
        dest = os.path.join(IMG_DIR, "%d.jpg" % bid)
        if not force and os.path.exists(dest) and os.path.getsize(dest) > 2000:
            skip += 1
            continue
        got = None
        source = None
        for src_name, fn in (("off", off_image), ("wiki", wiki_image), ("commons", commons_image)):
            try:
                got = fn(b["name_en"], b["brewery_en"])
                if got:
                    source = src_name
                    break
            except Exception as e:
                print("  %s err [%s] %s: %s" % (src_name, bid, b["name_en"], e))
            time.sleep(0.25)
        if not got:
            fail += 1
            fails.append((bid, b["name_en"]))
            manifest[str(bid)] = {"ok": False, "name": b["name_en"]}
            print("  MISS %-4d %s" % (bid, b["name_en"]))
            time.sleep(0.25)
            continue
        img_url, matched = got
        try:
            size = download(img_url, dest)
            ok += 1
            manifest[str(bid)] = {"ok": True, "source": source, "src": img_url,
                                  "matched": matched, "bytes": size}
            print("  OK   %-4d %-30s [%s] <- %s" % (bid, b["name_en"], source, matched))
        except Exception as e:
            fail += 1
            fails.append((bid, b["name_en"]))
            manifest[str(bid)] = {"ok": False, "name": b["name_en"], "err": str(e)}
            print("  DLERR %-4d %s: %s" % (bid, b["name_en"], e))
        time.sleep(0.3)

    json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print("\n=== done: %d ok, %d fail, %d skip (total %d) ===" % (ok, fail, skip, len(beers)))
    if fails:
        print("misses:", ", ".join("%d(%s)" % (i, n) for i, n in fails))

if __name__ == "__main__":
    main()
