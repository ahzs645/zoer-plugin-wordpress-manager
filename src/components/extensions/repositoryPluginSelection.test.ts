import {test,expect} from 'bun:test';
import {sourcesForPlugin,repositoryForPlugin,canDevelopInstalledPlugin} from './repositoryPluginSelection';
const sources=[{id:'campus',name:'Campus',linked:true,link:{repoId:'campus',siteId:'local-a',slug:'campus-manager',folder:'dist/campus-manager'}},{id:'other',name:'Other',linked:false,link:{repoId:'other',siteId:'local-b',slug:'campus-manager',folder:'.'}},{id:'empty',name:'Empty',linked:false,link:null}];
test('installed-plugin context selects its exact link and excludes other-site/other-plugin links',()=>{
 expect(repositoryForPlugin(sources,'local-a','campus-manager','empty')).toBe('campus');
 expect(sourcesForPlugin(sources,'local-a','campus-manager').map(s=>s.id)).toEqual(['campus','empty']);
 expect(repositoryForPlugin(sources,'local-a','another-plugin','campus')).toBeNull();
 expect(repositoryForPlugin(sources,'local-a','another-plugin','empty')).toBe('empty');
 expect(repositoryForPlugin(sources,'local-b','campus-manager','campus')).toBe('other');
 expect(repositoryForPlugin([], 'local-a','campus-manager','campus')).toBeNull();
});
test('development applies to ordinary local plugins only',()=>{
 expect(canDevelopInstalledPlugin('ddev','plugin','active','campus-manager')).toBe(true);
 expect(canDevelopInstalledPlugin('ddev','plugin','inactive','campus-manager')).toBe(true);
 for(const [provider,kind,status,slug] of [['hostinger','plugin','active','campus-manager'],['zoer-connect','plugin','active','campus-manager'],['ddev','theme','active','campus-manager'],['ddev','plugin','must-use','campus-manager'],['ddev','plugin','dropin','campus-manager'],['ddev','plugin','active','zoer-connect']])expect(canDevelopInstalledPlugin(provider!,kind!,status!,slug!)).toBe(false);
});
