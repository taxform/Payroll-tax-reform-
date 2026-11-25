import test from 'node:test';
import assert from 'node:assert/strict';
import { unavailable } from '../netlify/lib/payrollcheck-auth.mjs';

// S7: server-side logs must carry error codes/names only. pg messages can
// echo caller-supplied input values, so error.message text must never be
// logged. These tests put a sentinel string in the message to prove it.
// The pool error handler uses the same errorCode helper as unavailable().

const SENTINEL = 'SENTINEL_DO_NOT_LOG_user_supplied_value';

function captureConsoleError() {
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => {
    logged.push(args.map((arg) => String(arg)).join(' '));
  };
  return {
    logged,
    restore() {
      console.error = originalError;
    },
  };
}

test('unavailable: logs only the error code, never the message text', async () => {
  const capture = captureConsoleError();
  try {
    const error = new Error(`password authentication failed for user "${SENTINEL}"`);
    error.code = 'ECONNREFUSED';
    const response = await unavailable(error);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'unavailable');
    assert.equal(capture.logged.length, 1);
    assert.match(capture.logged[0], /ECONNREFUSED/);
    assert.doesNotMatch(capture.logged[0], new RegExp(SENTINEL));
  } finally {
    capture.restore();
  }
});

test('unavailable: a missing-env error logs the config key name, never the message', async () => {
  const capture = captureConsoleError();
  try {
    const error = new Error(`missing env value ${SENTINEL}`);
    error.code = 'missing_env';
    error.envName = 'PAYROLLCHECK_DATABASE_URL';
    const response = await unavailable(error);
    assert.equal(response.status, 503);
    assert.ok(capture.logged.some((line) => line.includes('PAYROLLCHECK_DATABASE_URL')));
    assert.ok(!capture.logged.some((line) => line.includes(SENTINEL)));
  } finally {
    capture.restore();
  }
});
