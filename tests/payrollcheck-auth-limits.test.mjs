import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthLimits } from '../src/payrollcheck/payrollcheck-auth-limits.mjs';

function makeStore({ failGet = false, failSet = false, failDelete = false } = {}) {
  const data = new Map();
  const incrementAttempts = async ({ key, now, maxFailedAttempts, lockoutMs }) => {
    if (failGet || failSet) throw new Error('store down');
    let record = data.has(key) ? data.get(key) : null;
    if (record?.lockedUntil && now >= record.lockedUntil) record = null;
    const count = record ? record.count + 1 : 1;
    const next = {
      count,
      firstFailureAt: record ? record.firstFailureAt : now,
      lockedUntil: count >= maxFailedAttempts ? now + lockoutMs : 0,
    };
    data.set(key, next);
    return next;
  };
  const incrementRateLimit = async ({ key, now, windowMs, maxRequests }) => {
    if (failGet || failSet) throw new Error('store down');
    let record = data.has(key) ? data.get(key) : null;
    if (!record || now - record.windowStart >= windowMs) {
      record = { count: 1, windowStart: now };
    } else {
      record = { count: record.count + 1, windowStart: record.windowStart };
    }
    data.set(key, record);
    return record;
  };
  return {
    data,
    async get(key) {
      if (failGet) throw new Error('store down');
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, value) {
      if (failSet) throw new Error('store down');
      data.set(key, value);
    },
    async delete(key) {
      if (failDelete) throw new Error('store down');
      data.delete(key);
    },
    incrementAttempts,
    incrementRateLimit,
  };
}

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

test('fresh identifier is allowed with all attempts remaining', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore(), now: clock.now });
  const result = await limits.checkLoginAllowed({ identifier: 'User@Example.com', ip: '203.0.113.7' });
  assert.equal(result.allowed, true);
  assert.equal(result.remainingAttempts, 5);
});

test('identifier is normalized: case and whitespace do not create separate records', async () => {
  const clock = makeClock();
  const store = makeStore();
  const limits = createAuthLimits({ store, now: clock.now });
  await limits.recordFailedLogin({ identifier: '  User@Example.com ' });
  await limits.recordFailedLogin({ identifier: 'user@example.com' });
  const result = await limits.checkLoginAllowed({ identifier: 'USER@EXAMPLE.COM', ip: '203.0.113.7' });
  assert.equal(result.remainingAttempts, 3);
});

test('two createAuthLimits instances sharing one store see the same counts', async () => {
  const clock = makeClock();
  const store = makeStore();
  const first = createAuthLimits({ store, now: clock.now });
  const second = createAuthLimits({ store, now: clock.now });
  await first.recordFailedLogin({ identifier: 'shared@example.com' });
  await second.recordFailedLogin({ identifier: 'shared@example.com' });
  const result = await first.checkLoginAllowed({
    identifier: 'shared@example.com',
    ip: '203.0.113.7',
  });
  assert.equal(result.remainingAttempts, 3);
});

test('concurrent atomic increments lose no counts', async () => {
  const clock = makeClock();
  const store = makeStore();
  const limits = createAuthLimits({ store, now: clock.now });
  await Promise.all(
    Array.from({length: 20}, () =>
      limits.recordFailedLogin({ identifier: 'concurrent@example.com' }),
    ),
  );
  const record = await store.get('auth:attempts:concurrent@example.com');
  assert.equal(record.count, 20);
});

test('fifth consecutive failure locks the account for 15 minutes', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore(), now: clock.now });
  for (let i = 0; i < 4; i += 1) {
    const r = await limits.recordFailedLogin({ identifier: 'a@example.com' });
    assert.equal(r.lockedOut, false);
    assert.equal(r.remainingAttempts, 4 - i);
  }
  const fifth = await limits.recordFailedLogin({ identifier: 'a@example.com' });
  assert.equal(fifth.lockedOut, true);
  assert.equal(fifth.retryAfterMs, 15 * 60 * 1000);

  const denied = await limits.checkLoginAllowed({ identifier: 'a@example.com', ip: '203.0.113.7' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'locked_out');
  assert.equal(denied.retryAfterMs, 15 * 60 * 1000);
});

