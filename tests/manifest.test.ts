import {expect,test} from "bun:test";
import manifest from "../plugin/manifest.json";
import recipe from "../zoer-plugin.json";
test("package retains WordPress identity, isolated actions, native entrypoint and source recipe",()=>{
 expect(manifest.id).toBe("wordpress-manager");expect(manifest.integration.permissions).toContain("workspace:native");expect(manifest.integration.permissions).toContain("workspace:wordpress");expect(manifest.integration.workspace.native.module).toBe("native/index.js");
 for(const action of manifest.integration.actions)expect(action.execution.kind).toBe("isolated-process");
 expect(manifest.integration.actions.map(a=>a.id)).toContain("site.start");expect(manifest.integration.actions.map(a=>a.id)).toContain("backup.restore");expect(recipe.manifest).toBe("plugin/manifest.json");expect(recipe.package).toBe("dist/package");
});
