import type { ImportOptions, ZoerConnectCapabilities } from "../../../lib/api/types/wordpress-transfer";
import { hasCapability, REQUIRES_040 } from "../../../lib/wordpress-transfer/options";
import { radioClass } from "@zoer/plugin-ui/controls";
import { safetySummary } from "./transferLabels";
import { OptionToggle, TransferPanel, Unavailable } from "./TransferPanel";

export default function SafetyPanel({ options, onChange, caps, lockFence = false, defaultOpen = false }: { options: ImportOptions; onChange: (options: ImportOptions) => void; caps?: ZoerConnectCapabilities; lockFence?: boolean; defaultOpen?: boolean }) {
  const late = hasCapability(caps, "lateFence") ? null : REQUIRES_040;
  const purge = hasCapability(caps, "cachePurge") ? null : REQUIRES_040;
  const choices = [
    { value: "activation" as const, label: "Keep site online while staging (recommended)", description: "Tables are staged while visitors keep using the site. WordPress pauses only while files are applied and tables swap. If the live site changes during staging, activation stops safely.", disabled: !!late },
    { value: "early" as const, label: "Pause site for the whole import", description: options.review ? "Not available with “Review changes before applying”." : "WordPress requests pause from the start of the import until you finish or roll back.", disabled: options.review || lockFence },
  ];
  return <TransferPanel title="Safety" summary={safetySummary(options)} defaultOpen={defaultOpen}>
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1 text-xs font-medium text-text-secondary">Maintenance window</legend>
      {choices.map(choice => <label key={choice.value} className={`flex min-h-11 items-start gap-2.5 rounded-md border border-border-default px-3 py-2.5 text-[13px] ${choice.disabled ? "opacity-60" : "cursor-pointer hover:bg-surface-hover"}`}>
        <input type="radio" name="zoer-transfer-fence" className={`${radioClass} mt-0.5`} checked={options.fence === choice.value} disabled={choice.disabled} onChange={() => onChange({ ...options, fence: choice.value })} />
        <span className="min-w-0"><span className="block text-text-primary">{choice.label}</span><span className="mt-0.5 block text-[12px] leading-4 text-text-muted">{choice.description}</span></span>
      </label>)}
      <Unavailable reason={late ? `${late}. Older plugins pause the site for the whole import` : null} />
    </fieldset>
    <OptionToggle label="Purge page caches after finishing" description="Calls LiteSpeed, WP Rocket, W3 Total Cache, WP Super Cache and other cache plugins, then flushes the object cache." checked={options.purgeCaches} onChange={value => onChange({ ...options, purgeCaches: value })} unavailable={purge} />
  </TransferPanel>;
}
