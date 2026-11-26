import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('public/payrollcheck/app.html', 'utf8');

test('pay runs section exposes preview, create, list, get, delete and finalize controls', () => {
  assert.match(app, /id="pay-runs-section"/);
  assert.match(app, /id="pay-run-form"/);
  assert.match(app, /id="pay-runs-list"/);
  assert.match(app, /pay_run_preview|preview/);
  assert.match(app, /action:\s*["']create["']/);
  assert.match(app, /action:\s*["']finalize["']/);
  assert.match(app, /action:\s*["']delete["']/);
  assert.doesNotMatch(app, /confirm\(/);
  assert.match(app, /id="pay-run-confirm-dialog"/);
  assert.match(app, /id="pay-run-confirm-button"/);
  assert.match(app, /id="pay-run-cancel-button"/);
});
