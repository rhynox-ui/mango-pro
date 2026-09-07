// src/wallet/particleAuth.ts
//
// Real Google login via Particle Auth's current React Native SDK family
// (@particle-network/rn-auth-core + its required @particle-network/rn-base
// dependency) — verified directly against those packages' own real
// source (npm pack + read, same verification path this app's other
// ports already use), not Particle's older, superseded standalone
// @particle-network/rn-auth package (v1.x — this app briefly used it
// before this file was rewritten against the current v2 family once
// that mismatch was caught). Particle is an MPC wallet-as-a-service:
// the private key is sharded between this device and Particle's own
// infrastructure and never handed to this app as a raw key at all —
// genuinely different from the local BIP-39 derivation keys.ts does
// for the seed-phrase path, which is why loginWithGoogle below only
// ever returns ADDRESSES, never anything shaped like a privateKey.
//
// Two packages, two responsibilities, confirmed from their own source:
// rn-base's init(chainInfo, env) sets up the project-level config and a
// default active chain; rn-auth-core's own init() sets up its own
// native auth module on top of that. Both real, both required — this
// isn't a guess, rn-auth-core's package.json declares rn-base as a
// hard dependency and its own AndroidManifest.xml carries its own
// project_id/client_key/app_id meta-data alongside a second
// "ac${PN_APP_ID}" callback URL scheme distinct from rn-base's
// "pn${PN_APP_ID}" one.
//
// Requires real per-project config only the app owner can provide —
// none of it is a secret this code could reasonably ship a default
// for:
//   - Android: PN_PROJECT_ID / PN_PROJECT_CLIENT_KEY / PN_APP_ID in
//     android/gradle.properties (wired into AndroidManifest via
//     manifestPlaceholders in android/app/build.gradle) — confirmed
//     unchanged from the older package: both rn-base's and
//     rn-auth-core's own AndroidManifest.xml reference the exact same
//     three placeholder names.
//   - iOS: a ParticleNetwork-Info.plist (PROJECT_UUID/PROJECT_CLIENT_KEY/
//     PROJECT_APP_UUID) added to the Xcode target, plus a
//     "pn<PROJECT_APP_UUID>" URL scheme in Info.plist for rn-base and,
//     by the same pn/ac split confirmed on Android above, an
//     "ac<PROJECT_APP_UUID>" scheme for rn-auth-core — see this repo's
//     own ios/MangoPro/ParticleNetwork-Info.plist for the placeholder
//     and its own comment for the one manual Xcode step this code can't
//     do from here (adding a new file to a target requires Xcode's own
//     project-file tooling, not a hand-edited .pbxproj).
// Until real values are filled in, connect() below will fail with
// Particle's own configuration error — a real, loud failure, not a
// silent fake success.

import {init as initParticleBase, Env, LoginType, SupportAuthType} from '@particle-network/rn-base';
import {init as initAuthCore, connect, disconnect, evm, solana} from '@particle-network/rn-auth-core';
import {Ethereum} from '@particle-network/chains';
import type {DerivedAccounts} from './keys';

let initialized = false;

/**
 * Sets up both SDK layers — rn-base's project/chain config, then
 * rn-auth-core's own native auth module on top of it. Best-effort and
 * idempotent — safe to call from App.tsx's own startup warmup alongside
 * warmupCrypto(), never throws past itself so a missing/invalid native
 * config doesn't take down onboarding for the (unaffected) seed-phrase
 * path.
 */
export function initParticleAuth(): void {
  if (initialized) return;
  try {
    initParticleBase(Ethereum, Env.Production);
    initAuthCore();
    initialized = true;
  } catch {
    // No real project config yet, or the native module isn't linked —
    // loginWithGoogle below will surface a real, loud error at the
    // point someone actually taps "Continue with Google" instead.
  }
}

export type ParticleAddresses = {evmAddress: string; solanaAddress: string};

/**
 * Runs the real Google OAuth flow through Particle's own hosted UI,
 * then reads back both chain addresses for the now-logged-in account.
 * Unlike the older single-active-chain SDK, rn-auth-core's evm/solana
 * submodules each expose their own getAddress() directly — no chain-
 * switching dance needed to read both. Throws whatever real error
 * Particle's own SDK reports (a missing project config, a cancelled
 * login, a network failure) — never swallowed here, since the caller
 * (WelcomeScreen.tsx) needs the real reason to show the user.
 */
export async function loginWithGoogle(): Promise<ParticleAddresses> {
  initParticleAuth();
  try {
    await connect(LoginType.Google, undefined, [SupportAuthType.Google]);
  } catch (err) {
    // connect() rejects with Particle's own {code, message} shape, not
    // an Error instance — re-throw as one so callers get a normal
    // Error.message rather than having to know that detail themselves.
    const message = err && typeof err === 'object' && 'message' in err ? String((err as {message: unknown}).message) : 'Google sign-in failed.';
    throw new Error(message);
  }
  const [evmAddress, solanaAddress] = await Promise.all([evm.getAddress(), solanaAddressWithRetry()]);
  return {evmAddress, solanaAddress};
}

/**
 * A real device test surfaced solana.getAddress() coming back empty
 * immediately after a fresh Google login, while evm.getAddress() (called
 * in the same instant, via the same Promise.all above) resolved fine —
 * Particle's MPC key-share provisioning for a second chain can plausibly
 * lag a moment behind the OAuth callback resolving, since it's a real
 * backend operation, not a value already sitting on-device. Retries a
 * few times with a short delay rather than accepting a single immediate
 * empty result at face value; still returns whatever the last attempt
 * got (including empty) if it never resolves — never fabricates an
 * address that doesn't come from Particle's own SDK.
 */
async function solanaAddressWithRetry(): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const address = await solana.getAddress();
    if (address) return address;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 750));
  }
  return '';
}

export async function logoutParticle(): Promise<void> {
  try {
    await disconnect();
  } catch {
    // Best-effort — the local session is being torn down either way
    // (App.tsx's own handleLock clears it), a failed remote logout call
    // shouldn't block that.
  }
}

/** Shapes a Google login result into this app's own session type — privateKey is deliberately '' on both sides, never a placeholder pretending to be real (see this file's own header for why one can't exist here at all). */
export function particleAddressesToSession(addresses: ParticleAddresses): DerivedAccounts {
  return {
    evm: {address: addresses.evmAddress, privateKey: ''},
    solana: {address: addresses.solanaAddress, privateKey: ''},
    authMethod: 'google',
  };
}
