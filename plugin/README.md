# WordPress Manager package

This directory contains the declarative manifest and isolated workers packaged with the native interface from `src/`. See [the repository README](../README.md) for the current features, host API contract, build/release commands and provider limitations.

Keep the plugin ID `wordpress-manager` and existing action IDs. DDEV workers use scoped rotating runtime tickets; they never receive the bridge token or database credentials. The package's React interface uses the reviewed WordPress host API and generic shared controls. Production publishing/restores remain host-owned operations with recovery, fingerprint and confirmation checks.
