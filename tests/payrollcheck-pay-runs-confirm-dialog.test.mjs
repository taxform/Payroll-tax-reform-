import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync('public/payrollcheck/app.html', 'utf8');
const script = app.match(/<script>([\s\S]*)<\/script>/)[1];

// The automated browser auto-dismisses window.confirm() and it returns
// false without showing a dialog, so the harness stubs confirm() that way:
// a Delete/Finalize that still relied on it returns before any request.
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  click() {
    for (const listener of this.listeners.click || []) listener({ preventDefault() {} });
  }
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function loadApp() {
  const elements = new Map();
  const fetchCalls = [];
  let confirmCalls = 0;
  // The in-page dialog is hidden in the markup; this stub DOM does not
  // parse HTML, so seed it in its initial hidden state.
  const dialog = new FakeElement('div');
  dialog.id = 'pay-run-confirm-dialog';
  dialog.hidden = true;
  elements.set('pay-run-confirm-dialog', dialog);
  const tenantSelect = new FakeElement('select');
  tenantSelect.id = 'tenant-select';
  tenantSelect.value = 'tenant-1';
  elements.set('tenant-select', tenantSelect);

  let payRuns = [{
    payRunId: 'pay-run-1',
    status: 'draft',
    payPeriodStart: '2026-11-02',
    payPeriodEnd: '2026-11-08',
    payDate: '2026-11-13',
    totals: { gross: 1000 },
  }];

  const documentStub = {
    getElementById(id) {
      if (!elements.has(id)) {
        const element = new FakeElement('div');
        element.id = id;
        elements.set(id, element);
      }
      return elements.get(id);
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };

  async function fetchStub(path, options) {
    const body = JSON.parse(options.body || '{}');
    fetchCalls.push({ path, body });
    let data;
    if (path === '/payrollcheck/api/dashboard') {
      data = {
        ok: true,
        csrfToken: '',
        dashboard: {
          selectedTenant: { tenantId: 'tenant-1', tenantType: 'business', role: 'owner', reportCount: 0 },
          totals: { reports: 0, tenants: 1 },
          tenants: [{ tenantId: 'tenant-1', tenantType: 'business', role: 'owner' }],
          modules: [],
          company: null,
          employees: { totalCount: 0, activeCount: 0 },
        },
      };
    } else if (path === '/payrollcheck/api/company') {
      data = { ok: true, company: null };
    } else if (path === '/payrollcheck/api/employees') {
      data = { ok: true, employees: [] };
    } else if (path === '/payrollcheck/api/pay-runs') {
      if (body.action === 'list') {
        data = { ok: true, payRuns };
      } else if (body.action === 'get') {
        data = { ok: true, payRun: payRuns.find((run) => run.payRunId === body.payRunId) || null };
      } else if (body.action === 'delete') {
        payRuns = payRuns.filter((run) => run.payRunId !== body.payRunId);
        data = { ok: true };
      } else if (body.action === 'finalize') {
        payRuns = payRuns.map((run) => (run.payRunId === body.payRunId ? { ...run, status: 'final' } : run));
        data = { ok: true };
      } else {
        data = { ok: false, error: 'unknown action' };
      }
    } else {
      data = { ok: false, error: 'unknown path' };
    }
    return { status: 200, json: async () => data };
  }

  const sandbox = {
    document: documentStub,
    fetch: fetchStub,
    console,
    confirm() {
      confirmCalls += 1;
      return false;
    },
    sessionStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} },
    location: { href: '' },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  await flush();
  return {
    elements,
    fetchCalls,
    dialog,
    countConfirmCalls() {
      return confirmCalls;
    },
  };
}

function findListButton(list, label) {
  for (const item of list.children) {
    for (const child of item.children) {
      if (child.textContent === label) return child;
    }
  }
  return null;
}

