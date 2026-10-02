// Types for the host modules Zoer supplies to native workspaces at runtime
// (NATIVE_WORKSPACE_SHARED_MODULES). The plugin never bundles these.
declare module "@zoer/plugin-ui/button" {
  import type { ReactNode, MouseEvent } from "react";
  export interface BtnProps {
    children: ReactNode;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md";
    icon?: ReactNode;
    loading?: boolean;
    iconOnly?: boolean;
    disabled?: boolean;
    onClick?: (event: MouseEvent) => void;
    className?: string;
    type?: "button" | "submit";
    form?: string;
    tooltip?: string;
    "aria-label"?: string;
    "aria-expanded"?: boolean;
    "aria-describedby"?: string;
  }
  export default function Btn(props: BtnProps): JSX.Element;
  export function buttonClassName(variant?: BtnProps["variant"], size?: BtnProps["size"], className?: string): string;
}

declare module "@zoer/plugin-ui/controls" {
  import type { ReactNode, RefObject, SelectHTMLAttributes, ComponentPropsWithoutRef } from "react";
  export { default as Btn } from "@zoer/plugin-ui/button";
  export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    controlSize?: "compact" | "default";
    presentation?: "modal" | "dropdown";
    dropdownWidth?: number;
    searchable?: boolean;
    optionDetails?: Record<string, { icon?: ReactNode; description?: string; keywords?: string }>;
    variant?: "field" | "ghost";
    iconOnly?: boolean;
    placeholder?: string;
  }
  export function Select(props: SelectProps): JSX.Element;
  export function Modal(props: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    headerContent?: ReactNode;
    mobileSheet?: boolean;
    size?: "sm" | "md" | "lg" | "xl" | "full" | "wide";
    hostOverlay?: boolean;
    "aria-describedby"?: string;
  }): JSX.Element;
  export function ModalSurface(props: Omit<ComponentPropsWithoutRef<"dialog">, "open" | "onClose"> & {
    onClose: () => void;
    initialFocusRef?: RefObject<HTMLElement | null>;
    hostOverlay?: boolean;
  }): JSX.Element;
  type Tone = "default" | "danger";
  export function DialogProvider(props: { children: ReactNode }): JSX.Element;
  export function useDialogs(): {
    alert(options: { title: string; description?: string; confirmLabel?: string; tone?: Tone }): Promise<void>;
    confirm(options: { title: string; description?: string; confirmLabel?: string; cancelLabel?: string; tone?: Tone }): Promise<boolean>;
    prompt(options: { title: string; description?: string; label?: string; defaultValue?: string; placeholder?: string; inputType?: "text" | "password"; submitLabel?: string; cancelLabel?: string; tone?: Tone }): Promise<string | null>;
  };
}

declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
declare module "@zoer/plugin-ui/controls" {
 import type {ReactNode, ReactElement} from "react";
 export type ControlSize="compact"|"default";
 export function controlClass(size?:ControlSize,className?:string):string;
 export function selectClass(size?:ControlSize,className?:string):string;
 export function textareaClass(size?:ControlSize,className?:string):string;
 export const fieldLabelClass:string,checkboxClass:string,radioClass:string;
 export type StatusTone="success"|"running"|"warning"|"error"|"info"|"neutral";
 export function StatusBadge(props:{children:ReactNode;tone?:StatusTone;variant?:"pill"|"dot";icon?:ReactNode;className?:string}):ReactElement;
 export interface ActionMenuItem {label:string;icon?:ReactNode;onClick:()=>void;disabled?:boolean;loading?:boolean;tone?:"default"|"danger";}
 export function ActionMenu(props:{label:string;items:ActionMenuItem[];trigger?:"icon"|"text";triggerLabel?:string;size?:"sm"|"md";className?:string}):ReactElement;
 export function EmptyState(props:{icon?:ReactNode;title:string;description?:string;action?:ReactNode}):ReactElement;
 export function SearchInput(props:{value:string;onChange:(value:string)=>void;placeholder?:string;ariaLabel?:string;inputId?:string;className?:string;inputClassName?:string;size?:ControlSize}):ReactElement;
 export function PageTabs<T extends string>(props:{id:string;label:string;tabs:readonly {id:T;label:string}[];value:T;onChange:(value:T)=>void;href?:(value:T)=>string}):ReactElement;
 export function PageTabPanel(props:{id:string;value:string;className?:string;children:ReactNode}):ReactElement;
 export function Tooltip(props:{content:ReactNode;children:ReactElement;side?:"top"|"bottom"|"left"|"right";className?:string;persistOnClick?:boolean;delay?:number}):ReactElement;
 export function CheckboxField(props:{checked:boolean;onChange:(value:boolean)=>void;label:string;description?:string;disabled?:boolean;className?:string}):ReactElement;
 export function DateInput(props:{value:string;onChange:(value:string)=>void;label?:string;disabled?:boolean}):ReactElement;
}
declare module "@zoer/plugin-ui/workspace" {
 import type {ReactNode,ReactElement,Dispatch,SetStateAction} from "react";
 export function PluginPage(props:{title:string;badge?:string|number;actions?:Array<{label:string;icon?:ReactNode;onClick:()=>void;disabled?:boolean;loading?:boolean;tone?:"default"|"danger"}>;primary?:ReactNode;tabs?:ReactNode;width?:"default"|"narrow"|"full";fill?:boolean;onBack?:()=>void;backLabel?:string;children:ReactNode}):ReactElement;
 export function ResourceBrowserView(props:{id:string;provider:string;name:string;presentation?:"browser"|"focused"}):ReactElement;
 export function useResourceSelection<T extends string|null>(key:string,fallback:T,allowed?:readonly string[],mode?:"push"|"replace"):[T,Dispatch<SetStateAction<T>>];
 export function useOperationSession():{isCurrent:()=>boolean;assertCurrent:()=>void};
 export function getApiBase():string;
 export function isDemoMode():boolean;
}
