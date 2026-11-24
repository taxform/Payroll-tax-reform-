import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollcheckRequestScope } from '../src/payrollcheck/payrollcheck-request-scope.mjs';

function makePool({ connectFails = false, beginFails = false, commitFails = false } = {}) {
  const statements = [];
  const released = [];
  const client = {
    query: async (sql) => {
      statements.push(sql);
      if (beginFails && sql === 'BEGIN') throw new Error('begin failed');
      if (commitFails && sql === 'COMMIT') throw new Error('commit failed');
      return { rows: [] };
    },
    release: () => {
      released.push(true);
    },
  };
  return {
    statements,
    released,
    pool: {
      connect: async () => {
        if (connectFails) throw new Error('connect failed');
        return client;
      },
    },
  };
}

test('factory requires a pool', () => {
  assert.throws(() => createPayrollcheckRequestScope({}), /pool_required/);
  assert.throws(() => createPayrollcheckRequestScope({ pool: {} }), /pool_required/);
});

test('commit path: BEGIN, callback, COMMIT, release — in order', async () => {
  const { pool, statements, released } = makePool();
  const scope = createPayrollcheckRequestScope({ pool });
  const result = await scope.withTransaction(async ({ query }) => {
    await query('SELECT 1');
    return 'done';
  });
  assert.equal(result, 'done');
  assert.deepEqual(statements, ['BEGIN', 'SELECT 1', 'COMMIT']);
  assert.equal(released.length, 1);
});

test('throw path: BEGIN, ROLLBACK, release, and the original error propagates', async () => {
  const { pool, statements, released } = makePool();
  const scope = createPayrollcheckRequestScope({ pool });
  await assert.rejects(
    () =>
      scope.withTransaction(async () => {
        throw new Error('handler blew up');
      }),
    /handler blew up/,
  );
  assert.deepEqual(statements, ['BEGIN', 'ROLLBACK']);
  assert.equal(released.length, 1);
});

test('a handled denial commits: the callback returning a denial is not a throw', async () => {
  // COMMIT-ON-DENY: the step-8 handler returns denials as values, so the
  // audit row it just wrote must persist. Only a throw rolls back.
  const { pool, statements, released } = makePool();
  const scope = createPayrollcheckRequestScope({ pool });
  const result = await scope.withTransaction(async ({ query }) => {
    await query("INSERT INTO payrollcheck.access_audit (...) VALUES (...)");
    return { status: 404, reason: 'not_found' };
  });
  assert.deepEqual(result, { status: 404, reason: 'not_found' });
  assert.deepEqual(statements, [
    'BEGIN',
    "INSERT INTO payrollcheck.access_audit (...) VALUES (...)",
    'COMMIT',
  ]);
  assert.equal(released.length, 1);
});

test('no isolation statement is ever sent — READ COMMITTED is the default', async () => {
  const { pool, statements } = makePool();
  const scope = createPayrollcheckRequestScope({ pool });
  await scope.withTransaction(async ({ query }) => {
    await query('SELECT 1');
    await query('SELECT 2');
  });
  for (const sql of statements) {
    assert.equal(/isolation/i.test(sql), false, `unexpected isolation statement: ${sql}`);
    assert.equal(/SET TRANSACTION/i.test(sql), false, `unexpected SET TRANSACTION: ${sql}`);
  }
});

test('connect failure propagates with nothing to release', async () => {
  const { pool, statements, released } = makePool({ connectFails: true });
  const scope = createPayrollcheckRequestScope({ pool });
  await assert.rejects(() => scope.withTransaction(async () => {}), /connect failed/);
  assert.deepEqual(statements, []);
  assert.equal(released.length, 0);
});

test('a failing COMMIT still releases the client and propagates', async () => {
  const { pool, statements, released } = makePool({ commitFails: true });
  const scope = createPayrollcheckRequestScope({ pool });
  await assert.rejects(
    () => scope.withTransaction(async ({ query }) => query('SELECT 1')),
    /commit failed/,
  );
  // COMMIT threw, so the catch issued ROLLBACK; the client is released.
  assert.deepEqual(statements, ['BEGIN', 'SELECT 1', 'COMMIT', 'ROLLBACK']);
  assert.equal(released.length, 1);
});

test('withTransaction requires a callback', async () => {
  const { pool } = makePool();
  const scope = createPayrollcheckRequestScope({ pool });
  await assert.rejects(() => scope.withTransaction(), /transaction_fn_required/);
});
