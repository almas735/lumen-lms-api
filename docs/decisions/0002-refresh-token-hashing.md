# Decision: SHA-256 for refresh tokens, bcrypt for passwords

**Context:** Both passwords and refresh tokens are stored as hashes, but they are different kinds of secret.

**Options considered:**
1. bcrypt for both.
2. SHA-256 for refresh tokens, bcrypt for passwords.

**Decision:** bcrypt at cost 12 for passwords. Plain SHA-256 for refresh tokens.

**Why:** A password is short and human-chosen, so it needs a slow, salted hash to resist brute-forcing. A refresh token is already a random 256-bit value - nothing to brute-force - and it needs to be looked up by exact match on every refresh call, which a slow hash would make needlessly expensive at scale. Using bcrypt everywhere would be safe but wasteful; using SHA-256 for passwords would be genuinely unsafe. The right hash depends on what is being hashed, not a single default.
