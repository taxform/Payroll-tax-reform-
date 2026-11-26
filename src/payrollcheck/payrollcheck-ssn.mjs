// PayrollCheck 360 - Slice 3 (Employees).
//
// Employee SSNs are sealed before they reach the database: the app layer
// encrypts the nine-digit SSN with AES-256-GCM and stores only the sealed
// blob (plus the last four digits, for display) in payrollcheck.payroll_employees.
// The sealed value is never logged and the full SSN is never returned by the API.
//
// The sealing key is derived from the secret that is already injected into the
// server runtime as PAYROLLCHECK_PENDING_KEY (32 bytes, base64) - the same
// "secret arrives as injected server-side config, never committed, never
// logged" handling the pending-token sealer uses. The SSN key is a dedicated
// sub-key, derived with HMAC-SHA-256 over the purpose string below, so the SSN
// encryption key is cryptographically separated from the pending-token key
// even though they share one injected root secret. No new Netlify environment
// variable is required.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

const SSN_PURPOSE = 'payrollcheck-employee-ssn-v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function normalizeSsn(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 9 ? digits : null;
}

export function ssnLastFour(digits) {
  if (typeof digits !== 'string' || !/^[0-9]{9}$/.test(digits)) return null;
  return digits.slice(-4);
}

export function maskSsn(lastFour) {
  if (typeof lastFour !== 'string' || !/^[0-9]{4}$/.test(lastFour)) return null;
  return `***-**-${lastFour}`;
}

export function deriveSsnKey(rootKey) {
  if (!Buffer.isBuffer(rootKey) || rootKey.length !== 32) {
    throw new Error('SSN sealer needs a 32-byte root key');
  }
  return createHmac('sha256', rootKey).update(SSN_PURPOSE).digest();
}

export function createSsnSealer({ key }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('SSN sealer needs a 32-byte key');
  }
  const derivedKey = deriveSsnKey(key);
  function seal(ssn) {
    const digits = normalizeSsn(ssn);
    if (!digits) throw new Error('SSN must be nine digits');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
    cipher.setAAD(Buffer.from(SSN_PURPOSE, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    if (tag.length !== TAG_BYTES) throw new Error('SSN seal failed');
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }
  function open(blob) {
    if (typeof blob !== 'string') return null;
    let bytes;
    try {
      bytes = Buffer.from(blob, 'base64');
    } catch {
      return null;
    }
    if (bytes.length <= IV_BYTES + TAG_BYTES) return null;
    const iv = bytes.subarray(0, IV_BYTES);
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
      decipher.setAAD(Buffer.from(SSN_PURPOSE, 'utf8'));
      decipher.setAuthTag(tag);
      const digits = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      return normalizeSsn(digits);
    } catch {
      return null;
    }
  }
  return Object.freeze({ seal, open });
}
