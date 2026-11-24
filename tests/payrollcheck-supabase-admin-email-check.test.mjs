// Tests for supabase-admin-email-check.mjs — fully offline. The Auth Admin
// API is a stubbed fetch. No live Supabase, no real keys (the key here is a
// fake test value).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseEmailConfirmation} from '../src/payrollcheck/supabase-admin-email-check.mjs';

const PROJECT_URL = 'https://demo-project.supabase.co';
const SERVICE_ROLE_KEY = 'test-service-role-key';
const SUB = '11111111-1111-4111-8111-111111111111';

function factory(body, calls = [], ok = true) {
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    return {ok, json: async () => body};
  };
  return {
    calls,
    check: createSupabaseEmailConfirmation({projectUrl: PROJECT_URL, serviceRoleKey: SERVICE_ROLE_KEY, fetchImpl}),
  };
}

function adminUser(overrides = {}) {
  return {
    id: SUB,
    email: 'owner@example.test',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    is_anonymous: false,
    ...overrides,
  };
}

test('returns true for a confirmed, non-anonymous user', async () => {
  const {check, calls} = factory(adminUser());
  assert.equal(await check.verifyEmailConfirmed(SUB), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PROJECT_URL}/auth/v1/admin/users/${SUB}`);
  assert.equal(calls[0].options.headers.apikey, SERVICE_ROLE_KEY);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${SERVICE_ROLE_KEY}`);
});

test('accepts the wrapped {user} response shape', async () => {
  const {check} = factory({user: adminUser()});
  assert.equal(await check.verifyEmailConfirmed(SUB), true);
});

test('returns false when the email is not confirmed', async () => {
  const {check} = factory(adminUser({email_confirmed_at: null}));
  assert.equal(await check.verifyEmailConfirmed(SUB), false);
  const {check: check2} = factory(adminUser({email_confirmed_at: ''}));
  assert.equal(await check2.verifyEmailConfirmed(SUB), false);
  const {check: check3} = factory({id: SUB, email: 'owner@example.test', is_anonymous: false});
  assert.equal(await check3.verifyEmailConfirmed(SUB), false);
});

test('returns false for anonymous users and id mismatches', async () => {
  const {check} = factory(adminUser({is_anonymous: true}));
  assert.equal(await check.verifyEmailConfirmed(SUB), false);
  const {check: check2} = factory(adminUser({id: '22222222-2222-4222-8222-222222222222'}));
  assert.equal(await check2.verifyEmailConfirmed(SUB), false);
});

test('fails closed on fetch errors, non-OK responses, and bad bodies', async () => {
  const throwing = async () => {
    throw new Error('offline');
  };
  const check = createSupabaseEmailConfirmation({
    projectUrl: PROJECT_URL,
    serviceRoleKey: SERVICE_ROLE_KEY,
    fetchImpl: throwing,
  });
  assert.equal(await check.verifyEmailConfirmed(SUB), false);
  const {check: check2} = factory(adminUser(), [], false);
  assert.equal(await check2.verifyEmailConfirmed(SUB), false);
  const {check: check3} = factory(null);
  assert.equal(await check3.verifyEmailConfirmed(SUB), false);
  const {check: check4} = factory('not-an-object');
  assert.equal(await check4.verifyEmailConfirmed(SUB), false);
});

test('returns false without calling fetch for a bad sub', async () => {
  const calls = [];
  const {check} = factory(adminUser(), calls);
  assert.equal(await check.verifyEmailConfirmed('not-a-uuid'), false);
  assert.equal(await check.verifyEmailConfirmed(null), false);
  assert.equal(calls.length, 0);
});

test('rejects a bad factory config', () => {
  assert.throws(
    () => createSupabaseEmailConfirmation({projectUrl: 'http://demo.supabase.co', serviceRoleKey: SERVICE_ROLE_KEY}),
    TypeError,
  );
  assert.throws(
    () => createSupabaseEmailConfirmation({projectUrl: PROJECT_URL, serviceRoleKey: ''}),
    TypeError,
  );
  assert.throws(
    () =>
      createSupabaseEmailConfirmation({projectUrl: PROJECT_URL, serviceRoleKey: SERVICE_ROLE_KEY, fetchImpl: null}),
    TypeError,
  );
});
