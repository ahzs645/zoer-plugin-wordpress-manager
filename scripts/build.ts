import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import postcss from "postcss";
import { init, parse } from "es-module-lexer";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Builds the installable package: manifest, workers and the native workspace
// module Zoer loads into its page (see zoer docs/plugin-sources.md).
const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist/package");
const SCOPE = ".zoer-native-wordpress-manager";
// Must match zoer packages/api-types/src/native-workspace.ts NATIVE_WORKSPACE_SHARED_MODULES.
const SHARED = ["react", "react/jsx-runtime", "react-dom", "@tanstack/react-query", "@zoer/plugin-ui/analysis", "@zoer/plugin-ui/button", "@zoer/plugin-ui/controls", "@zoer/plugin-ui/database", "@zoer/plugin-ui/workspace"];

const built = await build({
  configFile: false,
  root,
  mode: "production",
  logLevel: "warn",
  plugins: [tailwindcss(), react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    write: false,
    minify: true,
    cssCodeSplit: false,
    lib: { entry: resolve(root, "src/index.tsx"), formats: ["es"], fileName: () => "index.js" },
    rollupOptions: {
      external: (id) => SHARED.includes(id),
      output: { inlineDynamicImports: true, assetFileNames: "[name][extname]" },
    },
  },
});
const result = Array.isArray(built) ? built[0] : built;
if (!result || !("output" in result)) throw new Error("Unexpected build output.");
const js = result.output.filter(item => item.type === "chunk").map(item => item.code).join("\n");
// Same parser the Zoer backend uses before serving the module (plugin-native-workspace.ts).
await init;
const [imports] = parse(js);
// d: -1 static import, -2 import.meta (allowed by Zoer), >= 0 dynamic import().
const dynamic = imports.filter(item => item.d >= 0);
if (dynamic.length) throw new Error(`Native module must not use dynamic import(): ${dynamic.map(item => JSON.stringify(js.slice(Math.max(0, item.ss - 80), item.se + 40))).join(" | ")}`);
const unexpected = imports.filter(item => item.d === -1).map(item => item.n ?? "<computed>").filter(specifier => !SHARED.includes(specifier));
if (unexpected.length) throw new Error(`Native module imports non-shared modules: ${[...new Set(unexpected)].join(", ")}`);
if (js.includes("/Users/")) throw new Error("Native module contains a local path.");

const css = result.output.flatMap(item => item.type === "asset" && item.fileName.endsWith(".css") ? [String(item.source)] : []).join("\n");
const tree = postcss.parse(css);
// @property must stay global; everything else is scoped so the package cannot restyle Zoer.
const globals: string[] = [];
tree.walkAtRules("property", rule => { globals.push(rule.toString()); rule.remove(); });
tree.walkRules(rule => { rule.selector = rule.selector.replace(/:root|:host|\bhtml\b|\bbody\b/g, ":scope"); });
const scoped = `${globals.join("\n")}\n@scope (${SCOPE}) {\n${tree.toString()}\n}\n`;

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "native"), { recursive: true });
await cp(resolve(root, "plugin/manifest.json"), resolve(output, "manifest.json"));
await cp(resolve(root, "plugin/worker"), resolve(output, "worker"), { recursive: true });
await writeFile(resolve(output, "native/index.js"), js);
await writeFile(resolve(output, "native/style.css"), scoped);
const manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));
console.log(`WordPress ${manifest.version}: ${output} (module ${(js.length / 1024).toFixed(0)} KiB, style ${(scoped.length / 1024).toFixed(0)} KiB)`);
