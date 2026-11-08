# Validation scope and local commands

Feature validation runs on pull requests and main, with cancellation for superseded validation. The separate release workflow is unchanged. Retain pinned public submodule preparation, digest-verified scanner runtime and all package checks.

## Local entry points

```sh
git submodule update --init wordpress-plugins/zoer-connect
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun tools/zoer-plugin.mjs validate dist/package
bun run release
```

Feature branches without an open PR use local commands. A local pass does not replace validation of the submitted revision. Main/release publication keeps the workflow's existing authorization and artifact conditions.

CI optimization batch: November 7, 2026. Workflow syntax and focused orchestration/selection checks are separate from complete application, native-platform and research validation.
