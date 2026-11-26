import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFederalWithholding,
  calculateFica,
  calculatePayLine,
} from '../src/payrollcheck/payrollcheck-withholding.mjs';

const vectors = [
  [2000, 'biweekly', 'single', 156.15],
  [1000, 'biweekly', 'single', 38.08],
  [2000, 'biweekly', 'married', 76.15],
  [5000, 'biweekly', 'single', 766.69],
  [500, 'biweekly', 'single', 0],
  [2000, 'weekly', 'single', 270.19],
  [3000, 'semimonthly', 'married', 178.33],
  [2000, 'biweekly', 'hoh', 114.92],
  [10000, 'monthly', 'single', 1464.17],
  [7500, 'biweekly', 'single', 1366.69],
];

test('2026 IRS percentage-method vectors', () => {
  for (const [gross, frequency, filingStatus, expected] of vectors) {
    assert.equal(calculateFederalWithholding({ gross, frequency, filingStatus }), expected,
      `${gross} ${frequency} ${filingStatus}`);
  }
});

test('FICA uses employee YTD wages and the 2026 wage base/additional Medicare threshold', () => {
  const fica = calculateFica({ gross: 1000, ytdWages: 184000 });
  assert.equal(fica.socialSecurity, 31);
  assert.equal(fica.medicare, 14.5);
  assert.equal(fica.additionalMedicare, 0);
  assert.equal(calculateFica({ gross: 250000, ytdWages: 0, annual: true }).additionalMedicare, 450);
});

test('pay line reconciles net pay and FICA totals', () => {
  const line = calculatePayLine({
    gross: 2000,
    frequency: 'biweekly',
    filingStatus: 'single',
    ytdWages: 0,
  });
  assert.equal(line.gross, 2000);
  assert.equal(line.federalWithholding, 156.15);
  assert.equal(line.netPay, 1690.85);
});
