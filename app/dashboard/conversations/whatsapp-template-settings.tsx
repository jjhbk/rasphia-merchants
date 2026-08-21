"use client";

import { FormEvent, useEffect, useState } from "react";

type Template = { name: string; language: string; category: string; components: unknown[] };
type TemplateReference = { name: string; language: string };
type TemplateConfig = { booking?: TemplateReference; payment?: TemplateReference; followUp?: TemplateReference };
const slots = [
  ["booking", "Booking updates", "Confirmed bookings, reminders, and changes."],
  ["payment", "Payment updates", "Payment links, confirmations, and subscription notices."],
  ["followUp", "Customer follow-up", "Approved re-engagement and service follow-up."],
] as const;

function keyOf(template?: TemplateReference) { return template ? `${template.name}:${template.language}` : ""; }
function fromKey(value: string): TemplateReference | undefined { if (!value) return undefined; const divider = value.lastIndexOf(":"); return divider < 1 ? undefined : { name: value.slice(0, divider), language: value.slice(divider + 1) }; }

export function WhatsAppTemplateSettings({ connected, initialConfig }: { connected: boolean; initialConfig: TemplateConfig }) {
  const [templates, setTemplates] = useState<Template[]>([]); const [config, setConfig] = useState<TemplateConfig>(initialConfig); const [loading, setLoading] = useState(connected); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { if (!connected) return; fetch("/api/integrations/whatsapp/templates").then(async (response) => { const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error || "Templates could not be loaded."); setTemplates(data.templates || []); }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false)); }, [connected]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(""); setNotice(""); const response = await fetch("/api/integrations/whatsapp/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) }); const data = await response.json().catch(() => null); setSaving(false); if (!response.ok) { setError(data?.error || "Template choices could not be saved."); return; } setConfig(data.templateConfig); setNotice("Template choices saved."); }
  return <section className="payment-offerings template-settings"><p className="section-label">Approved WhatsApp templates</p><h2>Choose messages Rasphia can send.</h2><p>Only templates approved in your WhatsApp Business Account are available here. Select the right template for each customer update; leave a field empty to keep it off.</p>{!connected ? <p className="setup-note">Enable WhatsApp routing above before choosing templates.</p> : loading ? <p className="setup-note">Loading approved templates…</p> : <form className="payment-connect-form" onSubmit={submit}><div className="template-grid">{slots.map(([slot, title, description]) => <label key={slot}><span>{title}</span><small>{description}</small><select value={keyOf(config[slot])} onChange={(event) => setConfig((current) => ({ ...current, [slot]: fromKey(event.target.value) }))}><option value="">Do not send this update</option>{templates.map((template) => <option key={`${template.name}:${template.language}`} value={`${template.name}:${template.language}`}>{template.name} · {template.language} · {template.category}</option>)}</select></label>)}</div>{!templates.length && <p className="form-hint">No approved templates were found. Create and approve them in WhatsApp Manager, then refresh this page.</p>}<button className="button button-gold" disabled={saving || !templates.length}>{saving ? "Saving…" : "Save template choices"}</button>{notice && <p className="form-success">{notice}</p>}{error && <p className="form-error">{error}</p>}</form>}</section>;
}
