'use strict';

const fs = require('fs');
const path = require('path');
const { assert, assertEqual, reset, summary } = require('./helpers');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

function values(source, pattern) {
  const result = new Set();
  let match;
  while ((match = pattern.exec(source))) result.add(match[1]);
  return [...result].sort();
}

function run() {
  reset(); console.log('== browser-security.test.js ==');
  const html = read('index.html');
  const app = read('app.js');
  const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  const csp = cspMatch ? cspMatch[1] : '';

  assert('Content Security Policy is declared', !!csp);
  [
    "default-src 'self'", "script-src 'self'", "connect-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'none'",
    "frame-src 'none'", "worker-src 'none'"
  ].forEach((directive) => assert('CSP includes ' + directive, csp.includes(directive)));
  assert('script policy does not allow inline code or eval',
    !/script-src[^;]*(?:'unsafe-inline'|'unsafe-eval')/.test(csp));
  assert('referrer policy prevents referrer disclosure',
    /<meta\s+name="referrer"\s+content="no-referrer"/i.test(html));
  assert('HTML contains no inline event handlers', !/\son[a-z]+\s*=/i.test(html));
  assert('generated application markup contains no inline event handlers', !/on(?:click|change|input|load|error)=/i.test(app));
  assert('HTML contains no executable javascript URLs', !/javascript\s*:/i.test(html));

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert('all script elements load a file and contain no inline body', scripts.length > 0 && scripts.every((m) => {
    const src = m[1].match(/\bsrc="([^"]+)"/i);
    return src && !/^(?:[a-z]+:)?\/\//i.test(src[1]) && !m[2].trim();
  }));
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi)].map((m) => m[1]);
  assert('all stylesheets are same-origin files',
    stylesheets.length > 0 && stylesheets.every((href) => !/^(?:[a-z]+:)?\/\//i.test(href)));
  assert('application code defines no external HTTP endpoint', !/https?:\/\//i.test(app));

  const actions = values(html + '\n' + app, /data-action="([a-z-]+)"/g);
  const handlers = values(app, /action\s*===\s*'([a-z-]+)'/g);
  assertEqual('every rendered data action has a delegated handler', actions, handlers);

  const r = summary(); console.log(`  -> ${r.pass} passed, ${r.fail} failed\n`); return r.fail === 0;
}

module.exports = { run };
if (require.main === module) process.exit(run() ? 0 : 1);
