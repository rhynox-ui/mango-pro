# Sponsored Solana trades were rejected by their own intent firewall

**Status:** Fixed, commit `c9ea714`.
**Files:** `src/core/solanaTxIntent.ts`, `src/core/executeRelayQuote.ts`, `scripts/verify-solana-tx-intent.mjs`, `src/components/TradeResultModal.tsx`.

## Symptom

Selling a token that only pairs against SOL on-chain (e.g. ANSEM), from a
wallet holding only ~0.0009 SOL:

```
Trade failed
This route needs ~0.0015 SOL for network fees/rent, but this
wallet only has ~0.0009 SOL. Add more SOL and try again.
```

This read as an honest "you need more SOL" case. It wasn't — the app had
already detected the shortfall and tried to cover it via Mango's own
fee-sponsorship service. The auto-cover path is exactly what was failing.

## Why sponsorship exists

Some tokens never get a direct USDC pool — a same-chain sell has to hop
through a temporary wrapped-SOL leg first. That hop creates a new token
account, and Solana requires whoever creates an account to fund its rent.
A low-SOL wallet can't front that even though the trade itself is fine.

Solana's native answer is architectural: a transaction has a **fee payer**
field that is a separate account from whoever actually authorizes the
trade. `mango-api`'s Solana fee-payer endpoint co-signs as that fee payer
for exactly this case — the user still authorizes their own trade with
their own key; they just don't have to be the one who pays for it.

## Root cause

Traced step by step through `executeRelayQuote.ts`'s real execution path:

1. User submits a sell with insufficient SOL — the RPC's own preflight
   simulation rejects it with "insufficient lamports" (ground truth, not
   a client-side guess).
2. Mango correctly enters its sponsorship fallback:
   `signAndSendSponsoredSolanaStep()` fetches Mango's sponsor address and
   rewrites the trade's account-creation instructions to be funded by it.
3. The transaction is compiled with the sponsor as fee payer
   (`payerKey: feePayerPubkey`) — account index 0 is now the sponsor, not
   the user. This is deliberate; it's the whole point of sponsorship.
4. **The bug:** the pre-sign firewall is asked the wrong question —
   `assertSolanaTransactionMatchesIntent(transaction, {expectedSigner: keypair.publicKey.toBase58()})`
   checks "is the fee payer the user?" It never is, in this path. This
   throws every time, for every sponsored trade.
5. The real error gets swallowed: the caller wraps the sponsorship
   attempt in a bare `catch` that discards whatever went wrong and always
   throws the generic "add more SOL" message — regardless of whether the
   real cause was this firewall rejection, missing config, a network
   failure, or an actually-low sponsor balance.

**In one sentence:** the firewall was written for a world where the fee
payer is always the user, and nothing was updated when a second,
legitimate fee payer (the sponsor) was introduced.

## The fix

Two identities, checked separately, instead of one field asked to mean
both things.

`src/core/solanaTxIntent.ts` — `assertSolanaTransactionMatchesIntent` now
takes an optional `expectedFeePayer` alongside `expectedSigner`:

```ts
const allowedFeePayer = expectedFeePayer ?? expectedSigner;
if (allowedFeePayer && described.feePayer !== allowedFeePayer) {
  throw new SolanaIntentError(/* fee payer mismatch */);
}

// NEW — a sponsor covering the fee is never enough on its own.
if (expectedSigner && !described.requiredSigners.includes(expectedSigner)) {
  throw new SolanaIntentError(
    `This transaction does not require a signature from your wallet ` +
    `(${expectedSigner}) — it would not actually be authorized by you.`
  );
}
```

`describeSolanaTransaction` was extended to also return `requiredSigners`
— for a `VersionedTransaction`, the first `message.header.numRequiredSignatures`
keys of the static account table (fee payer always at index 0); for a
legacy `Transaction`, the fee payer plus the union of every instruction's
`isSigner`-marked accounts, matching how `@solana/web3.js`'s own message
compiler derives it.

`src/core/executeRelayQuote.ts` — `signAndSendSponsoredSolanaStep` now
passes the sponsor as the allowed fee payer, while `expectedSigner` still
gets checked independently:

```ts
const warnings = assertSolanaTransactionMatchesIntent(transaction, {
  expectedSigner: keypair.publicKey.toBase58(),
  expectedFeePayer: feePayerPubkey.toBase58(),
});
```

And the swallowed-error catch in `signAndSendRelaySolanaStep` now
surfaces the real sponsorship failure instead of always blaming the SOL
balance:

```ts
} catch (sponsorErr) {
  const sponsorMessage = sponsorErr instanceof Error ? sponsorErr.message : String(sponsorErr);
  throw new Error(
    `This wallet has ~${haveSol.toFixed(4)} SOL, short of the ~${needSol.toFixed(4)} SOL ` +
    `this route needs, and fee sponsorship didn't cover it: ${sponsorMessage}`,
  );
}
```

## Why this is safe, not just permissive

| Check | Before | After |
|---|---|---|
| Fee payer | must equal the user | must equal the user, or an explicitly-passed trusted address |
| Trusted sponsor source | — | fetched from Mango's own backend at call time — same trust boundary as every other backend-issued value this app already signs against |
| User authorization | implicit (fee payer being the user proved it) | explicit — user's key must appear in `requiredSigners` regardless of who pays |
| Normal (unsponsored) trades | unaffected | byte-identical — `expectedFeePayer` is omitted, so it defaults back to `expectedSigner` |

Net effect: a sponsor can now pay, but can never stand in for the user's
own authorization — the exact distinction Solana's fee-payer model is
built around, and the one the original check collapsed into one field.

## Test coverage added

`scripts/verify-solana-tx-intent.mjs` — 4 new regression cases, offline,
hand-built transaction shapes, no network or wallet:

- A sponsor-paid transaction where the user is still a required signer
  passes cleanly.
- Blocked if the user is NOT actually a required signer, even with a
  valid sponsor as fee payer.
- Blocked if the fee payer is neither the user nor the approved sponsor.
- Without `expectedFeePayer` passed, the old strict behavior still holds
  — reproducing the original bug on demand.

```
$ npm run verify-solana-tx-intent
19/19 checks passed

$ npm run verify-solana-fee-sponsor
7/7 checks passed

$ npm run verify-execute-relay-quote
4/4 checks passed
```

## Related, smaller fix in the same commit

`TradeResultModal.tsx`'s failure-state icon was switched from a red SVG
mark to the same real `mango-mark.png` used on success — the logo is
always the real black brand mark now, never a re-tinted stand-in.

## Follow-up (not yet done)

A real, end-to-end confirmation once the sponsor wallet has enough SOL:
retry the exact ANSEM (or similar SOL-only-paired token) sell that
originally surfaced this bug, and confirm it lands on-chain rather than
just passing the offline test vectors.
