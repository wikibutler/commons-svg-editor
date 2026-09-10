# Third-party notices

*Mirrored copy of the repository-root [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) so that it is also served by the deployed site (GitHub Pages publishes `docs/`). Keep the two in sync.*

This repository **redistributes** third-party code (it vendors a built copy of the SVG-Edit editor into
`docs/vendor/svgedit/`) and **uses** third-party tools at development time. Both are disclosed here.

If you are looking for one line: **the vendored editor is not "plain MIT".** SVG-Edit's npm package declares the
compound licence expression `(MIT AND Apache-2.0 AND ISC AND LGPL-3.0-or-later AND X11)`, and the prebuilt
bundle in `docs/vendor/svgedit/iife-Editor.js` contains code under all of those. Full texts are shipped in
`docs/vendor/svgedit/LICENSES/`, and upstream's own per-file inventory is shipped verbatim at
`docs/vendor/svgedit/licenseInfo.json`.

## 1. Redistributed in this repository

| Component | Version | Licence (SPDX) | Where | Upstream |
|---|---|---|---|---|
| **SVG-Edit** (`svgedit`) | 7.4.2 | **`(MIT AND Apache-2.0 AND ISC AND LGPL-3.0-or-later AND X11)`** | `docs/vendor/svgedit/` (unmodified files copied from the package's `dist/editor/`) | https://github.com/SVG-Edit/svgedit · https://www.npmjs.com/package/svgedit/v/7.4.2 |
| @svgedit/svgcanvas | 7.4.2 | MIT | inside `iife-Editor.js` | https://github.com/SVG-Edit/svgedit |
| browser-fs-access | 0.38.0 | Apache-2.0 | `docs/vendor/svgedit/extensions/node_modules/` | https://github.com/cyco130/browser-fs-access |
| elix | 15.0.1 | MIT | inside `iife-Editor.js` | https://github.com/elix) |
| i18next | 26.3.6 | MIT | inside `iife-Editor.js` | https://github.com/i18next/i18next |
| jspdf | 4.2.1 | MIT (package) / **X11** for the bundled `jspdf.min.js` | inside `iife-Editor.js` | https://github.com/parallax/jsPDF |
| svg2pdf.js | 2.7.0 | MIT | inside `iife-Editor.js` | https://github.com/yWorks/svg2pdf.js |
| pathseg | 1.2.1 | X11 ("Chromium's License") | inside `iife-Editor.js` | https://github.com/progers/pathseg |

### Per-file licences inside the bundle (from upstream `licenseInfo.json`, shipped verbatim)

| Licence | Files |
|---|---|
| Apache-2.0 | `contextmenu.js`, `extensions/ext-foreignobject.js`, `extensions/ext-grid.js`, `extensions/ext-markers.js`, `jgraduate/jQuery.jGraduate.js`, `extensions/mathjax/MathJax.min.js`, `extensions/mathjax/TeX-AMS-MML_SVG.js` |
| **LGPL-3.0-or-later** | `jspdf/jspdf.plugin.svgToPdf.js` |
| X11 | `jspdf/jspdf.min.js` |
| MIT OR GPL-2.0 | `jquerybbq/jquery.bbq.min.js` |
| MIT OR GPL-2.0-or-later | `extensions/ext-server_moinsave.js` |

### Dependencies compiled into the upstream bundle (upstream's `bundledRootPackages`)

| Package | Version | Licence | Source |
|---|---|---|---|
| load-stylesheets | 0.13.0 | MIT | npm |
| jamilih | 0.69.1 | MIT | npm |
| query-result | 1.0.5 | **ISC** | npm |
| qr-manipulation | 0.7.0 | MIT | npm |
| stackblur-canvas | 2.7.0 | MIT | npm |
| regenerator-runtime | 0.13.11 | MIT | npm |
| core-js-bundle | 3.50.0 | MIT | npm |
| underscore | 1.13.8 | MIT | npm |

Also redistributed from the same package: the editor's UI images and icons (`docs/images/`,
`docs/vendor/svgedit/images/`, `docs/vendor/svgedit/components/jgraduate/images/`), under the licences above.

### What we have *not* done, and what that means

- The vendored files are **unmodified copies** from the published npm package (no patching, no re-minification),
  and the exact upstream version and source are identified above, so the corresponding source for the
  LGPL/X11/Apache components is publicly available.
- **LGPL-3.0-or-later note:** the bundle includes `jspdf.plugin.svgToPdf.js` under LGPL-3.0-or-later. LGPL-3
  allows distributing a combined work if the licence text is included (it is, in
  `docs/vendor/svgedit/LICENSES/LGPL-3.0.txt` and `GPL-3.0.txt`), the library is not modified here, and users
  can replace it with a modified version. The practical caveat, stated plainly: this is a **minified bundle**,
  so anyone wanting to re-link a modified jspdf plugin should rebuild from the pinned upstream source
  (`npm pack svgedit@7.4.2` or the GitHub tag) rather than editing `iife-Editor.js`. For a production
  deployment — and certainly for Wikimedia infrastructure — ship an unminified or rebuildable build and get a
  real licence review; this file is disclosure, **not legal advice**, and we do not certify compliance.

## 2. Used in development/testing, **not** redistributed

| Tool | Licence | Role |
|---|---|---|
| Playwright | Apache-2.0 | headless browser driver for the tests (`tests/*.mjs`) |
| Chromium (Playwright build) | BSD-3-Clause and others | the browser the tests drive |
| esbuild | MIT | installed during early prototyping; no build step is required by the shipped app |
| Node.js | MIT | runtime for the test scripts and the static file server |

## 3. Wikimedia Commons content

The corpus (`corpus/`) **references** Commons files by title, URL and SHA-1 and does not redistribute them;
each file's own licence and attribution requirements apply on Commons and must be honoured by anyone who
downloads them. Downloaded copies are git-ignored on purpose (`.gitignore`), and no Commons media is committed
to this repository.

## 4. This repository's own code

`docs/*.js`, `docs/*.css`, `docs/*.html`, `tests/*.mjs`, `corpus/*` (except where noted), and the documents are
MIT — see `LICENSE`, copyright Hermes Agent / WikiButler, 2026.
