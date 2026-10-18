/** Development history labels. */
type DevKind = "plugin" | "theme";
const JOB_LABELS:Record<string,string> = {"create-site":"Create local site",rollback:"Undo","install":"Install from a stack file",capture:"Saved Site Editor changes to the repository","remove-overrides":"Removed Site Editor copies from the local site","restore-overrides":"Restored Site Editor copies"};
/** History label; a rollback is named after what it undid (a code update or a save to the repository). */
export function jobLabel(job:{operation:string;rollbackOf?:string}, jobs:{id:string;operation:string}[], kind:DevKind):string {
  if(job.operation==="rollback"){const target=jobs.find(other=>other.id===job.rollbackOf)?.operation;if(target==="update")return `Rolled back ${kind} code`;if(target==="capture")return "Undid saving Site Editor changes to the repository";}
  return JOB_LABELS[job.operation]??`Local ${kind} update`;
}
