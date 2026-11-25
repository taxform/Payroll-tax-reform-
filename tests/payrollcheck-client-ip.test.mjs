import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from '../netlify/lib/payrollcheck-auth.mjs';

// S1: clientIp must use the rightmost X-Forwarded-For entry (the one the
// edge appended) or Netlify's client-ip header. The leftmost entry is
// client-supplied and forgeable, so it must never select the rate-limit
// bucket. Requests with no forwarding headers share the 'unknown' bucket.

function requestWith(headers) {
  return new Request('https://example.com/payrollcheck/api/mfa/verify', { headers });
}

test('clientIp: the client-ip header wins over X-Forwarded-For', () => {
  const req = requestWith({
    'client-ip': '203.0.113.7',
    'x-forwarded-for': '198.51.100.1, 192.0.2.9',
  });
  assert.equal(clientIp(req), '203.0.113.7');
});

test('clientIp: without client-ip, the rightmost X-Forwarded-For entry wins', () => {
  const req = requestWith({
    'x-forwarded-for': '198.51.100.1, 192.0.2.9, 203.0.113.7',
  });
  assert.equal(clientIp(req), '203.0.113.7');
});

test('clientIp: a forged leftmost entry does not select the bucket', () => {
  const req = requestWith({
    'x-forwarded-for': '198.51.100.1, 203.0.113.7',
  });
  assert.notEqual(clientIp(req), '198.51.100.1');
  assert.equal(clientIp(req), '203.0.113.7');
});

test('clientIp: a single X-Forwarded-For entry is returned', () => {
  const req = requestWith({ 'x-forwarded-for': '203.0.113.7' });
  assert.equal(clientIp(req), '203.0.113.7');
});

test('clientIp: surrounding whitespace is trimmed', () => {
  const req = requestWith({
    'x-forwarded-for': ' 198.51.100.1 ,  203.0.113.7 ',
  });
  assert.equal(clientIp(req), '203.0.113.7');
  const edge = requestWith({ 'client-ip': '  203.0.113.7  ' });
  assert.equal(clientIp(edge), '203.0.113.7');
});

test('clientIp: no forwarding headers share the unknown bucket', () => {
  assert.equal(clientIp(requestWith({})), 'unknown');
  assert.equal(clientIp(requestWith({ 'x-forwarded-for': ' ,  ' })), 'unknown');
  assert.equal(clientIp(requestWith({ 'client-ip': '   ' })), 'unknown');
});
