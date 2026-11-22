# Local WordPress Playground demo

This development demo runs the WordPress Manager package in Zoer with a disposable local WordPress site. Use Bun and Node.js 24.18 or later. The first Playground run downloads WordPress and its SQLite integration.

From the WordPress Manager checkout, install the dependencies and build the package and demo fixture.

```sh
bun install --frozen-lockfile
bun run demo:build
bun run demo:playground
```

Leave Playground running. It listens on `127.0.0.1:9417` and saves WordPress content and its SQLite database in `dist/playground/wp-content`. A network that uses an HTTP proxy for downloads may require `NODE_USE_ENV_PROXY=1 bun run demo:playground`.

In a second terminal, start [Zoer’s local demo](https://github.com/ahzs645/zoer/blob/main/docs/demo-workspace.md) using this checkout’s absolute `dist/package` path. Open **WordPress** as the demo admin, select the Playground site, and choose **WordPress admin** to edit the sample. The WordPress Manager display-name edit is saved separately in your browser. Transfers, provider accounts, backups, and lifecycle actions require a full Zoer host.

The fixture is built to `dist/demo/index.mjs` alongside `dist/package`. A normal plugin build or release ships the plugin package only.
