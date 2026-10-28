# World Oil Network

Interactive network graph of the global oil system — crude production → refining → consumption —
with trade flows between countries and a year slider. Static site (HTML/JS), hosted on GitHub Pages.

Work in progress: built by OpenRig agents, reviewed and published by a human.

## Run and check

```sh
python3 -m http.server -d docs                  # then open http://localhost:8000/ (fetch needs HTTP, not file://)
python3 -m unittest discover -s tests           # site guards (no outside origins, CSP, vendored D3, attribution) and compute.js vs Python (needs node)
python3 -m unittest discover -s pipeline        # data pipeline checks
```

The site loads nothing from other origins: D3 is vendored in `docs/vendor/` (version, source and sha256 in its README),
and a `<meta>` Content-Security-Policy only allows the site's own files. That means no inline `<script>` or `style=`
attributes; keep styling in `docs/style.css`.
