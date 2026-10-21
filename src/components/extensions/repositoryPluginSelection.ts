export interface RepositoryPluginLink {repoId:string;siteId:string;slug:string;folder:string;kind?:"plugin"|"theme";id?:string}
/** `links`: every link of the repository (Zoer builds with several links per repository). */
export interface SiteRepositorySource {id:string;name:string;linked:boolean;link:RepositoryPluginLink|null;links?:RepositoryPluginLink[]}
const linksOf=(source:SiteRepositorySource)=>source.links??(source.link?[source.link]:[]);
const isPlugin=(link:RepositoryPluginLink,siteId:string,slug:string)=>link.siteId===siteId&&link.slug===slug&&link.kind!=="theme";
/**
 * A plugin's repository choice must never silently reuse another site's link. A repository linked
 * only to other folders of this site can add this plugin (a theme and its companion plugin).
 */
export function sourcesForPlugin(sources:SiteRepositorySource[],siteId:string,_slug:string) {
 return sources.filter(source=>linksOf(source).every(link=>link.siteId===siteId));
}
export function repositoryForPlugin(sources:SiteRepositorySource[],siteId:string,slug:string,selected:string|null) {
 const available=sourcesForPlugin(sources,siteId,slug);
 return available.find(source=>linksOf(source).some(link=>isPlugin(link,siteId,slug)))?.id
  ??available.find(source=>source.id===selected)?.id??null;
}
/** The repository already linked to this local site, so opening its Development tab shows it. */
export function repositoryLinkedToSite(sources:SiteRepositorySource[],siteId:string|null) {
 return siteId?sources.find(source=>linksOf(source).some(link=>link.siteId===siteId))?.id??null:null;
}
export function canDevelopInstalledPlugin(provider:string,kind:string,status:string,slug:string) {
 return (provider==='ddev'||provider==='kubernetes')&&kind==='plugin'&&(status==='active'||status==='inactive')&&slug!=='zoer-connect';
}
