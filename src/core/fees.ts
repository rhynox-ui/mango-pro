// src/core/fees.ts
//
// Ported from mango-bridge.jsx's src/devFeeWallets.js. Uses the SAME fee
// wallet address as the site/mobile/bot — an assumption, not a verified
// business decision: it reuses the existing protocol treasury on the
// theory that Mango Pro's revenue should land in the same place the
// other three apps' already does. If Mango Pro is meant to accrue to a
// separate wallet, change DEV_FEE_WALLET here (and only here — see
// scripts/verify-fees.mjs, which pins this file's exported values so a
// future edit can't silently change the effective rate without a
// visible, reviewed diff, the same protection devFeeWallets.js's own
// header describes needing after this exact rate silently drifted once
// already in mango-telegram-bot).

export const DEV_FEE_WALLET = '0xf07becc2401a646fff10d10b969ef18b03582e88';
export const DEV_FEE_WALLET_SOLANA = 'CFqNwTuTkqkaVoNZmNE6q5TeV6CcNwGRns2NSEY72Fu2';

export const DEV_FEE_PCT = 0.005;
export const DEV_FEE_MAX_USD = 50;

/**
 * The real bps value to send Relay (or any bps-shaped fee API) as this
 * request's fee — DEV_FEE_PCT normally, reduced only far enough that the
 * resulting dollar fee never exceeds DEV_FEE_MAX_USD once originAmountUsd
 * is large enough to hit it. originAmountUsd is optional and only ever a
 * real price-derived estimate; omitting it (or passing something
 * non-positive) just returns the flat rate — there is nothing to cap
 * without a real number to cap against.
 */
export function appFeeBps(originAmountUsd?: number | null): string {
  const flatBps = Math.round(DEV_FEE_PCT * 10000);
  if (!(typeof originAmountUsd === 'number' && originAmountUsd > 0)) {
    return String(flatBps);
  }
  const flatFeeUsd = originAmountUsd * DEV_FEE_PCT;
  if (flatFeeUsd <= DEV_FEE_MAX_USD) {
    return String(flatBps);
  }
  const cappedBps = Math.round((DEV_FEE_MAX_USD / originAmountUsd) * 10000);
  return String(Math.max(1, Math.min(flatBps, cappedBps)));
}

// Relay's own docs are explicit the appFees recipient must always be an
// EVM address, even for a Solana-sourced/destined route — app fees
// accrue off-chain in USDC, claimable on Base, never on the swap's own
// chain. DEV_FEE_WALLET_SOLANA above is intentionally never used as an
// appFees recipient; kept only for documentation/parity with the other
// three repos, which each independently arrived at (and one of them
// briefly regressed away from) the same conclusion.
export function feeRecipientForQuote(): string {
  return DEV_FEE_WALLET;
}
