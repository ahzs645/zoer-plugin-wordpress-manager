#!/usr/bin/env bun
// WordPress Manager plugin transfer engine (0.7.1, docs/plugin-shared-services.md 16.5 P3).
// Every action runs only for sites the user switched to the plugin engine and confirmed as
// non-production test targets; the legacy host engine stays the default for every site.
import { failure } from "./lib/slices.js";
import { finish, openLineHost } from "./lib/host.js";
import { runTransferAction } from "./lib/actions.js";

const { request, host, close } = await openLineHost();
let response;
try { response = { ok: true, output: await runTransferAction(request, host) }; }
catch (error) { response = failure(error); }
close();
finish(request, response);
