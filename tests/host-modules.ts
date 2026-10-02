import { mock } from "bun:test";
// Pure policy/helper tests import components; their shared controls are supplied
// by Zoer only at runtime. No backend calls or rendered UI are mocked here.
const empty=()=>null;
mock.module("@zoer/plugin-ui/controls",()=>Object.fromEntries(["Btn","Select","Modal","ModalSurface","useDialogs","ActionMenu","StatusBadge","PageTabs","PageTabPanel","EmptyState","SearchInput","Tooltip","CheckboxField","DateInput","controlClass","selectClass","textareaClass","fieldLabelClass","checkboxClass","radioClass"].map(key=>[key,empty])));
mock.module("@zoer/plugin-ui/workspace",()=>({getApiBase:()=>"/api",isDemoMode:()=>false,useResourceSelection:empty,useOperationSession:empty,PluginPage:empty,ResourceBrowserView:empty}));
