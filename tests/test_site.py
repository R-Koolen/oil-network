"""Guards the site's hard requirements: nothing loads from outside the site, and the attribution is shown.

Run from the repository root: python3 -m unittest discover -s tests
"""
import hashlib
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
PAGES = sorted(DOCS.glob("*.html"))
ABSOLUTE = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//)", re.I)


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []  # (tag, attrs dict)
        self.text = []
        self.inline_script = False
        self._script_src = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if tag == "script":
            self._script_src = attrs.get("src")
            if not self._script_src:
                self.inline_script = True

    def handle_data(self, data):
        self.text.append(data)

    def handle_endtag(self, tag):
        if tag == "script":
            self._script_src = None


def parse(path):
    page = Page()
    page.feed(path.read_text(encoding="utf-8"))
    return page


def squash(text):
    return " ".join(text.split())


def attribution():
    lines = (DOCS / "SOURCES.md").read_text(encoding="utf-8").split("## Required attribution")[1].split("\n## ")[0]
    quote = [line[1:].strip() for line in lines.splitlines() if line.startswith(">")]
    return squash(" ".join(quote))


class TestSite(unittest.TestCase):
    def test_there_are_pages(self):
        self.assertTrue(PAGES, "no docs/*.html found")

    def test_resource_references_are_relative(self):
        for path in PAGES:
            for tag, attrs in parse(path).tags:
                for name in ("src", "href", "srcset", "poster", "data", "action"):
                    value = attrs.get(name)
                    if value is None or (tag == "a" and name == "href"):
                        continue  # plain links to the sources load nothing
                    with self.subTest(page=path.name, tag=tag, attr=name, value=value):
                        self.assertFalse(ABSOLUTE.match(value.strip()), "must be a relative path")
                        self.assertTrue((path.parent / urlparse(value).path).exists(), "file is missing")

    def test_csp_is_present_and_site_only(self):
        for path in PAGES:
            metas = [a for t, a in parse(path).tags
                     if t == "meta" and a.get("http-equiv", "").lower() == "content-security-policy"]
            with self.subTest(page=path.name):
                self.assertEqual(len(metas), 1, "expected exactly one CSP meta")
                csp = metas[0]["content"]
                self.assertNotIn("unsafe-inline", csp)
                self.assertNotIn("unsafe-eval", csp)
                self.assertNotRegex(csp, r"https?:|//|\bdata:|\*")
                self.assertRegex(csp, r"default-src 'none'")
                self.assertRegex(csp, r"script-src 'self'(?:;|$)")

    def test_no_inline_script_or_style(self):
        for path in PAGES:
            page = parse(path)
            with self.subTest(page=path.name):
                self.assertFalse(page.inline_script, "inline <script>")
                self.assertFalse([t for t, _ in page.tags if t == "style"], "<style> element")
                self.assertFalse([t for t, a in page.tags if "style" in a], "style= attribute")
                handlers = [(t, k) for t, a in page.tags for k in a if k.startswith("on")]
                self.assertFalse(handlers, "inline event handlers")

    def test_site_files_reference_no_other_origin(self):
        for path in list(DOCS.glob("*.js")) + list(DOCS.glob("*.css")):
            with self.subTest(file=path.name):
                text = path.read_text(encoding="utf-8")
                self.assertNotRegex(text, r"https?://|(?<![:\w])//\w+\.\w", "absolute URL")
                self.assertNotRegex(text, r"@import", "css @import")
                self.assertNotRegex(text, r"""\.attr\(\s*["']style["']""", "style attribute set from JS")

    def test_vendored_libraries_match_their_records(self):
        vendor = DOCS / "vendor"
        record = (vendor / "README.md").read_text(encoding="utf-8")
        rows = re.findall(r"^\| `([\w.-]+\.js)` \|[^|]*\| ([\d.]+) \|[^|]*\| `([0-9a-f]{64})` \| `(LICENSE[\w-]*)`", record, re.M)
        recorded = {name for name, *_ in rows}
        # any new vendored script has to be recorded here too
        self.assertEqual({p.name for p in vendor.glob("*.js")}, recorded)
        self.assertTrue(rows)
        for name, version, sha, licence in rows:
            with self.subTest(file=name):
                self.assertEqual(hashlib.sha256((vendor / name).read_bytes()).hexdigest(), sha)
                self.assertRegex(version, r"^\d+\.\d+\.\d+$")
                self.assertTrue((vendor / licence).read_text(encoding="utf-8").strip(), f"{licence} is missing or empty")
        self.assertIn("https://", record)
        self.assertTrue((vendor / "LICENSE-world-atlas").read_text(encoding="utf-8").strip())

    def test_attribution_is_shown_word_for_word(self):
        expected = attribution()
        self.assertIn("Etalab", expected)  # the parse found the real section
        for path in PAGES:
            with self.subTest(page=path.name):
                self.assertIn(expected, squash("".join(parse(path).text)))


if __name__ == "__main__":
    unittest.main()
