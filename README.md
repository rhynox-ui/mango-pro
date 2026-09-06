# Mango Pro

A token-first, non-custodial mobile trading wallet — search for a token by name or ticker, and the app figures out which chain it's on and how to get you into it. Sibling app to [`mango-mobile`](../mango-mobile) (same bare React Native stack, same visual language), built around the opposite mental model: mobile is chain-first (pick a chain, then an asset); Mango Pro is token-first (pick a token, the chain follows).

Bare React Native 0.87.0 + TypeScript. No Expo, no navigation library — a screen-switch state machine in `App.tsx`, same pattern `mango-mobile` uses.

## What's actually built

This README describes the real, current state of the app — not a plan. (`ARCHITECTURE.md` in this repo is the original build plan from before implementation started; several of its ideas, notably ERC-4337 smart accounts and passkey-gated session keys, were never built. What shipped instead is documented below.)

**Wallet & onboarding**
- Local, non-custodial BIP-39 seed phrase — one mnemonic derives both an EVM account (`m/44'/60'/0'/0/0`, via viem) and a Solana account (`m/44'/501'/0'/0'`, via a from-scratch SLIP-10 ed25519 implementation, since the standard `ed25519-hd-key` package depends on Node's `crypto.createHmac`, unavailable under Hermes). Password-encrypted at rest, unlocked into memory only.
- **Google sign-in as a second onboarding path**, via [Particle Network](https://particle.network)'s Auth Core SDK (`@particle-network/rn-auth-core` + `@particle-network/rn-base`) — an MPC wallet-as-a-service: the private key is sharded between the device and Particle's infrastructure and never handed to this app as a raw key. A Google session gets a real address on both chains but no local private key at all (see `src/wallet/keys.ts`'s `authMethod` field) — real trades and withdrawals for these sessions sign through Particle's own remote signer (`src/wallet/particleSigning.ts`) instead of a local key.
- Auto-lock on backgrounding (configurable in Settings → Security), password unlock for seed-phrase sessions.

**Trading**
- Token search (`src/core/tokenSearch.ts`, DexScreener-backed) across 14 chains: Ethereum, Base, BNB Chain, Arbitrum One, Avalanche, Abstract, HyperEVM, Ink, Plasma, Unichain, X Layer, Robinhood Chain, Stable, and Solana.
- Primary routing via [Relay](https://relay.link)'s intent-based solver network (`src/core/relayQuote.ts` + `executeRelayQuote.ts`), gated behind a ported **intent-firewall** (`txIntentFirewall.ts` / `solanaTxIntent.ts`) that re-checks the router's actual response against what was quoted before anything gets signed.
- **Same-chain fallback routing** when Relay has no route: four direct on-chain DEX integrations with no backend dependency (Uniswap V4, Uniswap V3, SushiSwap V2, PancakeSwap V3) plus two generic aggregators (1inch, 0x) proxied through the site's backend. Quotes all of them in parallel, executes against the best price. EVM-only; Solana has no fallback path yet.
- Live price-impact warnings, configurable slippage, and a real trade-history log (`src/wallet/txHistory.ts`).
- Google-session (Particle) trading is wired for both the primary Relay path (EVM and Solana) and the same-chain fallback-DEX path — every trade path signs correctly regardless of onboarding method (`src/core/evmSigner.ts` is the shared local-vs-Particle signer abstraction the fallback path uses).

**Wallet dashboard**
- Real USDC balance aggregation across the 9 EVM chains with a verified USDC address plus Solana (`src/core/usdcBalances.ts`), receive addresses, and non-custodial USDC withdrawal (`src/wallet/sendUsdc.ts`) — direct broadcast from the device, no backend in the signing path.
- GoPlus-backed token security checks on search results and the trade screen.

**Everything else**
- Light/dark theme, haptics-ready UI primitives, a Settings screen with real Security/Appearance destinations, and a devnet-only diagnostic (Settings → "Solana signing test") for isolating Particle's Solana signing path from a real trade.

## Getting started

```sh
npm install   # also applies patches/ via postinstall (patch-package)
npm start     # Metro bundler
npm run android   # or: npm run ios
```

Requires a real Particle Network project (dashboard.particle.network) to enable Google sign-in — see `android/gradle.properties` and `ios/MangoPro/ParticleNetwork-Info.plist` for where the project credentials go. The seed-phrase onboarding path works without any of that.

### CI

`.github/workflows/android-debug-apk.yml` builds a real debug APK on every push to `main` and uploads it as a workflow artifact — the practical way to get a sideloadable build onto a real device, since Google sign-in needs actual Play Services and a real account.

### Verification

```sh
npm run typecheck
npm run lint
npm test
npm run verify   # offline checks for fees, wallet derivation, quote parsing, tx-intent firewalls, etc.
```

`verify` runs the `scripts/verify-*.mjs` suite — plain-Node checks (no device needed) that catch drift in the exact numbers and logic this app can't afford to get subtly wrong: fee rates, address derivation matching known-good vectors, the intent firewall refusing a tampered quote, and the ERC-20 transfer encoding matching the real function selector.

## Project layout

```
App.tsx                Auth state machine + 4-tab nav (Home, Search, Swap, Profile)
src/core/               Chain data, fees, routing (Relay + fallback DEXes), security checks
src/wallet/             Key derivation, vault (encrypted seed storage), Particle auth/signing, USDC send
src/onboarding/         Welcome, create/import wallet flows, password setup
src/screens/            Home, Search, Trade, Profile, Settings, Security, Appearance, History
src/theme/              Palette + light/dark ThemeContext (byte-matched to mango-mobile's palette)
scripts/                Offline verification scripts (see `npm run verify`)
```

## Known gaps

- Solana fallback routing (when Relay can't quote a Solana token) — no fallback exists yet, unlike EVM's four-provider chain.
- Particle's Solana signing wire format (Base58) is confirmed from Particle's own official sources but not yet proven end-to-end on a real device — see `src/screens/SolanaDevnetTestScreen.tsx` (Settings → "Solana signing test").
- No fiat on-ramp; crypto wallet only (seed phrase or Google/Particle MPC).
