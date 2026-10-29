'use strict';

/* Central public-site configuration. This is the ONE place to edit when the
 * project moves to its own domain or when an official award announcement
 * becomes available. It contains no clinical data and no secrets.
 *
 *  - publicUrl: absolute public base URL (https, WITH trailing slash),
 *      for example the future custom domain. Leave '' while undecided: every internal link
 *      and asset in the site is relative, so the site works unchanged on
 *      GitHub Pages, on a custom domain or on a local server. After editing
 *      it, run `node scripts/set-public-url.js` to regenerate the absolute
 *      SEO/Open Graph tags, robots.txt and sitemap.xml (crawlers need
 *      absolute URLs there and do not execute JavaScript).
 *  - awardUrl: link to an official, verifiable announcement of the SEFH/CSL
 *      award. Leave '' until one exists; the link is hidden while empty.
 */
(function (root) {
  var SITE_CONFIG = {
    publicUrl: '',
    awardUrl: '',
    productName: 'HIV Prescribing Cascade Auditor',
    softwareVersion: '1.0.0'
  };
  if (typeof module === 'object' && module.exports) module.exports = SITE_CONFIG;
  if (root) root.SITE_CONFIG = SITE_CONFIG;
}(typeof globalThis !== 'undefined' ? globalThis : this));