test('pay runs use an in-page confirmation dialog, never the native confirm()', () => {
  assert.doesNotMatch(app, /confirm\(/);
  assert.match(app, /id="pay-run-confirm-dialog"/);
  assert.match(app, /id="pay-run-confirm-message"/);
  assert.match(app, /id="pay-run-confirm-button"/);
  assert.match(app, /id="pay-run-cancel-button"/);
  assert.match(app, /Delete this draft pay run\?/);
  assert.match(app, /Finalize this pay run\? Finalizing is irreversible\./);
});

test('delete: Delete shows the in-page dialog and only Confirm sends the delete request', async () => {
  const { elements, fetchCalls, dialog, countConfirmCalls } = await loadApp();
  const list = elements.get('pay-runs-list');
  const deleteButton = findListButton(list, 'Delete');
  assert.ok(deleteButton, 'expected a Delete button for the draft pay run');
  assert.equal(dialog.hidden, true);
  deleteButton.click();
  assert.equal(dialog.hidden, false);
  assert.equal(elements.get('pay-run-confirm-message').textContent, 'Delete this draft pay run?');
  assert.equal(elements.get('pay-run-confirm-button').textContent, 'Delete');
  assert.equal(fetchCalls.filter((call) => call.body.action === 'delete').length, 0);
  assert.equal(countConfirmCalls(), 0);
  elements.get('pay-run-confirm-button').click();
  await flush();
  const deletes = fetchCalls.filter((call) => call.body.action === 'delete');
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].path, '/payrollcheck/api/pay-runs');
  assert.deepEqual(deletes[0].body, { action: 'delete', tenantId: 'tenant-1', payRunId: 'pay-run-1' });
  assert.equal(dialog.hidden, true);
  assert.equal(elements.get('pay-run-message').textContent, 'Pay run deleted.');
  assert.equal(list.children.length, 0, 'the deleted draft is gone from the list');
});

test('delete: cancelling the in-page dialog sends no delete request', async () => {
  const { elements, fetchCalls, dialog, countConfirmCalls } = await loadApp();
  const list = elements.get('pay-runs-list');
  const deleteButton = findListButton(list, 'Delete');
  assert.ok(deleteButton, 'expected a Delete button for the draft pay run');
  deleteButton.click();
  assert.equal(dialog.hidden, false);
  elements.get('pay-run-cancel-button').click();
  await flush();
  assert.equal(dialog.hidden, true);
  assert.equal(fetchCalls.filter((call) => call.body.action === 'delete').length, 0);
  assert.equal(countConfirmCalls(), 0);
  assert.ok(findListButton(list, 'Delete'), 'the draft is still listed after cancelling');
});

test('finalize: Finalize shows the in-page dialog and only Confirm sends the finalize request', async () => {
  const { elements, fetchCalls, dialog, countConfirmCalls } = await loadApp();
  const list = elements.get('pay-runs-list');
  const finalizeButton = findListButton(list, 'Finalize');
  assert.ok(finalizeButton, 'expected a Finalize button for the draft pay run');
  assert.equal(dialog.hidden, true);
  finalizeButton.click();
  assert.equal(dialog.hidden, false);
  assert.equal(elements.get('pay-run-confirm-message').textContent, 'Finalize this pay run? Finalizing is irreversible.');
  assert.equal(elements.get('pay-run-confirm-button').textContent, 'Finalize');
  assert.equal(fetchCalls.filter((call) => call.body.action === 'finalize').length, 0);
  assert.equal(countConfirmCalls(), 0);
  elements.get('pay-run-confirm-button').click();
  await flush();
  const finalizes = fetchCalls.filter((call) => call.body.action === 'finalize');
  assert.equal(finalizes.length, 1);
  assert.equal(finalizes[0].path, '/payrollcheck/api/pay-runs');
  assert.deepEqual(finalizes[0].body, { action: 'finalize', tenantId: 'tenant-1', payRunId: 'pay-run-1' });
  assert.equal(dialog.hidden, true);
  assert.equal(elements.get('pay-run-message').textContent, 'Pay run finalized.');
  assert.equal(findListButton(list, 'Delete'), null, 'a finalized run has no Delete button');
  assert.equal(findListButton(list, 'Finalize'), null, 'a finalized run has no Finalize button');
});

test('finalize: cancelling the in-page dialog sends no finalize request', async () => {
  const { elements, fetchCalls, dialog, countConfirmCalls } = await loadApp();
  const list = elements.get('pay-runs-list');
  const finalizeButton = findListButton(list, 'Finalize');
  assert.ok(finalizeButton, 'expected a Finalize button for the draft pay run');
  finalizeButton.click();
  assert.equal(dialog.hidden, false);
  elements.get('pay-run-cancel-button').click();
  await flush();
  assert.equal(dialog.hidden, true);
  assert.equal(fetchCalls.filter((call) => call.body.action === 'finalize').length, 0);
  assert.equal(countConfirmCalls(), 0);
  assert.ok(findListButton(list, 'Finalize'), 'the draft can still be finalized after cancelling');
});
