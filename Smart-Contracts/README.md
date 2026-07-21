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