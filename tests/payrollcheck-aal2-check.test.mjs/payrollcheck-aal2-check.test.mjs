import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequireAal2 } from '../src/payrollcheck/supabase-aal2-check.mjs';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_USER_ID = '99999999-8888-7777-6666-555555555555';

function stubVerifier(claimsOrError) {
  return async () => {
    if (claimsOrError instanceof Error) throw claimsOrError;
    return claimsOrError;
  };
}

test('aal2 token with matching sub returns true', async () => {
  const requireAal2 = createRequireAal2({
    verifyAccessToken: stubVerifier({ aal: 'aal2', sub: USER_ID }),
  });
  assert.equal(await requireAal2('token', USER_ID), true);
});

test('aal1 token returns false', async () => {
  const requireAal2 = createRequireAal2({
    verifyAccessToken: stubVerifier({ aal: 'aal1', sub: USER_ID }),
  });
  assert.equal(await requireAal2('token', USER_ID), false);
});

test('missing aal claim returns false', async () => {
  const requireAal2 = createRequireAal2({
    verifyAccessToken: stubVerifier({ sub: USER_ID }),
  });
  assert.equal(await requireAal2('token', USER_ID), false);
});

test('sub mismatch returns false even with aal2', async () => {
  const requireAal2 = createRequireAal2({
    verifyAccessToken: stubVerifier({ aal: 'aal2', sub: OTHER_USER_ID }),
  });
  assert.equal(await requireAal2('token', USER_ID), false);
});

test('verifier failure fails closed with false, never throws', async () => {
  const requireAal2 = createRequireAal2({
    verifyAccessToken: stubVerifier(new Error('invalid_signature')),
  });
  assert.equal(await requireAal2('token', USER_ID), false);
});

test('invalid inputs return false', async () => {
  const requireAal2 = createRequireAal2({
    verifyAccessToken: stubVerifier({ aal: 'aal2', sub: USER_ID }),
  });
  assert.equal(await requireAal2('', USER_ID), false);
  assert.equal(await requireAal2(null, USER_ID), false);
  assert.equal(await requireAal2('token', ''), false);
  assert.equal(await requireAal2('token', null), false);
});

test('createRequireAal2 rejects a missing verifier', () => {
  assert.throws(() => createRequireAal2({}), /verifyAccessToken/);
  assert.throws(() => createRequireAal2(), /verifyAccessToken/);
});
