"""Download the raw source files into data/raw/ (gitignored).

    python3 pipeline/fetch.py

Standard library only. Re-running skips files that already exist; delete one to fetch it again.
"""
import csv
import html
import re
import time
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"

EIA_URL = "https://api.eia.gov/bulk/INTL.zip"
BACI_URL = "https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS12_V202601.zip"
M49_URL = "https://unstats.un.org/unsd/methodology/m49/overview/"
# UNdata's CSV download handler now redirects to a JavaScript app, so we page through the HTML view.
UNDATA_PAGE = ("https://data.un.org/Data.aspx?d=EDATA&f=cmID%3aCR%3btrID%3a{tr}"
               "&c=0,1,2,3,4,5,6,7,8,9&s=_crEngNameOrderBy:asc,_enID:asc,yr:desc&v={page}")
UNDATA_TRANSACTIONS = {"131": "refinery capacity", "086": "transformation in oil refineries"}
UNDATA_COLUMNS = ["commodity", "m49", "country", "transaction", "commodity_transaction_code",
                  "commodity_transaction", "year", "unit", "quantity", "footnote"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "oil-network-pipeline"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def download(url, path):
    if path.exists():
        print(f"have {path.name}")
        return
    print(f"fetch {url}")
    tmp = path.with_suffix(path.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "oil-network-pipeline"})
    with urllib.request.urlopen(req, timeout=600) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(path)


def cells(row_html):
    return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
            for c in re.findall(r"(?s)<td[^>]*>(.*?)</td>", row_html)]


def fetch_undata(path):
    if path.exists():
        print(f"have {path.name}")
        return
    rows = []
    for tr in UNDATA_TRANSACTIONS:
        page = 1
        while True:
            text = get(UNDATA_PAGE.format(tr=tr, page=page)).decode("utf-8")
            total = int(re.search(r'id="spanRecordCountB"[^>]*>(\d+)', text).group(1))
            got = [c for c in map(cells, re.findall(r"(?s)<tr>(.*?)</tr>", text)) if len(c) >= 9]
            # cells: 9 data columns, an empty spacer column, then the footnote marker
            rows += [c[:9] + [c[10] if len(c) > 10 else ""] for c in got]
            print(f"undata {tr} page {page}: {len(got)} rows ({total} total)")
            if not got or page * 50 >= total:
                break
            page += 1
            time.sleep(0.5)
        n = sum(1 for r in rows if r[3] == tr)
        if n != total:
            raise SystemExit(f"undata {tr}: got {n} rows, page said {total}")
    tmp = path.with_suffix(".part")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(UNDATA_COLUMNS)
        w.writerows(rows)
    tmp.rename(path)


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    download(EIA_URL, RAW / "INTL.zip")
    download(M49_URL, RAW / "m49.html")
    fetch_undata(RAW / "undata_refining.csv")
    download(BACI_URL, RAW / Path(BACI_URL).name)


if __name__ == "__main__":
    main()