test('lock expires after 15 minutes and the count resets', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore(), now: clock.now });
  for (let i = 0; i < 5; i += 1) {
    await limits.recordFailedLogin({ identifier: 'a@example.com' });
  }
  clock.advance(15 * 60 * 1000 + 1);
  const allowed = await limits.checkLoginAllowed({ identifier: 'a@example.com', ip: '203.0.113.7' });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.remainingAttempts, 5);
  const next = await limits.recordFailedLogin({ identifier: 'a@example.com' });
  assert.equal(next.remainingAttempts, 4);
});

test('successful login clears the failure count', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore(), now: clock.now });
  await limits.recordFailedLogin({ identifier: 'a@example.com' });
  await limits.recordFailedLogin({ identifier: 'a@example.com' });
  await limits.recordFailedLogin({ identifier: 'a@example.com' });
  await limits.recordFailedLogin({ identifier: 'a@example.com' });
  const cleared = await limits.recordSuccessfulLogin({ identifier: 'a@example.com' });
  assert.equal(cleared.cleared, true);
  const result = await limits.checkLoginAllowed({ identifier: 'a@example.com', ip: '203.0.113.7' });
  assert.equal(result.remainingAttempts, 5);
});

test('lockout check fails closed when the store cannot be read', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore({ failGet: true }), now: clock.now });
  const result = await limits.checkLoginAllowed({ identifier: 'a@example.com', ip: '203.0.113.7' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'unavailable');
});

test('rate limit allows 60 requests per minute per IP, then denies the 61st', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore(), now: clock.now });
  for (let i = 0; i < 60; i += 1) {
    const r = await limits.checkRateLimit({ key: '203.0.113.7' });
    assert.equal(r.allowed, true);
  }
  const denied = await limits.checkRateLimit({ key: '203.0.113.7' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.resetMs, 60 * 1000);
});

test('rate limit window rolls over after one minute', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore(), now: clock.now });
  for (let i = 0; i < 60; i += 1) {
    await limits.checkRateLimit({ key: '203.0.113.7' });
  }
  clock.advance(60 * 1000 + 1);
  const r = await limits.checkRateLimit({ key: '203.0.113.7' });
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 59);
});

test('rate limit fails open when the store cannot be read', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore({ failGet: true }), now: clock.now });
  const result = await limits.checkRateLimit({ key: '203.0.113.7' });
  assert.equal(result.allowed, true);
  assert.equal(result.degraded, true);
});

test('rate limiting is per IP: a second IP gets its own window', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore(), now: clock.now });
  for (let i = 0; i < 60; i += 1) {
    await limits.checkRateLimit({ key: '203.0.113.7' });
  }
  const other = await limits.checkRateLimit({ key: '198.51.100.9' });
  assert.equal(other.allowed, true);
  assert.equal(other.remaining, 59);
});

test('resetLockout clears a lock early', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore(), now: clock.now });
  for (let i = 0; i < 5; i += 1) {
    await limits.recordFailedLogin({ identifier: 'a@example.com' });
  }
  const reset = await limits.resetLockout({ identifier: 'a@example.com' });
  assert.equal(reset.cleared, true);
  const result = await limits.checkLoginAllowed({ identifier: 'a@example.com', ip: '203.0.113.7' });
  assert.equal(result.allowed, true);
  assert.equal(result.remainingAttempts, 5);
});

test('recordFailedLogin reports storeError instead of throwing when the store is down', async () => {
  const clock = makeClock();
  const limits = createAuthLimits({ store: makeStore({ failGet: true }), now: clock.now });
  const result = await limits.recordFailedLogin({ identifier: 'a@example.com' });
  assert.equal(result.recorded, false);
  assert.equal(result.storeError, true);
});

test('invalid identifier and ip throw before any store access', async () => {
  const clock = makeClock();
  const store = makeStore();
  const limits = createAuthLimits({ store, now: clock.now });
  await assert.rejects(() => limits.checkLoginAllowed({ identifier: '   ', ip: '203.0.113.7' }));
  await assert.rejects(() => limits.checkLoginAllowed({ identifier: 'a@example.com', ip: '' }));
  await assert.rejects(() => limits.recordFailedLogin({ identifier: null }));
  assert.equal(store.data.size, 0);
});

test('createAuthLimits rejects a store without get/set/delete', () => {
  assert.throws(() => createAuthLimits({ store: {} }), /store with get\/set\/delete/);
  assert.throws(() => createAuthLimits({}), /store with get\/set\/delete/);
});
