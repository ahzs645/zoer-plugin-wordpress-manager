import { useEffect, useState } from "react";
import { bindHost, type NativeHost } from "./host/bridge";
import { api } from "./lib/api";
import WordPressManager from "./components/extensions/WordPressManager";
import "./styles.css";
export default function WordPressWorkspace({ host }: { host: NativeHost }) {
 const [state,setState] = useState<string | null>("Connecting WordPress…");
 useEffect(() => { let active=true; const unbind=bindHost(host);
  api.contract().then(c => { if(c.version!==1) throw new Error("Update Zoer before opening this WordPress plugin."); if(active)setState(null); }).catch(e => {if(active)setState(e.message);});
  return () => { active=false; unbind(); }; }, [host]);
 return <div className="zoer-native-wordpress-manager flex h-full min-h-0 min-w-0 flex-col" data-native-workspace="wordpress-manager">{state ? <p role="status" className="p-6 text-sm">{state}</p> : <WordPressManager page="WordPress"/>}</div>;
}
