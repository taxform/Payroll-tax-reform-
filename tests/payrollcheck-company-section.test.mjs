import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appHtmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'payrollcheck', 'app.html');
const appHtml = readFileSync(appHtmlPath, 'utf8');
const inlineScript = appHtml.match(/<script>([\s\S]*?)<\/script>/)[1];

// Minimal DOM stub: just enough for app.html's inline script to run.
// The three dashboard sections start hidden, exactly as the markup declares them.
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
    'company-postal-code', 'company-pay-schedule', 'company-message',
    'modules-section', 'modules-list', 'logout-button',
  ];
  for (const id of ids) {
    const tag = id.endsWith('-select') || id === 'company-pay-schedule' ? 'select'
      : id === 'company-form' ? 'form'
      : id.endsWith('-section') ? 'section'
      : id === 'modules-list' ? 'div'
      : id === 'logout-button' ? 'button'
      : 'input';
    byId.set(id, new FakeElement(tag, id));
  }
  for (const id of ['tenant-section', 'modules-section', 'company-section']) {
    byId.get(id).hidden = true;
  }
  return {
    getElementById(id) { return byId.get(id) || null; },
    createElement(tagName) {
      const el = new FakeElement(tagName);
      created.push(el);
      return el;
    },
  };
}

const dashboardFixture = {
  selectedTenant: { tenantId: 'tenant-1', tenantType: 'business', role: 'owner', reportCount: 0 },
  totals: { reports: 0, tenants: 1 },
  tenants: [{ tenantId: 'tenant-1', tenantType: 'business', role: 'owner' }],
  modules: [{ id: 'company', label: 'Company profile', status: 'available', note: 'Set up the company profile.', slice: 2 }],
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
  const windowStub = {
    sessionStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} },
    location: { href: '' },
  };
  const fetchStub = async (url) => ({
    status: 200,
    json: async () => {
      if (url.includes('/api/dashboard')) return { ok: true, csrfToken: 'test-csrf', dashboard: dashboardFixture };
      if (url.includes('/api/company')) return { ok: true, company: companyFixture };
      return { ok: false };
    },
  });
  const run = new Function('document', 'window', 'fetch', inlineScript);
  run(documentStub, windowStub, fetchStub);
  // Let the dashboard fetch, render() and the company prefill settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { document: documentStub, created };
}

test('company profile form becomes visible when the dashboard renders', async () => {
  const { document, created } = await loadDashboard();
  const companySection = document.getElementById('company-section');
  assert.equal(companySection.hidden, false, 'render() must unhide #company-section, like it does #tenant-section and #modules-section');
  assert.equal(document.getElementById('tenant-section').hidden, false);
  assert.equal(document.getElementById('modules-section').hidden, false);

  // The company form fields live inside #company-section in the markup,
  // so unhiding the section is what makes them reachable.
  const start = appHtml.indexOf('id="company-section"');
  const sectionHtml = appHtml.slice(start, appHtml.indexOf('</section>', start));
  for (const fieldId of ['company-legal-name', 'company-ein', 'company-address-line1', 'company-city', 'company-state', 'company-postal-code', 'company-pay-schedule']) {
    assert.ok(sectionHtml.includes(`id="${fieldId}"`), `${fieldId} should be inside #company-section`);
  }
  assert.equal(document.getElementById('company-legal-name').value, 'Acme Corp', 'saved profile is prefilled once the section is shown');

  // The Modules card is the user's route to the form: its link targets
  // #company-section, which is only a usable target once it is unhidden.
  const companyLink = created.find((el) => el.tagName === 'a' && el.textContent === 'Set up the company profile');
  assert.ok(companyLink, 'Modules should render a "Set up the company profile" link');
  assert.equal(companyLink.href, '#company-section');
  assert.equal(document.getElementById(companyLink.href.slice(1)).hidden, false, 'the link target must be visible');
});

test('company-section starts hidden in the markup, so render() must unhide it', () => {
  assert.match(appHtml, /<section[^>]*id="company-section"[^>]*hidden>/, '#company-section starts hidden');
});
