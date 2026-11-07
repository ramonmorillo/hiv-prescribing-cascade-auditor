#!/usr/bin/env node
'use strict';
/* Applies site.config.js `publicUrl` to the files that need an ABSOLUTE
 * URL (search engines and social networks do not execute JavaScript):
 *   - index.html: the block between <!-- public-url:start/end -->
 *     (canonical, og:url, og:image, twitter:image)
 *   - robots.txt and sitemap.xml
 * Everything else in the site uses relative paths and needs no change.
 *
 * Usage:
 *   node scripts/set-public-url.js            # uses site.config.js
 *   node scripts/set-public-url.js --check    # exits 1 if files are stale
 *
 * It never touches DNS, CNAME or GitHub Pages settings. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const config = require(path.join(root, 'site.config.js'));
const check = process.argv.includes('--check');

function normalizeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) {
    throw new Error('publicUrl must be an absolute https:// URL (got: ' + url + ')');
  }
  return url.endsWith('/') ? url : url + '/';
}

function escAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function headBlock(base) {
  const img = base ? base + 'assets/brand/og-image.png' : 'assets/brand/og-image.png';
  const lines = [];
  if (base) {
    lines.push('<link rel="canonical" href="' + escAttr(base) + '">');
    lines.push('<meta property="og:url" content="' + escAttr(base) + '">');
  }
  lines.push('<meta property="og:image" content="' + escAttr(img) + '">');
  lines.push('<meta name="twitter:image" content="' + escAttr(img) + '">');
  return lines.map((l) => '  ' + l).join('\n');
}

function robots(base) {
  return 'User-agent: *\nAllow: /\n' + (base ? '\nSitemap: ' + base + 'sitemap.xml\n' : '');
}

function sitemap(base) {
  if (!base) return null;
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    '  <url><loc>' + base + '</loc></url>\n' +
    '</urlset>\n';
}

const base = normalizeUrl(config.publicUrl);
const outputs = [];

const indexPath = path.join(root, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const pattern = /( *<!-- public-url:start -->\n)[\s\S]*?(\n *<!-- public-url:end -->)/;
if (!pattern.test(html)) throw new Error('index.html is missing the public-url markers');
outputs.push([indexPath, html.replace(pattern, (m, a, b) => a + headBlock(base) + b)]);
outputs.push([path.join(root, 'robots.txt'), robots(base)]);
const sm = sitemap(base);
const smPath = path.join(root, 'sitemap.xml');

let stale = false;
outputs.forEach(([file, content]) => {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current !== content) {
    stale = true;
    if (!check) fs.writeFileSync(file, content);
  }
});
if (sm === null && fs.existsSync(smPath)) { stale = true; if (!check) fs.unlinkSync(smPath); }
if (sm !== null && (!fs.existsSync(smPath) || fs.readFileSync(smPath, 'utf8') !== sm)) { stale = true; if (!check) fs.writeFileSync(smPath, sm); }

if (check) {
  console.log(stale ? 'Public-URL files are out of date: run node scripts/set-public-url.js' : 'Public-URL files are up to date.');
  process.exit(stale ? 1 : 0);
}
console.log(base ? 'Applied public URL ' + base : 'No public URL configured: relative social image, no canonical, no sitemap.');
