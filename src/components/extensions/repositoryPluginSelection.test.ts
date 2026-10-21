import {test,expect} from 'bun:test';
import {sourcesForPlugin,repositoryForPlugin,repositoryLinkedToSite,canDevelopInstalledPlugin} from './repositoryPluginSelection';
const sources=[{id:'campus',name:'Campus',linked:true,link:{repoId:'campus',siteId:'local-a',slug:'campus-manager',folder:'dist/campus-manager'}},{id:'other',name:'Other',linked:false,link:{repoId:'other',siteId:'local-b',slug:'campus-manager',folder:'.'}},{id:'empty',name:'Empty',linked:false,link:null}];
test('installed-plugin context selects its exact link and excludes other-site/other-plugin links',()=>{
 expect(repositoryForPlugin(sources,'local-a','campus-manager','empty')).toBe('campus');
 expect(sourcesForPlugin(sources,'local-a','campus-manager').map(s=>s.id)).toEqual(['campus','empty']);
 // campus links another folder of this site, so it can add this plugin when chosen.
 expect(repositoryForPlugin(sources,'local-a','another-plugin','campus')).toBe('campus');
 expect(repositoryForPlugin(sources,'local-a','another-plugin','other')).toBeNull();
 expect(repositoryForPlugin(sources,'local-a','another-plugin','empty')).toBe('empty');
 expect(repositoryForPlugin(sources,'local-b','campus-manager','campus')).toBe('other');
 expect(repositoryForPlugin([], 'local-a','campus-manager','campus')).toBeNull();
});
test('several links: a theme link on the same site does not claim the plugin folder of the same name',()=>{
 const many=[{id:'theme-and-plugin',name:'Acme',linked:true,link:null,links:[{repoId:'theme-and-plugin',siteId:'local-a',slug:'acme',folder:'theme',kind:'theme' as const},{repoId:'theme-and-plugin',siteId:'local-a',slug:'acme-blocks',folder:'plugin'}]},{id:'split',name:'Split',linked:false,link:null,links:[{repoId:'split',siteId:'local-a',slug:'x',folder:'.'},{repoId:'split',siteId:'local-b',slug:'y',folder:'.'}]}];
 expect(sourcesForPlugin(many,'local-a','acme-blocks').map(s=>s.id)).toEqual(['theme-and-plugin']);
 expect(repositoryForPlugin(many,'local-a','acme-blocks',null)).toBe('theme-and-plugin');
 expect(repositoryForPlugin(many,'local-a','acme',null)).toBeNull();
 expect(repositoryLinkedToSite(many,'local-b')).toBe('split');
});
test('development applies to ordinary local plugins only',()=>{
 expect(canDevelopInstalledPlugin('ddev','plugin','active','campus-manager')).toBe(true);
 expect(canDevelopInstalledPlugin('ddev','plugin','inactive','campus-manager')).toBe(true);
 expect(canDevelopInstalledPlugin('kubernetes','plugin','active','campus-manager')).toBe(true);
 for(const [provider,kind,status,slug] of [['hostinger','plugin','active','campus-manager'],['zoer-connect','plugin','active','campus-manager'],['ddev','theme','active','campus-manager'],['ddev','plugin','must-use','campus-manager'],['ddev','plugin','dropin','campus-manager'],['ddev','plugin','active','zoer-connect']])expect(canDevelopInstalledPlugin(provider!,kind!,status!,slug!)).toBe(false);
});
test('a linked local site opens on its repository',()=>{
 expect(repositoryLinkedToSite(sources,'local-a')).toBe('campus');
 expect(repositoryLinkedToSite(sources,'local-b')).toBe('other');
 expect(repositoryLinkedToSite(sources,'local-c')).toBeNull();
 expect(repositoryLinkedToSite(sources,null)).toBeNull();
});
