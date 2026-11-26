import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appHtmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'payrollcheck', 'app.html');
const appHtml = readFileSync(appHtmlPath, 'utf8');
const inlineScript = appHtml.match(/<script>([\s\S]*?)<\/script>/)[1];

// Minimal DOM stub: just enough for app.html's inline script to run.
// The dashboard sections start hidden, exactly as the markup declares them.
class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.placeholder = '';
    this.className = '';
    this.href = '';
    this.selected = false;
    this.onchange = null;
    this.children = [];
    this.listeners = {};
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
}

function buildDocument(created) {
  const byId = new Map();
  const ids = [
    'status-message', 'tenant-section', 'tenant-line', 'tenant-counts',
    'tenant-select', 'company-section', 'company-status', 'company-form',
    'company-legal-name', 'company-ein', 'company-address-line1',
    'company-address-line2', 'company-city', 'company-state',
    'company-postal-code', 'company-pay-schedule', 'employees-section',
    'employees-status', 'employees-form', 'employees-list',
    'employees-first-name', 'employees-last-name', 'employees-email',
    'modules-section', 'modules-list', 'logout-button',
    'pay-runs-section', 'pay-runs-status', 'pay-runs-form', 'pay-runs-list',
    'pay-runs-period-start', 'pay-runs-period-end', 'pay-runs-message',
  ];
  for (const id of ids) byId.set(id, new FakeElement('div', id));
  byId.get('tenant-section').hidden = true;
  byId.get('modules-section').hidden = true;
  byId.get('company-section').hidden = true;
  byId.get('employees-section').hidden = true;
  byId.get('pay-runs-section').hidden = true;
  return {
    createElement(tagName) { const el = new FakeElement(tagName); created.push(el); return el; },
    getElementById(id) { return byId.get(id) ?? null; },
    addEventListener() {},
  };
}

const dashboardFixture = {
  selectedTenant: { tenantId: 'tenant-1', tenantType: 'business', role: 'owner', reportCount: 0 },
  totals: { reports: 0, tenants: 1 },
  tenants: [{ tenantId: 'tenant-1', tenantType: 'business', role: 'owner' }],
  modules: [
    { id: 'company', label: 'Company profile', status: 'available', note: 'Set up the company profile.', slice: 2 },
    { id: 'employees', label: 'Employees', status: 'available', note: 'Add and manage employees.', slice: 3 },
    { id: 'pay-runs', label: 'Pay runs', status: 'available', note: 'Preview, create, finalize and manage your pay runs.', slice: 4 },
    { id: 'compliance-check', label: 'Compliance check', status: 'available', note: 'Run the compliance check.', slice: 7 },
  ],
  company: null,
};

const companyFixture = {
  legalName: 'Acme Corp',
  einMasked: '*****6789',
  address: { line1: '1 Main St', line2: '', city: 'Albany', state: 'NY', postalCode: '12201' },
  paySchedule: 'biweekly',
};

async function loadDashboard() {
  const created = [];
  const documentStub = buildDocument(created);
  const windowStub = { sessionStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} }, location: { href: '' } };
  const fetchStub = async (url) => {
    if (url.includes('/api/dashboard')) return { status: 200, json: async () => ({ ok: true, csrfToken: 'test-csrf', dashboard: dashboardFixture }) };
    if (url.includes('/api/company')) return { status: 200, json: async () => ({ ok: true, company: companyFixture }) };
    return { status: 404, json: async () => ({ ok: false }) };
  };
  const run = new Function('document', 'window', 'fetch', inlineScript);
  run(documentStub, windowStub, fetchStub);
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  return { document: documentStub, created };
}

test('pay-runs section becomes visible and its Modules card links to it when the dashboard renders', async () => {
  const { document, created } = await loadDashboard();
  const payRunsSection = document.getElementById('pay-runs-section');
  assert.equal(payRunsSection.hidden, false, 'render() must unhide #pay-runs-section, like it does #company-section and #employees-section');
  assert.equal(document.getElementById('tenant-section').hidden, false);
  assert.equal(document.getElementById('modules-section').hidden, false);
  assert.equal(document.getElementById('company-section').hidden, false);
  assert.equal(document.getElementById('employees-section').hidden, false);
  // The pay-runs controls live inside #pay-runs-section in the markup, so unhiding the section is what makes them reachable.
  const start = appHtml.indexOf('id="pay-runs-section"');
  const sectionHtml = appHtml.slice(start, appHtml.indexOf('</section>', start));
  for (const fieldId of ['pay-runs-status', 'pay-runs-list', 'pay-runs-form', 'pay-runs-period-start', 'pay-runs-period-end', 'pay-runs-message']) {
    assert.ok(sectionHtml.includes(`id="${fieldId}"`), `${fieldId} should be inside #pay-runs-section`);
  }
  assert.equal(document.getElementById('pay-runs-status').textContent, 'No pay runs yet.', 'renderPayRuns() runs once the section is shown');
  // The Modules card is the user's route to the section: its link must target #pay-runs-section, not the login page.
  const payRunsLink = created.find((el) => el.tagName === 'a' && el.textContent === 'Open pay runs');
  assert.ok(payRunsLink, 'Modules should render an "Open pay runs" link');
  assert.equal(payRunsLink.href, '#pay-runs-section');
  assert.equal(document.getElementById(payRunsLink.href.slice(1)).hidden, false, 'the link target must be visible');
});

test('pay-runs-section starts hidden in the markup, so render() must unhide it', () => {
  assert.match(appHtml, /<section[^>]*id="pay-runs-section"[^>]*hidden>/, '#pay-runs-section starts hidden');
});
