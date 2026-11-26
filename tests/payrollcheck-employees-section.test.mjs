// PayrollCheck 360 - Slice 3 (Employees).
//
// Drives the employees section of public/payrollcheck/app.html with the same
// FakeDocument harness as the company section test: the inline script runs
// against fake elements and a stubbed fetch, so the section's behaviour -
// list rendering with masked SSNs, create, edit and deactivate - is checked
// without a browser or a database. The full SSN is sent to the server only
// on create or when the user types a new one; it is never shown on the page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appHtml = readFileSync(join(here, '..', 'public', 'payrollcheck', 'app.html'), 'utf8');
const inlineScript = appHtml.match(/<script>([\s\S]*?)<\/script>/)[1];

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
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
}

function buildDocument(created) {
  const byId = new Map();
  const ids = [
    'tenant-section', 'tenant-line', 'tenant-counts', 'tenant-select',
    'modules-section', 'modules-list', 'status-message',
    'company-section', 'company-status', 'company-form', 'company-message',
    'company-legal-name', 'company-ein', 'company-address-line1',
    'company-address-line2', 'company-city', 'company-state',
    'company-postal-code', 'company-pay-schedule',
    'employees-section', 'employees-status', 'employee-form', 'employee-message',
    'employee-first-name', 'employee-last-name', 'employee-ssn',
    'employee-filing-status', 'employee-allowances',
    'employee-extra-withholding', 'employee-pay-rate', 'employee-pay-type',
    'employee-submit', 'employee-cancel', 'employees-list',
    'logout-button',
  ];
  for (const id of ids) byId.set(id, new FakeElement('div', id));
  return {
    getElementById(id) { return byId.get(id) || null; },
    createElement(tagName) {
      const el = new FakeElement(tagName);
      created.push(el);
      return el;
    },
  };
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const INACTIVE_ID = '33333333-3333-4333-8333-333333333333';

const dashboardFixture = {
  selectedTenant: { tenantId: TENANT_ID, tenantType: 'business', role: 'business_owner', reportCount: 2 },
  tenants: [{ tenantId: TENANT_ID, tenantType: 'business', role: 'business_owner', reportCount: 2 }],
  totals: { reports: 2, tenants: 1 },
  modules: [
    { id: 'company', status: 'available', slice: 2, label: 'Company', note: 'Set up your company profile.' },
    { id: 'employees', status: 'available', slice: 3, label: 'Employees', note: 'Add and manage your employees.' },
  ],
  company: null,
  employees: { totalCount: 2, activeCount: 1 },
};

const employeesFixture = [
  { employeeId: EMPLOYEE_ID, firstName: 'Ada', lastName: 'Lovelace', ssnMasked: '***-**-6789', ssnLast4: '6789', filingStatus: 'single', allowances: 1, extraWithholding: '0.00', payRate: '45.00', payType: 'hourly', status: 'active', createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' },
  { employeeId: INACTIVE_ID, firstName: 'Grace', lastName: 'Hopper', ssnMasked: '***-**-4321', ssnLast4: '4321', filingStatus: 'mfj', allowances: 2, extraWithholding: '100.00', payRate: '95000.00', payType: 'salary', status: 'inactive', createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z' },
];

const companyFixture = { isSetUp: false };

async function loadApp() {
  const created = [];
  const calls = [];
  const documentStub = buildDocument(created);
  const windowStub = {
    sessionStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} },
    location: { href: '' },
  };
  const fetchStub = async (url, options) => {
    const body = options && options.body ? JSON.parse(options.body) : {};
    calls.push({ url, body });
    return {
      status: 200,
      json: async () => {
        if (url.includes('/api/dashboard')) return { ok: true, csrfToken: 'test-csrf', dashboard: dashboardFixture };
        if (url.includes('/api/company')) return { ok: true, company: companyFixture };
        if (url.includes('/api/employees')) {
          if (body.action === 'list') return { ok: true, employees: employeesFixture };
          if (body.action === 'create') return { ok: true, employee: { ...employeesFixture[0], employeeId: '44444444-4444-4444-8444-444444444444', firstName: body.employee.firstName, lastName: body.employee.lastName } };
          if (body.action === 'update') return { ok: true, employee: employeesFixture[0] };
          if (body.action === 'deactivate') return { ok: true, employee: { ...employeesFixture[0], status: 'inactive' } };
        }
        return { ok: false };
      },
    };
  };
  const run = new Function('document', 'window', 'fetch', inlineScript);
  run(documentStub, windowStub, fetchStub);
  // Let the dashboard fetch, render() and the employees list settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
  // A real select shows the selected option's value; the fake keeps ''.
  documentStub.getElementById('tenant-select').value = TENANT_ID;
  return { document: documentStub, created, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('employees section becomes visible when the dashboard renders and shows the counts', async () => {
  const app = await loadApp();
  assert.equal(app.document.getElementById('employees-section').hidden, false);
  assert.equal(app.document.getElementById('employees-status').textContent, '1 active employee of 2 total.');
  const link = app.created.find((el) => el.tagName === 'a' && el.textContent === 'Add and manage employees');
  assert.ok(link);
  assert.equal(link.href, '#employees-section');
});

test('employees list shows masked SSNs with Edit and Deactivate controls, never a full SSN', async () => {
  const app = await loadApp();
  const list = app.document.getElementById('employees-list');
  assert.equal(list.children.length, 2);
  const [ada, grace] = list.children;
  assert.match(ada.textContent, /Ada Lovelace/);
  assert.match(ada.textContent, /\*\*\*-\*\*-6789/);
  assert.match(ada.textContent, /Hourly/);
  assert.doesNotMatch(ada.textContent, /[0-9]{3}-[0-9]{2}-[0-9]{4}/);
  assert.match(grace.textContent, /Grace Hopper/);
  assert.match(grace.textContent, /\(inactive\)/);
  const buttons = (row) => row.children.filter((child) => child.tagName === 'button');
  assert.deepEqual(buttons(ada).map((b) => b.textContent), ['Edit', 'Deactivate']);
  assert.deepEqual(buttons(grace).map((b) => b.textContent), ['Edit']);
});

test('employees section starts hidden in the markup, so render() must unhide it', () => {
  assert.match(appHtml, /<section[^>]*id="employees-section"[^>]*hidden/);
});

test('employee form has the W-4 and pay fields the slice promises, with the SSN never prefilled', () => {
  for (const id of ['employee-first-name', 'employee-last-name', 'employee-ssn', 'employee-filing-status', 'employee-allowances', 'employee-extra-withholding', 'employee-pay-rate', 'employee-pay-type', 'employee-form', 'employees-list']) {
    assert.ok(appHtml.includes('id="' + id + '"'), id);
  }
  assert.match(appHtml, /<option value="single">Single<\/option>/);
  assert.match(appHtml, /<option value="mfj">Married filing jointly<\/option>/);
  assert.match(appHtml, /<option value="hoh">Head of household<\/option>/);
  assert.match(appHtml, /<option value="mfs">Married filing separately<\/option>/);
  assert.match(appHtml, /<option value="hourly">Hourly<\/option>/);
  assert.match(appHtml, /<option value="salary">Salary<\/option>/);
  assert.match(appHtml, /id="employee-ssn"[^>]*placeholder="123-45-6789"/);
});

test('submitting the employee form creates an employee and the page never shows the full SSN', async () => {
  const app = await loadApp();
  const doc = app.document;
  doc.getElementById('employee-first-name').value = 'Alan';
  doc.getElementById('employee-last-name').value = 'Turing';
  doc.getElementById('employee-ssn').value = '123-45-6789';
  doc.getElementById('employee-filing-status').value = 'hoh';
  doc.getElementById('employee-allowances').value = '3';
  doc.getElementById('employee-extra-withholding').value = '25.00';
  doc.getElementById('employee-pay-rate').value = '60.00';
  doc.getElementById('employee-pay-type').value = 'hourly';
  doc.getElementById('employee-form').listeners['submit']({ preventDefault: () => {} });
  await settle();
  const create = app.calls.find((call) => call.body.action === 'create');
  assert.ok(create);
  assert.equal(create.url, '/payrollcheck/api/employees');
  assert.equal(create.body.employee.firstName, 'Alan');
  assert.equal(create.body.employee.ssn, '123-45-6789');
  assert.equal(create.body.employee.filingStatus, 'hoh');
  assert.equal(create.body.employee.allowances, 3);
  assert.equal(doc.getElementById('employee-message').textContent, 'Employee added.');
  const list = doc.getElementById('employees-list');
  assert.ok(list.children.every((row) => !row.textContent.includes('123-45-6789')));
  assert.equal(doc.getElementById('employee-first-name').value, '');
});

test('editing an employee prefills the form with the masked SSN as placeholder and updates without sending an SSN when left blank', async () => {
  const app = await loadApp();
  const doc = app.document;
  const ada = doc.getElementById('employees-list').children[0];
  const edit = ada.children.find((child) => child.textContent === 'Edit');
  edit.listeners['click']();
  assert.equal(doc.getElementById('employee-first-name').value, 'Ada');
  assert.equal(doc.getElementById('employee-last-name').value, 'Lovelace');
  assert.equal(doc.getElementById('employee-ssn').value, '');
  assert.equal(doc.getElementById('employee-ssn').placeholder, '***-**-6789');
  assert.equal(doc.getElementById('employee-filing-status').value, 'single');
  assert.equal(doc.getElementById('employee-submit').textContent, 'Save changes');
  assert.equal(doc.getElementById('employee-cancel').hidden, false);
  doc.getElementById('employee-pay-rate').value = '50.00';
  doc.getElementById('employee-form').listeners['submit']({ preventDefault: () => {} });
  await settle();
  const update = app.calls.find((call) => call.body.action === 'update');
  assert.ok(update);
  assert.equal(update.body.employeeId, EMPLOYEE_ID);
  assert.equal(update.body.employee.payRate, '50.00');
  assert.ok(!('ssn' in update.body.employee));
  assert.equal(doc.getElementById('employee-message').textContent, 'Employee updated.');
  assert.equal(doc.getElementById('employee-submit').textContent, 'Add employee');
});

test('deactivating an employee posts a deactivate action and reports it', async () => {
  const app = await loadApp();
  const doc = app.document;
  const ada = doc.getElementById('employees-list').children[0];
  const deactivate = ada.children.find((child) => child.textContent === 'Deactivate');
  deactivate.listeners['click']();
  await settle();
  const call = app.calls.find((entry) => entry.body.action === 'deactivate');
  assert.ok(call);
  assert.equal(call.body.employeeId, EMPLOYEE_ID);
  assert.equal(call.body.tenantId, TENANT_ID);
  assert.equal(doc.getElementById('employee-message').textContent, 'Employee deactivated.');
});
