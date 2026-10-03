# Running the program tests

Anchor 1.2 defaults to `surfpool` as its local validator. This workspace uses
the `solana-test-validator` that ships with the Agave CLI instead, so the tests
need a validator already running:

```bash
source ../scripts/env.sh

# terminal 1
solana-test-validator --ledger test-ledger --reset --quiet

# terminal 2
anchor test --skip-local-validator
```

Deadlines in the suite are ~8 seconds out and the tests really wait for them,
so the whole run takes about a minute.
