# WordPress Manager dashboard roadmap

The plugin package owns WordPress-specific dashboard behavior. Zoer core should gain only reusable, host-enforced SDK primitives such as runtime tickets, typed actions, workspaces, and database adapters.

## Live through 0.4

- DDEV site inventory and WordPress/update summary
- Start and stop actions
- DDEV database snapshot list, create, and gated restore actions
- Explicitly allowlisted, argv-based read-only WP-CLI
- Stable credential-free MariaDB links in Zoer's Databases registry
- Shared schema browser and read-only query results
- Host-rendered workspace with no plugin React, HTML, or browser JavaScript
- Host-owned Preview and password-free Admin buttons through the authenticated page proxy
- Site Health, detailed plugin/theme inventories, and a non-secret users table
- Integrity-manifested application backups covering the database and resolved `WP_CONTENT_DIR`
- One-time exact Full access approval and durable receipts for destructive plugin actions
- Host-rendered import of complete single-file UpdraftPlus backup sets into new, isolated WordPress Playground computers
- First-class Sites manager spanning DDEV, Playground inventory, and Hostinger production installations
- DDEV plugin/theme directory search plus exact install, activate, deactivate, update, and uninstall operations
- Pre-change application backup, baseline/post-change Site Health comparison, and automatic DDEV rollback
- Hostinger API connections backed by encrypted Zoer Secrets, test-connection, discovery, and temporary Admin login links
- Hostinger plugin/theme search, mutations, update/vulnerability inventory, website creation, and asynchronous receipt reconciliation
- User-confirmed Hostinger hPanel recovery points required for production update, uninstall, and replacement plans
- Guarded standard-root DDEV to Hostinger archive+SQL publishing through TUS and the official WordPress import API

WordPress Playground continues to use Zoer's normal computer workspace for fast SQLite-backed plugin and theme experiments. The UpdraftPlus importer supports single-site backups with the standard `wp_` prefix; split archives, multisite, MariaDB parity, and a dedicated WP-CLI interface are not advertised.

## Next dashboard slices

1. WordPress core update orchestration and a compatibility matrix before major updates.
2. DDEV/web/database logs and Mailpit inbox summaries.
3. Cron events, debug controls, split-backup/export workflows, and multisite selection.
4. Off-host backup copies, automated restore verification, and a Hostinger backup adapter if the public API adds one.
5. Hostinger staging automation if it becomes available through the public API; until then use a separate target or hPanel handoff.
6. Database merge strategies for WooCommerce/membership production data rather than full replacement.
7. WordPress Abilities API discovery as an additive typed AI-action source, while retaining the WP-CLI fallback.

## Primary references

- [DDEV commands](https://docs.ddev.com/en/stable/users/usage/commands/)
- [DDEV database management](https://docs.ddev.com/en/stable/users/usage/database-management/)
- [WordPress Site Health REST tests](https://developer.wordpress.org/rest-api/reference/wp-site-health-tests/)
- [WP-CLI command reference](https://developer.wordpress.org/cli/commands/)
- [WordPress plugin REST endpoints](https://developer.wordpress.org/rest-api/reference/plugins/)
- [WordPress Application Password authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [WordPress Abilities API](https://developer.wordpress.org/apis/abilities-api/)

## Security invariants

- Never give a plugin the Docker socket, DDEV bridge address/token, runtime path, database password, or ephemeral host port.
- Resolve live DDEV connection details through the trusted adapter rather than persisting them.
- Treat arbitrary WP-CLI, database writes, restore, import, and deletion as Full access operations.
- Audit mutations with actor, site, normalized operation, approval mode, snapshot reference, and redacted result.
- Disabling or uninstalling the plugin may detach registry links but must never delete the underlying WordPress project or database.
