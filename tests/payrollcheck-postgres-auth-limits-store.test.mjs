import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthLimits} from '../src/payrollcheck/payrollcheck-auth-limits.mjs';
import {createPostgresAuthLimitsStore} from '../src/payrollcheck/postgres-auth-limits-store.mjs';

function sharedStoreQuery(initial = new Map()) {
  const data = initial;
  const calls = [];
  const query = async (sql, values = []) => {
    calls.push({sql, values});
    if (sql.includes('SELECT value')) {
      return {rows: data.has(values[0]) ? [{value: data.get(values[0])}] : []};
    }
    if (sql.includes('INSERT INTO payrollcheck.auth_limits') &&
        sql.includes('ON CONFLICT (key)') &&
        !sql.includes('RETURNING value')) {
      data.set(values[0], JSON.parse(values[1]));
      return {rows: []};
    }
    if (sql.includes('RETURNING value') && sql.includes("'count'")) {
      const storeKey = values[0];
      const now = values[1];
      if (sql.includes('firstFailureAt')) {
        let record = data.has(storeKey) ? data.get(storeKey) : null;
        if (record?.lockedUntil && now >= record.lockedUntil) record = null;
        const count = record ? record.count + 1 : 1;
        record = {
          count,
          firstFailureAt: record ? record.firstFailureAt : now,
          lockedUntil: count >= values[2] ? now + values[3] : 0,
        };
        data.set(storeKey, record);
        return {rows: [{value: record}]};
      }
      let record = data.has(storeKey) ? data.get(storeKey) : null;
      if (!record || now - record.windowStart >= values[2]) {
        record = {count: 1, windowStart: now};
      } else {
        record = {count: record.count + 1, windowStart: record.windowStart};
      }
      data.set(storeKey, record);
      return {rows: [{value: record}]};
    }
    if (sql.startsWith('DELETE FROM payrollcheck.auth_limits')) {
      data.delete(values[0]);
      return {rows: []};
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return {data, calls, query};
}

test('two auth-limit instances share a Postgres store and concurrent increments lose no counts', async () => {
  const {data, calls, query} = sharedStoreQuery();
  const store = createPostgresAuthLimitsStore({query});
  const first = createAuthLimits({
    store,
    now: () => 1_000_000,
  });
  const second = createAuthLimits({
    store,
    now: () => 1_000_000,
  });
  await Promise.all(
    Array.from({length: 20}, () =>
      first.recordFailedLogin({identifier: 'shared@example.com'}),
    ),
  );
  await second.recordFailedLogin({identifier: 'shared@example.com'});
  assert.equal(data.get('auth:attempts:shared@example.com').count, 21);
  const incrementCalls = calls.filter((call) =>
    call.sql.includes('RETURNING value'),
  );
  assert.equal(incrementCalls.length, 21);
  for (const call of incrementCalls) {
    assert.match(call.sql, /INSERT INTO payrollcheck\.auth_limits/);
    assert.match(call.sql, /ON CONFLICT \(key\) DO UPDATE/);
  }
});

test('Postgres auth-limit store get, set, and delete', async () => {
  const {data, query} = sharedStoreQuery();
  const store = createPostgresAuthLimitsStore({query});
  await store.set('auth:test:key', {count: 3});
  assert.deepEqual(await store.get('auth:test:key'), {count: 3});
  await store.delete('auth:test:key');
  assert.equal(await store.get('auth:test:key'), null);
  assert.equal(data.size, 0);
});
