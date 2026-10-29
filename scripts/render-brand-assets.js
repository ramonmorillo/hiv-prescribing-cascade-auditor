#!/usr/bin/env node
'use strict';
/* Regenerates the raster brand assets from their vector/HTML sources:
 *   assets/brand/og-image.png        (1200x630, from scripts/brand/og-image.html)
 *   assets/brand/apple-touch-icon.png (180x180, from assets/brand/mark.svg)
 *   assets/brand/icon-512.png         (512x512, from assets/brand/mark.svg)
 * Maintenance tool only (requires Playwright + Chromium); the site itself
 * has no build step and no runtime dependency on it. */
const path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const url = (rel) => 'file://' + path.join(root, rel);

(async () => {
  const browser = await chromium.launch();
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await og.goto(url('scripts/brand/og-image.html'));
  await og.evaluate(() => document.fonts.ready);
  await og.screenshot({ path: path.join(root, 'assets/brand/og-image.png') });
  /* App icons are full-bleed squares (platforms apply their own mask), so
     the mark is rendered from mark.svg with its corner radius removed. */
  const markSvg = require('fs').readFileSync(path.join(root, 'assets/brand/mark.svg'), 'utf8')
    .replace(/<title[^>]*>[^<]*<\/title>/, '').replace('rx="10"', 'rx="0"');
  for (const [size, file] of [[180, 'apple-touch-icon.png'], [512, 'icon-512.png']]) {
    const p = await browser.newPage({ viewport: { width: size, height: size } });
    await p.setContent('<html><body style="margin:0">' +
      markSvg.replace('<svg ', '<svg width="' + size + '" height="' + size + '" style="display:block" ') + '</body></html>');
    await p.screenshot({ path: path.join(root, 'assets/brand', file) });
  }
  await browser.close();
  console.log('brand assets rendered');
})();
