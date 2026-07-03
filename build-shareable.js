#!/usr/bin/env node
/**
 * RangeRover shareable-build generator
 * ------------------------------------
 * Produces dist/RangeRover.html — a fully self-contained, offline-capable
 * single file (UI + engine + embedded Plotly) built from the multi-file
 * source of truth (index.html + app.js).
 *
 * Run:  node build-shareable.js   (or: npm run build)
 *
 * IMPORTANT: run `npm test` first — the QC harness (incl. the three-build
 * parity audit, section T) is the release gate for this artifact.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PLOTLY_TAG = '<script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>';
const APP_TAG = '<script src="app.js"></script>';

function inlineSafe(js) {
  // Prevent premature </script> termination when embedding JS in HTML
  return js.replace(/<\/script/gi, '<\\/script');
}

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const plotlyJs = fs.readFileSync(path.join(ROOT, 'vendor', 'plotly-2.32.0.min.js'), 'utf8');

if (!html.includes(PLOTLY_TAG)) { console.error('FATAL: Plotly CDN tag not found in index.html'); process.exit(1); }
if (!html.includes(APP_TAG)) { console.error('FATAL: app.js tag not found in index.html'); process.exit(1); }

const stamp = new Date().toISOString().slice(0, 10);
// NOTE: function replacements are mandatory here — the embedded JS contains `$&`/`$'`
// sequences that String.replace would otherwise interpret as substitution patterns
// and silently corrupt the payload.
html = html.replace(PLOTLY_TAG,
  () => `<!-- Plotly v2.32.0 embedded for offline use (built ${stamp}) -->\n<script>\n${inlineSafe(plotlyJs)}\n</script>`);
html = html.replace(APP_TAG,
  () => `<!-- RangeRover engine (app.js) embedded (built ${stamp}) -->\n<script>\n${inlineSafe(appJs)}\n</script>`);

// Embed the hotlinked logo as a data URI (offline + no third-party request)
const LOGO_URL = 'https://1000logos.net/wp-content/uploads/2017/06/Shell-Logo.png';
const logoPath = path.join(ROOT, 'vendor', 'shell-logo.png');
if (html.includes(LOGO_URL) && fs.existsSync(logoPath)) {
  const dataUri = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64');
  html = html.split(LOGO_URL).join(dataUri);
}

// Release gate: no external http(s) script/img/link resources may remain in the markup.
// (Scan only outside <script> bodies — the embedded Plotly source contains CDN
// strings in its own code, which are not network references.)
const markupOnly = html.replace(/<script>[\s\S]*?<\/script>/g, '<script></script>');
const leftover = markupOnly.match(/(?:src|href)="https?:\/\/[^"]+"/g);
if (leftover) {
  console.error('FATAL: external resources remain in shareable build:\n  ' + leftover.join('\n  '));
  process.exit(1);
}

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'RangeRover.html');
fs.writeFileSync(outFile, html);

const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
console.log(`Built ${outFile} (${mb} MB) — self-contained, no network required.`);
