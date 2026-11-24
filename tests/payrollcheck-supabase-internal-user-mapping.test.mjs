// Tests for supabase-internal-user-mapping.mjs — fully offline. The database
// is a stubbed query function. No live Supabase, no real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseInternalUserMapping} from '../src/payrollcheck/supabase-internal-user-mapping.mjs';

const SUB = '11111111-1111-4111-8111-111111111111';

function mappingFor(rows, calls = []) {
  const query = async (sql, values) => {
    calls.push({sql, values});
    return {rows};
  };
  return {calls, mapping: createSupabaseInternalUserMapping({query})};
}

test('resolves the subject_id for a user with one active membership', async () => {
  const {mapping, calls} = mappingFor([{subject_id: 'owner1'}]);
  assert.equal(await mapping.resolveInternalUserId(SUB), 'owner1');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /auth_user_id = \$1::uuid AND active = true/);
  assert.deepEqual(calls[0].values, [SUB]);
});

test('returns null for unknown users and inconsistent data', async () => {
  const {mapping} = mappingFor([]);
  assert.equal(await mapping.resolveInternalUserId(SUB), null);
  const {mapping: mapping2} = mappingFor([{subject_id: 'owner1'}, {subject_id: 'owner2'}]);
  assert.equal(await mapping2.resolveInternalUserId(SUB), null);
});

test('returns null when the subject_id does not match the internal-id shape', async () => {
  const {mapping} = mappingFor([{subject_id: 'owner@example.com'}]);
  assert.equal(await mapping.resolveInternalUserId(SUB), null);
  const {mapping: mapping2} = mappingFor([{subject_id: 'x'.repeat(65)}]);
  assert.equal(await mapping2.resolveInternalUserId(SUB), null);
  const {mapping: mapping3} = mappingFor([{subject_id: null}]);
  assert.equal(await mapping3.resolveInternalUserId(SUB), null);
});

test('fails closed when the query throws', async () => {
  const query = async () => {
    throw new Error('database down');
  };
  const mapping = createSupabaseInternalUserMapping({query});
  assert.equal(await mapping.resolveInternalUserId(SUB), null);
});

test('returns null without querying for a bad sub', async () => {
  const calls = [];
  const {mapping} = mappingFor([{subject_id: 'owner1'}], calls);
  assert.equal(await mapping.resolveInternalUserId('not-a-uuid'), null);
  assert.equal(calls.length, 0);
});

test('rejects a bad factory config', () => {
  assert.throws(() => createSupabaseInternalUserMapping({}), TypeError);
  assert.throws(() => createSupabaseInternalUserMapping(), TypeError);
});
