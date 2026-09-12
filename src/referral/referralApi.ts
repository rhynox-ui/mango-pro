// src/referral/referralApi.ts
//
// Client for the SAME real referral API mango-mobile already uses
// (mango-bridge.jsx's api/v1/referral/*, backed by api/referralStore.js's
// Upstash Redis ledger) — one shared points economy across the site,
// mango-mobile, and Mango Pro, per an explicit product decision (points
// are keyed purely by wallet address, so a wallet used across apps just
// has one referral record everywhere). Ported byte-for-byte from
// mango-mobile's src/referral/referralApi.js: the message-builder
// strings below MUST stay byte-identical to mango-bridge.jsx's own
// api/v1/referral/claim.js, daily.js, delete.js, set-handle.js — the
// server rejects any message that doesn't match exactly, and there's no
// shared package between these repos to enforce that at build time.
//
// Wallet-agnostic: every claim/daily/set-handle call takes a `sign`
// function instead of a raw private key, so this file doesn't need to
// know whether the caller is a seed-phrase wallet (viem's
// privateKeyToAccount().signMessage) or a Google/Particle session
// (signMessageViaParticle, particleSigning.ts — confirmed real EIP-191
// personal_sign via evm.personalSign, see that file's own header) —
// both produce the same standard EIP-191 signature the server's
// viem.verifyMessage() checks, so either signer plugs in identically.

const API_BASE = 'https://mangoprotocol.site/api/v1/referral';

/** Same Twitter-style handle shape referralStore.js's own isValidHandle enforces server-side. */
export const REFERRAL_HANDLE_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function isValidReferralHandle(value: string): boolean {
  return REFERRAL_HANDLE_RE.test(value);
}

function buildReferralClaimMessage(address: string, referrer: string): string {
  return `Mango Wallet referral claim\naddress: ${address.toLowerCase()}\nreferrer: ${referrer.toLowerCase()}`;
}

function buildDailyClaimMessage(address: string): string {
  return `Mango Wallet daily check-in\naddress: ${address.toLowerCase()}`;
}

function buildSetHandleMessage(address: string, handle: string): string {
  return `Mango Wallet set referral handle\naddress: ${address.toLowerCase()}\nhandle: ${handle.toLowerCase()}`;
}

export type ReferralStats = {
  points: number;
  referralCount: number;
  referredBy: string | null;
  handle: string | null;
  dailyCooldownSeconds: number;
};

class ReferralApiError extends Error {
  secondsUntilNextClaim?: number;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new ReferralApiError((json.error as string) || `Request failed: ${res.status}`);
    err.secondsUntilNextClaim = json.secondsUntilNextClaim as number | undefined;
    throw err;
  }
  return json.data as T;
}

export async function getReferralStats(address: string): Promise<ReferralStats> {
  const res = await fetch(`${API_BASE}/me?address=${encodeURIComponent(address)}`);
  return parseJsonResponse<ReferralStats>(res);
}

/** A signer plugged in by the caller — either a local viem account's signMessage, or signMessageViaParticle for a Google/Particle session. */
export type ReferralSigner = (message: string) => Promise<string>;

export async function claimReferral({address, referrer, sign}: {address: string; referrer: string; sign: ReferralSigner}) {
  const message = buildReferralClaimMessage(address, referrer);
  const signature = await sign(message);
  const res = await fetch(`${API_BASE}/claim`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({address, referrer, message, signature}),
  });
  return parseJsonResponse<{pointsAwarded: number}>(res);
}

export async function claimDailyPoints({address, sign}: {address: string; sign: ReferralSigner}): Promise<{pointsAwarded: number}> {
  const message = buildDailyClaimMessage(address);
  const signature = await sign(message);
  const res = await fetch(`${API_BASE}/daily`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({address, message, signature}),
  });
  return parseJsonResponse<{pointsAwarded: number}>(res);
}

/** Real, signed claim of a custom referral handle for this wallet — strictly 1-to-1 and immutable once set. A 409 means either this wallet already has one, or the handle is taken. */
export async function setReferralHandle({address, handle, sign}: {address: string; handle: string; sign: ReferralSigner}) {
  const message = buildSetHandleMessage(address, handle);
  const signature = await sign(message);
  const res = await fetch(`${API_BASE}/set-handle`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({address, handle, message, signature}),
  });
  return parseJsonResponse<{handle: string}>(res);
}
