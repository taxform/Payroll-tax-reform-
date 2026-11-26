import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/payrollcheck/app.html', import.meta.url), 'utf8');

test('tax center section', () => {
  assert.match(html, /id="tax-center"/);
  assert.match(html, /id="tax-center-status"/);
  assert.match(html, /id="tax-center-941"/);
  assert.match(html, /id="tax-center-940"/);
  assert.match(html, /id="tax-center-deposits"/);
  assert.match(html, /Tax center/);
  assert.match(html, /finalized pay runs/);
  assert.match(html, /not proof from IRS records/);
  assert.match(html, /\/payrollcheck\/api\/tax-center/);
  assert.match(html, /loadTaxCenter/);
  assert.doesNotMatch(html, /TaxBandits/);
});
