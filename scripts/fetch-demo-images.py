#!/usr/bin/env python3
"""Downloads a CC0 / public-domain photo from Wikimedia Commons for each demo item.

Usage: python3 scripts/fetch-demo-images.py [--only N ...]
Writes demo/uploads/demo/NN.jpg and demo/images.json (credits). To pick a different
photo for an item, put its Commons file title in demo/image-overrides.json:
  { "12": "File:Some photo.jpg" }
"""
import html
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "demo"
OUT = DEMO / "uploads" / "demo"
API = "https://commons.wikimedia.org/w/api.php"
UA = "inventory-tracker-demo-builder/1.0 (https://github.com/; demo data)"
# Commons structured data: license CC0, or copyright status public domain.
FREE = "haswbstatement:P275=Q6938433|P6216=Q19652"
FREE_LICENSES = re.compile(r"^(cc0|public domain|pd\b|pdm)", re.I)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def api(**params):
    params.update(format="json", formatversion="2")
    return json.loads(get(API + "?" + urllib.parse.urlencode(params)))


def info_for(titles):
    data = api(action="query", titles="|".join(titles), prop="imageinfo", iiprop="url|extmetadata|size|mime", iiurlwidth="1200")
    return {p["title"]: p for p in data["query"]["pages"] if "imageinfo" in p}


def candidates(query):
    data = api(action="query", list="search", srnamespace="6", srlimit="15", srsearch=f"{query} filetype:bitmap {FREE}")
    titles = [r["title"] for r in data["query"]["search"]]
    if not titles:
        return []
    pages = info_for(titles)
    out = []
    for t in titles:
        p = pages.get(t)
        if not p:
            continue
        ii = p["imageinfo"][0]
        lic = ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value", "")
        if ii.get("mime") not in ("image/jpeg", "image/png") or not FREE_LICENSES.match(lic):
            continue
        ratio = ii["width"] / ii["height"]
        if ii["width"] < 700 or not 0.6 <= ratio <= 1.9:
            continue
        out.append(p)
    return out


def strip(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def main():
    items = json.loads((DEMO / "items.json").read_text())
    overrides_file = DEMO / "image-overrides.json"
    overrides = json.loads(overrides_file.read_text()) if overrides_file.exists() else {}
    credits_file = DEMO / "images.json"
    credits = json.loads(credits_file.read_text()) if credits_file.exists() else {}
    only = {int(a) for a in sys.argv[sys.argv.index("--only") + 1 :]} if "--only" in sys.argv else None
    OUT.mkdir(parents=True, exist_ok=True)

    for i, item in enumerate(items):
        if only is not None and i not in only:
            continue
        key = str(i)
        if key in overrides:
            page = info_for([overrides[key]]).get(overrides[key])
            pick = [page] if page else []
        else:
            pick = candidates(item["query"])
        if not pick:
            print(f"{i:2} {item['name']}: no free image found", file=sys.stderr)
            credits.pop(key, None)
            continue
        p = pick[0]
        ii = p["imageinfo"][0]
        meta = ii.get("extmetadata", {})
        img = Image.open(io.BytesIO(get(ii.get("thumburl") or ii["url"]))).convert("RGB")
        img.thumbnail((1200, 1200))
        img.save(OUT / f"{i:02}.jpg", "JPEG", quality=84, optimize=True)
        credits[key] = {
            "file": f"demo/{i:02}.jpg",
            "title": p["title"],
            "page": ii["descriptionurl"],
            "license": strip(meta.get("LicenseShortName", {}).get("value")),
            "artist": strip(meta.get("Artist", {}).get("value"))[:200],
        }
        print(f"{i:2} {item['name']}: {p['title']} [{credits[key]['license']}]")
        time.sleep(0.5)

    credits_file.write_text(json.dumps(dict(sorted(credits.items(), key=lambda kv: int(kv[0]))), indent=2) + "\n")


if __name__ == "__main__":
    main()
