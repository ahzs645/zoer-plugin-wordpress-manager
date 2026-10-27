import { useEffect, useState } from "react";
import { PluginPage } from "@zoer/plugin-ui/workspace";
import { bindHost, type NativeHost } from "./host/bridge";
import { api } from "./lib/api";
import WordPressManager from "./components/extensions/WordPressManager";
import "./styles.css";
export default function WordPressWorkspace({ host }: { host: NativeHost }) {
 const [state,setState] = useState<string | null>("Loading…");
 useEffect(() => { let active=true; const unbind=bindHost(host);
  api.contract().then(c => { if(c.version!==1) throw new Error("Update Zoer before opening this WordPress plugin."); if(active)setState(null); }).catch(e => {if(active)setState(e.message);});
  return () => { active=false; unbind(); }; }, [host]);
 return <div className="zoer-native-wordpress-manager flex h-full min-h-0 min-w-0 flex-col" data-native-workspace="wordpress-manager">{state ? <PluginPage title="WordPress" fill><p role={state.endsWith("…") ? "status" : "alert"} className={`p-4 text-[13px] ${state.endsWith("…") ? "text-text-muted" : "text-status-error"}`}>{state}</p></PluginPage> : <WordPressManager page="WordPress"/>}</div>;
}
