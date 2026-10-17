export interface RepositoryPluginLink {repoId:string;siteId:string;slug:string;folder:string}
export interface SiteRepositorySource {id:string;name:string;linked:boolean;link:RepositoryPluginLink|null}
/** A plugin's repository choice must never silently reuse another site's link. */
export function sourcesForPlugin(sources:SiteRepositorySource[],siteId:string,slug:string) {
 return sources.filter(source=>!source.link||(source.link.siteId===siteId&&source.link.slug===slug));
}
export function repositoryForPlugin(sources:SiteRepositorySource[],siteId:string,slug:string,selected:string|null) {
 const available=sourcesForPlugin(sources,siteId,slug);
 return available.find(source=>source.link?.siteId===siteId&&source.link.slug===slug)?.id
  ??available.find(source=>source.id===selected)?.id??null;
}
/** The repository already linked to this local site, so opening its Development tab shows it. */
export function repositoryLinkedToSite(sources:SiteRepositorySource[],siteId:string|null) {
 return siteId?sources.find(source=>source.link?.siteId===siteId)?.id??null:null;
}
export function canDevelopInstalledPlugin(provider:string,kind:string,status:string,slug:string) {
 return provider==='ddev'&&kind==='plugin'&&(status==='active'||status==='inactive')&&slug!=='zoer-connect';
}
