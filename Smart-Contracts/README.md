## IdentityRegister

**What it does:** maps one real-world identity (derived from a passport NFC scan) to one or more Web3 wallets, and lets Lexo's backend ban every wallet under an identity at once if that person commits fraud or defaults.

### Why it exists

Without this, a bad actor banned on one wallet could just register a new wallet and keep going. `IdentityRegister` closes that loop by tying every wallet back to the same underlying identity hash — so a ban on the person, not just the wallet, actually sticks.

### How registration works (attestation flow)

The contract never touches passport data directly. Instead:

1. **Off-chain:** the user scans their passport NFC chip. Lexo's backend verifies it (Passive Authentication against the ICAO master list) and runs a sanctions screening check.
2. **Off-chain:** if both pass, the backend signs an **EIP-712 attestation** — a message saying "this wallet may register under this identity hash, valid until this deadline" — using its private `verifier` key. No transaction, no gas cost yet.
3. **On-chain:** the user's own wallet calls `registerWithAttestation()`, attaching that signature. The contract recovers the signer, checks it matches the trusted `verifier` address, and links the wallet.

Because the user's own wallet submits the transaction, `msg.sender` *is* the wallet being registered — this proves ownership for free, with no separate signature-based proof-of-ownership step needed.

### Key concepts

| Concept | What it means here |
|---|---|
| **Identity hash** | `keccak256(passport public key + server-side pepper)` — a stable pseudonym for one person, generated off-chain. The contract only ever sees the hash, never the passport data. |
| **Root wallet** | The first wallet registered under an identity hash. Extra-protected — it can't be removed directly, only replaced via `changeRootWallet`. |
| **Restriction (ban)** | Set via `restrict()`. Stored *independently* of the rest of an identity's state, so it survives even a full `unverify()` purge — a banned identity can't simply reset its way out of a ban. |
| **Verification** | An identity becomes `verified` the moment its root wallet registers. `unverify()` is a hard purge (wipes all linked wallets); recovering means registering fresh with a new attestation. |
| **Attestation replay protection** | Every attestation is signed over a specific wallet, identity hash, deadline, and nonce. A wallet can only ever register once, and its nonce increments on use — so a signature can never be redeemed twice. |

### What downstream contracts should do

Any contract that needs to gate an action on identity (most importantly `EscrowCore`) should call:

```solidity
IdentityRegister(registryAddress).isVerified(wallet)
```

right before the action (deposit, release, etc.) — never cache this result. It's a live check: verified *and* not restricted, checked fresh every time.

### Known limitations (documented, not hidden)

- **One passport, one bad actor with a second passport isn't stopped by this contract alone.** Sybil resistance here is per-identity-hash, not cross-identity collusion detection.
- **`unverify()` is a hard reset**, not a pause. There's no "temporarily suspend, restore without re-onboarding" state — if that's needed later, it would require a new intermediate status separate from `verified`/`restricted`.
- **Passport chip cloning resistance depends on the issuing document supporting Active/Chip Authentication** — Passive Authentication (which all ICAO 9303 passports support) proves data integrity, not clone-resistance. This is a limitation of the off-chain verification step, not the contract, but worth stating plainly rather than overclaiming "unclonable."

## EscrowCore

**What it does:** holds ERC20 funds for a milestone-based deal between two verified parties, releasing each milestone's payment the moment the payer approves it. Every party involved must currently pass `IdentityRegister.isVerified()` — the two contracts are meant to be deployed together.

### How a deal works

1. **Create:** the payer calls `createDeal()` with a payee address, a token, and a list of milestone descriptions + amounts. The full total is pulled from the payer immediately and held by the contract. Both payer and payee must be verified identities at this point, or the call reverts.
2. **Release:** the payer calls `approveAndReleaseMilestone()` once a milestone is satisfied. That milestone's amount is credited to the payee's withdrawable balance immediately — milestones release one at a time, in order, not all at once.
3. **Withdraw:** the payee (or, in a dispute, either party with a resolved payout) calls `withdraw()` to actually pull their tokens out. A 3% protocol fee (`FEE_BPS`) is taken at this step and sent to the contract owner.
4. **Completion:** once the last milestone is released, the deal is marked `Completed` automatically.

### Why pull-payment, not push-payment

Funds are never sent directly to a payee mid-flow. Every release just credits `pendingWithdrawals`, and the recipient withdraws it themselves via a separate transaction. This is a standard safety pattern — it means a payee's own wallet or contract logic can never block, revert, or grief a milestone release just by being unable to receive funds.

### Identity gating

Every state-changing function requires `onlyVerified` — a **live** call to `IdentityRegister.isVerified(msg.sender)` on every single transaction, never a cached flag. If a party gets banned mid-deal, their very next attempted action (release, withdraw, dispute) will revert immediately, without EscrowCore needing any separate "notify" step from the identity registry.

### Fee structure (current)

A flat 3% (`FEE_BPS = 30`, out of `BPS_DENOMINATOR = 10_000`) is taken on every `withdraw()` call, regardless of whether the withdrawal is a normal milestone release or a dispute payout. This is simpler than the full fee waterfall described in the Lexo blueprint (97/2/1 normal vs. 96/1/2/1 disputed, with a separate arbitrator fee) — the waterfall split and RWA/yield routing are not yet implemented here.

---

### ⚠️ Dispute Resolution — Work In Progress, Not Yet Functional

The dispute/arbitration path in this contract is early scaffolding, not a finished feature. Known open items, to be resolved before this is relied on:

- **`resolveDispute` currently has a broken access-control combination.** It requires the caller to satisfy `onlyOwner` *and* a separate check that `msg.sender == address(arbiter)`. Those two can only both be true if the contract owner and the arbiter contract happen to be the same address — which isn't the intended design (the arbiter is meant to be a separate contract handling staking/commit-reveal voting, calling in on its own). This needs to be fixed as one or the other, not both, before dispute resolution is wired to a real arbitration contract.
- **No arbitrator fee carve-out yet.** The blueprint's dispute waterfall reserves 1% specifically for arbitrators; `resolveDispute` currently just splits the full remaining balance between payer and payee with no separate fee line.
- **No zero-address check on the constructor's `_arbiter` parameter.** A deal can currently be created and disputed with no arbiter wired up at all — `raiseDispute` will simply revert when it tries to call `arbiter.createCase(...)` on the zero address, which is a confusing failure mode rather than an explicit upfront rejection.
- **No stake, cooldown, or evidence requirement on raising a dispute.** Either party can call `raiseDispute` at any point while a deal is in progress, with just a free-text reason string. The staking/commit-reveal arbitration system described in the blueprint (Section 2 of the main protocol doc) is meant to sit behind `IArbitrationCourt`, but that contract doesn't exist yet.

*(Placeholder — fill in the rest of this section once the arbitration contract and the access-control fix are actually built. This gap is intentional and tracked, not accidental.)*