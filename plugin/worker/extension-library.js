import { openLineHost, finish } from "./lib/host.js";
import { libraryOperation } from "./lib/extension-library-operations.js";
const { request, host } = await openLineHost();
try { finish(request, { ok: true, output: await libraryOperation(host, request.action.id, request.input) }); }
catch (error) { finish(request, { ok: false, error: { code: "library_failed", message: error.message } }); }
