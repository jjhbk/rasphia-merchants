"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { SUPPORTED_TIMEZONES } from "../../../lib/timezones";

type Service = { id: string; name: string; description: string | null; duration: number };
type Draft = { id: string; name: string; description: string; duration: number };
type Profile = { name: string; type: string; timezone: string; email: string };
const emptyDraft = (): Draft => ({ id: "", name: "", description: "", duration: 30 });

export function BookingPageForm({ services, publicUrl, profile }: { services: Service[]; publicUrl: string; profile: Profile }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveBookingSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    const response = await fetch("/api/workspace/booking-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    const result = await response.json().catch(() => null); setSaving(false);
    if (!response.ok) { setError(result?.error || "Could not update booking settings."); return; }
    setNotice("Booking page details updated."); router.refresh();
  }

  function edit(service: Service) { setDraft({ id: service.id, name: service.name, description: service.description || "", duration: service.duration }); setNotice(""); setError(""); document.getElementById("booking-service-form")?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function cancelEdit() { setDraft(emptyDraft()); setNotice(""); setError(""); }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    const response = await fetch("/api/workspace/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id || undefined, name: draft.name, description: draft.description, duration: draft.duration }) });
    const result = await response.json().catch(() => null); setSaving(false);
    if (!response.ok) { setError(result?.error || "Could not save service."); return; }
    const edited = Boolean(draft.id); setDraft(emptyDraft()); setNotice(edited ? "Booking service updated." : "Booking service added."); router.refresh();
  }

  async function remove(id: string) { const response = await fetch(`/api/workspace/services?id=${id}`, { method: "DELETE" }); if (!response.ok) { setError("Could not remove service."); return; } if (draft.id === id) setDraft(emptyDraft()); router.refresh(); }

  return <>
    <section className="payment-offerings settings-card">
      <p className="section-label">Booking page details</p><h2>Edit the details set during onboarding.</h2>
      <form className="payment-connect-form" onSubmit={saveBookingSettings}>
        <label>Business name<input name="businessName" defaultValue={profile.name} required /></label>
        <label>Business type<input name="businessType" defaultValue={profile.type} required /></label>
        <div className="field-row">
          <label>Booking timezone<select name="timezone" defaultValue={profile.timezone}>{SUPPORTED_TIMEZONES.map(([zone, label]) => <option key={zone} value={zone}>{label} · {zone}</option>)}</select></label>
          <label>Notification email<input name="businessEmail" type="email" defaultValue={profile.email} required /></label>
        </div>
        <button className="button button-gold" disabled={saving}>{saving ? "Saving…" : "Save booking page details"}</button>
      </form>
    </section>

    <section className="payment-offerings settings-card">
      <p className="section-label">Bookable services</p><h2>Services on your booking page.</h2>
      {services.length ? services.map((service) => <div className="settings-service" key={service.id}><div><b>{service.name}</b><p>{service.description || "No description"} · {service.duration} minutes</p></div><div className="settings-service-actions"><button className="text-button" type="button" onClick={() => edit(service)}>Edit</button><button className="text-button danger" type="button" onClick={() => remove(service.id)}>Remove</button></div></div>) : <p className="setup-note">Add your first service to make the public booking page bookable.</p>}
      <form id="booking-service-form" className="payment-connect-form" onSubmit={saveService}>
        <div className="payment-form-heading"><div><p className="section-label">{draft.id ? "Editing service" : "Add a service"}</p><h2>{draft.id ? draft.name : "Create a bookable offering"}</h2></div>{draft.id && <button className="text-button" type="button" onClick={cancelEdit}>Cancel editing</button>}</div>
        <div className="field-row"><label>Service name<input required placeholder="Consultation" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label><label>Duration<input type="number" min="5" max="480" required value={draft.duration} onChange={(event) => setDraft((current) => ({ ...current, duration: Number(event.target.value) }))} /></label></div>
        <label>Description <span>(optional)</span><textarea rows={3} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
        <button className={draft.id ? "button button-gold" : "button button-outline"} disabled={saving}>{saving ? "Saving…" : draft.id ? "Save service changes" : "Add service"}</button>
      </form>
      {notice && <p className="form-success">{notice}</p>}{error && <p className="form-error">{error}</p>}
    </section>

    <section className="public-url-card"><p className="section-label">Your public booking page</p><h2>Share this link with customers.</h2><a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl} ↗</a></section>
  </>;
}
