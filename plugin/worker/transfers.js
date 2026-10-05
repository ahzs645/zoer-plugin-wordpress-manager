#!/usr/bin/env bun
// WordPress Manager transfer engine (docs/plugin-shared-services.md 16.5 P3/P4). Since 0.8.0 it is
// the only transfer engine: every action runs for any managed site; Zoer's legacy host engine is gone.
import { failure } from "./lib/slices.js";
import { finish, openLineHost } from "./lib/host.js";
import { runTransferAction } from "./lib/actions.js";

const { request, host, close } = await openLineHost();
let response;
try { response = { ok: true, output: await runTransferAction(request, host) }; }
catch (error) { response = failure(error); }
close();
finish(request, response);
