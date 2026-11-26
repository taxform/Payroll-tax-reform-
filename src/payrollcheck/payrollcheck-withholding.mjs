export const PAY_FREQUENCY_PERIODS = Object.freeze({
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
});

const STANDARD_DEDUCTION = Object.freeze({
  single: 16100,
  married: 32200,
  mfj: 32200,
  hoh: 24150,
});

const BRACKETS = Object.freeze({
  single: [[12400, .10], [50400, .12], [105700, .22], [201800, .24], [256600, .32], [640700, .35], [Infinity, .37]],
  married: [[24800, .10], [100800, .12], [211400, .22], [403600, .24], [513200, .32], [768700, .35], [Infinity, .37]],
  mfj: [[24800, .10], [100800, .12], [211400, .22], [403600, .24], [513200, .32], [768700, .35], [Infinity, .37]],
  hoh: [[17700, .10], [67100, .12], [105700, .22], [201800, .24], [256600, .32], [640700, .35], [Infinity, .37]],
});

function roundCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? roundCents(n) : 0;
}

export function calculateFederalWithholding({ gross, frequency, filingStatus = 'single' } = {}) {
  const periods = PAY_FREQUENCY_PERIODS[frequency];
  const status = filingStatus === 'mfs' ? 'single' : (filingStatus ?? 'single');
  if (!periods || !STANDARD_DEDUCTION[status] || !Number.isFinite(Number(gross))) return 0;
  const annualWages = Math.max(0, Number(gross) * periods);
  const taxable = Math.max(0, annualWages - STANDARD_DEDUCTION[status]);
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of BRACKETS[status]) {
    if (taxable <= lower) break;
    const slice = Math.max(0, Math.min(taxable, upper) - lower);
    tax += slice * rate;
    lower = upper;
  }
  return roundCents(tax / periods);
}

export function calculateFica({ gross, ytdWages = 0, annual = false } = {}) {
  const wages = money(gross);
  const ytd = Math.max(0, money(ytdWages));
  const socialSecurityWages = Math.max(0, Math.min(wages, Math.max(0, 184500 - ytd)));
  const socialSecurity = roundCents(socialSecurityWages * .062);
  const medicare = roundCents(wages * .0145);
  let additionalBase = 0;
  if (annual) {
    additionalBase = Math.max(0, ytd + wages - 200000);
  } else {
    additionalBase = Math.max(0, ytd + wages - 200000);
  }
  return Object.freeze({
    socialSecurity,
    medicare,
    additionalMedicare: roundCents(additionalBase * .009),
  });
}

export function calculatePayLine({ gross, frequency, filingStatus, ytdWages = 0 } = {}) {
  const grossMoney = money(gross);
  const federal = calculateFederalWithholding({ gross: grossMoney, frequency, filingStatus });
  const fica = calculateFica({ gross: grossMoney, ytdWages });
  const totalTax = federal + fica.socialSecurity + fica.medicare + fica.additionalMedicare;
  return {
    gross: grossMoney,
    federalWithholding: federal,
    socialSecurity: fica.socialSecurity,
    medicare: fica.medicare,
    additionalMedicare: fica.additionalMedicare,
    netPay: roundCents(grossMoney - totalTax),
  };
}
