// TaxBandits sandbox wiring for the live filing endpoint (Slice 6).
// This module is the only place that turns server-side TaxBandits sandbox
// credentials into an access token and a filing client. It runs in Netlify
// functions only: the credentials never reach the browser, and this module
// never logs a credential, a JWS or an access token.
//
// Token exchange (TaxBandits API 1.7.3 OAuth 2.0, the version the 94x forms
// use; https://developer.taxbandits.com/docs/apireference/oauth2.0authentication/):
// the client signs a short-lived JWT (JWS, HS256, keyed by the client secret)
// with iss = sub = client id and aud = user token, then GETs the sandbox
// token endpoint with that JWS in the `Authentication` header. The endpoint
// answers { AccessToken, TokenType: 'Bearer', ExpiresIn: 3600 }. No credential
// is ever sent in a query string or a request body, and there is no
// client_credentials POST in this version of the API.
//
// Sandbox only: the token endpoint is the sandbox host
// testoauth.expressauth.net and the filing client refuses any host other
// than testapi.taxbandits.com, so no filing can reach TaxBandits production
// through this module. Production filing is a separate, explicitly approved
// step and is not enabled by this slice.
import { createTaxBanditsSandboxClient } from './payrollcheck-filing.mjs';

// ---------------------------------------------------------------------------
// Sandbox constants
// ---------------------------------------------------------------------------

export const TAXBANDITS_SANDBOX_TOKEN_URL =
  'https://testoauth.expressauth.net/v2/tbsauth';

// Netlify environment variables (server-side only) that carry the sandbox
// credentials. All three are required: without any one of them the factory
// below returns null and the filing endpoint keeps its queue-only behaviour.
export const TAXBANDITS_SANDBOX_ENV_VARS = Object.freeze([
  'TAXBANDITS_SANDBOX_CLIENT_ID',
  'TAXBANDITS_SANDBOX_CLIENT_SECRET',
  'TAXBANDITS_SANDBOX_USER_TOKEN',
]);

const TOKEN_CACHE_MARGIN_SECONDS = 60;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

// ---------------------------------------------------------------------------
// JWS (signed JWT) for the sandbox token exchange
// ---------------------------------------------------------------------------

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlEncode(bytes) {
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    const second = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const third = i + 2 < bytes.length ? bytes[i + 2] : 0;
    encoded += BASE64URL_ALPHABET[first >> 2];
    encoded += BASE64URL_ALPHABET[((first & 0x03) << 4) | (second >> 4)];
    if (i + 1 < bytes.length) {
      encoded += BASE64URL_ALPHABET[((second & 0x0f) << 2) | (third >> 6)];
    }
    if (i + 2 < bytes.length) {
      encoded += BASE64URL_ALPHABET[third & 0x3f];
    }
  }
  return encoded;
}

function utf8Bytes(text) {
  return new TextEncoder().encode(text);
}

async function hmacSha256(key, data) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('TaxBandits sandbox token exchange needs Web Crypto (crypto.subtle)');
  }
  const cryptoKey = await subtle.importKey(
    'raw',
    utf8Bytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await subtle.sign('HMAC', cryptoKey, utf8Bytes(data));
  return new Uint8Array(signature);
}

// Build the JWS the sandbox token endpoint expects:
// header { alg: 'HS256', typ: 'JWT' },
// payload { iss: clientId, sub: clientId, aud: userToken, iat: nowSeconds },
// signature HMAC-SHA256 over header.payload, keyed by the client secret.
export async function createTaxBanditsSandboxJws({
  clientId,
  clientSecret,
  userToken,
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  if (!clientId || !clientSecret || !userToken) {
    throw new Error('TaxBandits sandbox credentials are required');
  }
  const header = base64UrlEncode(utf8Bytes(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64UrlEncode(
    utf8Bytes(JSON.stringify({ iss: clientId, sub: clientId, aud: userToken, iat: nowSeconds })),
  );
  const signingInput = `${header}.${payload}`;
  const signature = await hmacSha256(clientSecret, signingInput);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// ---------------------------------------------------------------------------
// Access-token provider (cached until shortly before expiry)
// ---------------------------------------------------------------------------

export function createTaxBanditsSandboxTokenProvider({
  clientId,
  clientSecret,
  userToken,
  fetch: fetchImpl = fetch,
  tokenUrl = TAXBANDITS_SANDBOX_TOKEN_URL,
  nowSeconds = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (tokenUrl !== TAXBANDITS_SANDBOX_TOKEN_URL) {
    throw new Error('TaxBandits sandbox token endpoint only: testoauth.expressauth.net');
  }
  if (!clientId || !clientSecret || !userToken) {
    throw new Error('TaxBandits sandbox credentials are required');
  }
  let cached = null;
  async function getAccessToken() {
    const now = nowSeconds();
    if (cached && cached.expiresAtSeconds > now + TOKEN_CACHE_MARGIN_SECONDS) {
      return cached.token;
    }
    const jws = await createTaxBanditsSandboxJws({ clientId, clientSecret, userToken, nowSeconds: now });
    const response = await fetchImpl(tokenUrl, {
      method: 'GET',
      headers: { Authentication: jws },
    });
    if (!response.ok) {
      throw new Error(`TaxBandits sandbox token exchange failed: ${response.status}`);
    }
    const data = await response.json();
    const token = data?.AccessToken;
    if (!token) {
      throw new Error('TaxBandits sandbox token exchange returned no access token');
    }
    const expiresIn = Number(data?.ExpiresIn);
    const ttl = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_TOKEN_TTL_SECONDS;
    cached = { token, expiresAtSeconds: now + ttl };
    return token;
  }
  return { getAccessToken };
}

// ---------------------------------------------------------------------------
// Filing client factory for the live endpoint
// ---------------------------------------------------------------------------

// Build the zero-argument factory the filing loader expects, or null when
// any sandbox credential is missing. A null factory keeps the endpoint's
// queue-only behaviour: filings are recorded as queued and nothing is sent
// to TaxBandits. The credentials are read here, in the function, from the
// environment object passed in, never from the browser.
export function createTaxBanditsSandboxFilingClientFactory({
  env = globalThis.process?.env ?? {},
  fetch: fetchImpl = fetch,
} = {}) {
  const clientId = env?.TAXBANDITS_SANDBOX_CLIENT_ID ?? '';
  const clientSecret = env?.TAXBANDITS_SANDBOX_CLIENT_SECRET ?? '';
  const userToken = env?.TAXBANDITS_SANDBOX_USER_TOKEN ?? '';
  if (!clientId || !clientSecret || !userToken) return null;
  const provider = createTaxBanditsSandboxTokenProvider({
    clientId,
    clientSecret,
    userToken,
    fetch: fetchImpl,
  });
  return () => createTaxBanditsSandboxClient({
    fetch: fetchImpl,
    getAccessToken: provider.getAccessToken,
  });
}
