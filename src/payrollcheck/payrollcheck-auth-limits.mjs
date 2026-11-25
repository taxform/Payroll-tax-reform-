// Failed-login lockout + per-IP rate limiting for the PayrollCheck 360
// login flow (M2 step 4c).
//
// Pure module: all state lives in an injected async store
// ({ get(key), set(key, value), delete(key) }) and all time comes from an
// injected clock, so this unit-tests without a database or a live service.
// The step 9 login handler backs the store (Postgres or similar) and calls
// checkLoginAllowed before any password check, recordFailedLogin on a bad
// password, and recordSuccessfulLogin on a good one.
//
// Builder choices (the boundary docs give no values):
//   - 5 failed logins -> 15-minute lockout, per identifier (login email).
//   - Auth endpoints: 60 requests/minute per IP (fixed window).
//   - Lockout READ fails closed (deny with reason 'unavailable'): a lockout
//     that cannot be checked must not be bypassed.
//   - Rate-limit READ fails open (allow, flagged degraded): a rate-limit
//     store outage must not lock every user out. The rate limit is abuse
//     friction, not identity verification; the lockout still guards the
//     account.

const MAX_KEY_LENGTH = 256;

function normalizeIdentifier(identifier) {
  if (typeof identifier !== 'string' || identifier.trim().length === 0) {
    throw new Error('identifier must be a non-empty string');
  }
  const normalized = identifier.trim().toLowerCase();
  if (normalized.length > MAX_KEY_LENGTH) {
    throw new Error('identifier is too long');
  }
  return normalized;
}

function normalizeKey(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.length > MAX_KEY_LENGTH) {
    throw new Error(`${name} is too long`);
  }
  return value;
}

export function createAuthLimits({
  store,
  now = () => Date.now(),
  maxFailedAttempts = 5,
  lockoutMs = 15 * 60 * 1000,
  rateLimitWindowMs = 60 * 1000,
  maxRequestsPerWindow = 60,
} = {}) {
  if (
    !store ||
    typeof store.get !== 'function' ||
    typeof store.set !== 'function' ||
    typeof store.delete !== 'function' ||
    typeof store.incrementAttempts !== 'function' ||
    typeof store.incrementRateLimit !== 'function'
  ) {
    throw new Error('createAuthLimits requires a store with get/set/delete/incrementAttempts/incrementRateLimit');
  }
  if (!Number.isInteger(maxFailedAttempts) || maxFailedAttempts < 1) {
    throw new Error('maxFailedAttempts must be a positive integer');
  }
  if (!Number.isInteger(lockoutMs) || lockoutMs < 1) {
    throw new Error('lockoutMs must be a positive integer');
  }
  if (!Number.isInteger(rateLimitWindowMs) || rateLimitWindowMs < 1) {
    throw new Error('rateLimitWindowMs must be a positive integer');
  }
  if (!Number.isInteger(maxRequestsPerWindow) || maxRequestsPerWindow < 1) {
    throw new Error('maxRequestsPerWindow must be a positive integer');
  }

  const attemptsKey = (identifier) => `auth:attempts:${identifier}`;
  const rateKey = (ip) => `auth:ratelimit:ip:${ip}`;

  async function readAttempts(identifier) {
    return store.get(attemptsKey(identifier));
  }

  async function checkRateLimitByKey(key) {
    const windowStartNow = now();
    try {
      const record = await store.incrementRateLimit({
        key: rateKey(key),
        now: windowStartNow,
        windowMs: rateLimitWindowMs,
        maxRequests: maxRequestsPerWindow,
      });
      if (!record) {
        return { allowed: true, remaining: maxRequestsPerWindow, resetMs: rateLimitWindowMs, degraded: true };
      }
      if (record.count > maxRequestsPerWindow) {
        return {
          allowed: false,
          remaining: 0,
          resetMs: record.windowStart + rateLimitWindowMs - windowStartNow,
        };
      }
      return {
        allowed: true,
        remaining: maxRequestsPerWindow - record.count,
        resetMs: record.windowStart + rateLimitWindowMs - windowStartNow,
      };
    } catch {
      // Fail open (documented): a rate-limit store outage must not lock
      // every user out. The caller can log `degraded: true`.
      return { allowed: true, remaining: maxRequestsPerWindow, resetMs: rateLimitWindowMs, degraded: true };
    }
  }

  return {
    // One call counts as one request against the IP window
    // (check-and-increment). Lockout is checked first, so a locked account
    // reports 'locked_out' even under a rate limit.
    async checkLoginAllowed({ identifier, ip }) {
      const normalizedIdentifier = normalizeIdentifier(identifier);
      const normalizedIp = normalizeKey(ip, 'ip');
      const currentTime = now();

      let attempts;
      try {
        attempts = await readAttempts(normalizedIdentifier);
      } catch {
        // Fail closed: a lockout that cannot be checked must not be bypassed.
        return { allowed: false, reason: 'unavailable', retryAfterMs: null };
      }
      if (attempts && attempts.lockedUntil && currentTime < attempts.lockedUntil) {
        return {
          allowed: false,
          reason: 'locked_out',
          retryAfterMs: attempts.lockedUntil - currentTime,
        };
      }
      if (attempts && attempts.lockedUntil && currentTime >= attempts.lockedUntil) {
        // Expired lock: clear the stale record (best effort; a failed
        // delete must not block a legitimate login whose lock expired).
        try {
          await store.delete(attemptsKey(normalizedIdentifier));
          attempts = null;
        } catch {
          attempts = null;
        }
      }

      const rate = await checkRateLimitByKey(normalizedIp);
      if (!rate.allowed) {
        return { allowed: false, reason: 'rate_limited', retryAfterMs: rate.resetMs };
      }
      return {
        allowed: true,
        remainingAttempts: maxFailedAttempts - (attempts?.count ?? 0),
        rateLimitDegraded: rate.degraded ?? false,
      };
    },

    async recordFailedLogin({ identifier }) {
      const normalizedIdentifier = normalizeIdentifier(identifier);
      const currentTime = now();
      try {
        const record = await store.incrementAttempts({
          key: attemptsKey(normalizedIdentifier),
          now: currentTime,
          maxFailedAttempts,
          lockoutMs,
        });
        if (!record) {
          return { recorded: false, lockedOut: false, storeError: true };
        }
        const count = record.count;
        const lockedOut = count >= maxFailedAttempts;
        if (lockedOut) {
          return { recorded: true, lockedOut: true, retryAfterMs: lockoutMs };
        }
        return { recorded: true, lockedOut: false, remainingAttempts: maxFailedAttempts - count };
      } catch {
        return { recorded: false, lockedOut: false, storeError: true };
      }
    },

    async recordSuccessfulLogin({ identifier }) {
      const normalizedIdentifier = normalizeIdentifier(identifier);
      try {
        await store.delete(attemptsKey(normalizedIdentifier));
        return { cleared: true };
      } catch {
        return { cleared: false };
      }
    },

    // Admin unlock: clears the attempt record for the identifier.
    async resetLockout({ identifier }) {
      const normalizedIdentifier = normalizeIdentifier(identifier);
      try {
        await store.delete(attemptsKey(normalizedIdentifier));
        return { cleared: true };
      } catch {
        return { cleared: false };
      }
    },

    // Generic fixed-window check-and-increment for other auth endpoints.
    async checkRateLimit({ key }) {
      return checkRateLimitByKey(normalizeKey(key, 'key'));
    },
  };
}
