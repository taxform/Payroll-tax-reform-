import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// S4: a strict Content-Security-Policy must be served on /payrollcheck/*.
// The login page loads no third-party scripts and uses only an inline
// script and inline styles, so the policy allows the page's own inline
// script/style and nothing from other origins. The same CSP is declared
// in both public/_headers and netlify.toml so whichever file Netlify
// applies, the value is identical. The existing global security headers
// (HSTS, nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy)
// must stay in place for the login path.

const headersText = readFileSync(new URL('../public/_headers', import.meta.url), 'utf-8');
const tomlText = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf-8');

function cspFromHeadersFile(text) {
  const blocks = {};
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('/')) {
      current = line.trim();
      blocks[current] = {};
    } else if (current && line.includes(':')) {
      const [name, ...rest] = line.split(':');
      blocks[current][name.trim()] = rest.join(':').trim();
    }
  }
  return blocks;
}

function cspFromToml(text) {
  const blocks = {};
  let current = null;
  for (const line of text.split('\n')) {
    const forMatch = /^\s*for\s*=\s*"([^"]+)"/.exec(line);
    if (forMatch) {
      current = forMatch[1];
      blocks[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = /^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"/.exec(line);
      if (kvMatch) blocks[current][kvMatch[1]] = kvMatch[2];
    }
  }
  return blocks;
}

const EXPECTED_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
];

const GLOBAL_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

test('CSP: /payrollcheck/* serves the strict policy in both header files', () => {
  const fromHeaders = cspFromHeadersFile(headersText)['/payrollcheck/*'];
  const fromToml = cspFromToml(tomlText)['/payrollcheck/*'];
  assert.ok(fromHeaders, 'public/_headers has a /payrollcheck/* rule');
  assert.ok(fromToml, 'netlify.toml has a /payrollcheck/* rule');
  const cspHeaders = fromHeaders['Content-Security-Policy'];
  const cspToml = fromToml['Content-Security-Policy'];
  assert.ok(cspHeaders, 'public/_headers /payrollcheck/* sets Content-Security-Policy');
  assert.ok(cspToml, 'netlify.toml /payrollcheck/* sets Content-Security-Policy');
  assert.equal(cspHeaders, cspToml, 'the CSP is identical in both files');
  for (const directive of EXPECTED_DIRECTIVES) {
    assert.ok(cspHeaders.includes(directive), `CSP contains ${directive}`);
  }
});

test('CSP: the policy allows nothing from other origins', () => {
  const csp = cspFromHeadersFile(headersText)['/payrollcheck/*']['Content-Security-Policy'];
  const sources = csp.split(';').flatMap((d) => d.trim().split(/\s+/).slice(1));
  for (const source of sources) {
    assert.notEqual(source, '*', 'no wildcard source');
    assert.ok(!source.startsWith('http://') && !source.startsWith('https://'), `no remote origin: ${source}`);
    assert.ok(!source.endsWith(':') || source === 'data:', `no scheme source other than data:: ${source}`);
  }
  assert.ok(!csp.includes('https:'), 'no https: scheme source');
});

test('CSP: the existing global security headers still cover the login path', () => {
  for (const [file, blocks] of [['public/_headers', cspFromHeadersFile(headersText)], ['netlify.toml', cspFromToml(tomlText)]]) {
    const global = blocks['/*'];
    assert.ok(global, `${file} still has a /* rule`);
    for (const [name, value] of Object.entries(GLOBAL_HEADERS)) {
      assert.equal(global[name], value, `${file} /* keeps ${name}`);
    }
  }
});
