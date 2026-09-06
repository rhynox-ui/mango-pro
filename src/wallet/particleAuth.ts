// src/wallet/particleAuth.ts
//
// Real Google login via Particle Auth's own React Native SDK
// (@particle-network/rn-auth) — confirmed directly against that
// package's real source (npm pack + read, same verification path this
// app's other ports already use) and Particle's own docs
// (developers.particle.network), not guessed from memory. Particle is
// an MPC wallet-as-a-service: the private key is sharded between this
// device and Particle's own infrastructure and never handed to this
// app as a raw key at all — genuinely different from the local BIP-39
// derivation keys.ts does for the seed-phrase path, which is why
// loginWithGoogle below only ever returns ADDRESSES, never anything
// shaped like a privateKey.
//
// Requires real per-project config only the app owner can provide —
// none of it is a secret this code could reasonably ship a default
// for:
//   - Android: PN_PROJECT_ID / PN_PROJECT_CLIENT_KEY / PN_APP_ID in
//     android/gradle.properties (wired into AndroidManifest via
//     manifestPlaceholders in android/app/build.gradle).
//   - iOS: a ParticleNetwork-Info.plist (PROJECT_UUID/PROJECT_CLIENT_KEY/
//     PROJECT_APP_UUID) added to the Xcode target, plus a
//     "pn<PROJECT_APP_UUID>" URL scheme in Info.plist — see this repo's
//     own ios/MangoPro/ParticleNetwork-Info.plist for the placeholder
//     and its own comment for the one manual Xcode step this code can't
//     do from here (adding a new file to a target requires Xcode's own
//     project-file tooling, not a hand-edited .pbxproj).
// Until real values are filled in, login() below will fail with
// Particle's own configuration error — a real, loud failure, not a
// silent fake success.
//
// Single-active-chain model: Particle's own SDK tracks one "current"
// chain at a time and getAddress() returns whichever chain is active,
// not both at once — unlike this app's own DerivedAccounts, which
// always carries both an EVM and a Solana address together. loginWithGoogle
// below does the two-step dance (read the EVM address, switch to
// Solana, read that address, switch back to EVM as this app's default
// active chain) so callers still get both, same shape as a seed-phrase
// session.

import {init, login, logout, getAddress, setChainInfoAsync, LoginType, SupportAuthType, Env} from '@particle-network/rn-auth';
import {Ethereum, Solana} from '@particle-network/chains';
import type {DerivedAccounts} from './keys';

let initialized = false;

/**
 * Sets up the SDK with this app's default chain (Ethereum — the actual
 * active chain gets switched per-call anyway, this just needs to be a
 * real EVM chain to start from). Best-effort and idempotent — safe to
 * call from App.tsx's own startup warmup alongside warmupCrypto(),
 * never throws past itself so a missing/invalid native config doesn't
 * take down onboarding for the (unaffected) seed-phrase path.
 */
export function initParticleAuth(): void {
  if (initialized) return;
  try {
    init(Ethereum, Env.Production);
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
 * Throws whatever real error Particle's own SDK reports (a missing
 * project config, a cancelled login, a network failure) — never
 * swallowed here, since the caller (WelcomeScreen.tsx) needs the real
 * reason to show the user.
 */
export async function loginWithGoogle(): Promise<ParticleAddresses> {
  initParticleAuth();
  const result = await login(LoginType.Google, undefined, [SupportAuthType.Google]);
  if (!result.status) {
    throw new Error(typeof result.data === 'string' ? result.data : 'Google sign-in failed.');
  }
  const evmAddress = await getAddress();

  const switchedToSolana = await setChainInfoAsync(Solana);
  if (!switchedToSolana) {
    throw new Error("Couldn't resolve a Solana address for this account.");
  }
  const solanaAddress = await getAddress();

  // Back to EVM as the default active chain — same convention every
  // other part of this app already assumes (session.evm is the
  // "primary" side; e.g. ProfileScreen's own handle/address display).
  await setChainInfoAsync(Ethereum);

  return {evmAddress, solanaAddress};
}

export async function logoutParticle(): Promise<void> {
  try {
    await logout();
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
