"use client";

import { useState } from "react";

export function InterestForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_URL;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setStatus("sending"); setError("");
    try {
      const response = await fetch("/api/merchant-interest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "Something went wrong. Please try again."); setStatus("error"); return; }
      form.reset(); setStatus("success");
    } catch {
      setError("We couldn't reach the server. Please try again.");
      setStatus("error");
    }
  }

  return <div className="interest-grid">
    <form className="interest-form" onSubmit={submit}>
      <div className="field-row"><label>Your name<input required name="name" autoComplete="name" /></label><label>Business name<input required name="businessName" autoComplete="organization" /></label></div>
      <div className="field-row"><label>Email<input required type="email" name="email" autoComplete="email" /></label><label>Phone <span>(optional)</span><input name="phone" type="tel" autoComplete="tel" /></label></div>
      <label>What kind of business do you run?<input name="businessType" placeholder="Salon, studio, local brand…" /></label>
      <label>Anything you&apos;d like us to know? <span>(optional)</span><textarea name="message" rows={3} /></label>
      <button className="button button-gold" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Register interest"}</button>
      {status === "success" && <p className="form-success" role="status">You&apos;re on the list — we&apos;ll be in touch shortly.</p>}
      {status === "error" && <p className="form-error" role="alert">{error}</p>}
    </form>
    <aside className="schedule-card"><p className="section-label">Prefer a conversation?</p><h3>Choose a time that works for you.</h3><p>Book a no-pressure 20-minute call and we&apos;ll show you how your business could appear in AI answers.</p>{calendlyUrl ? <a className="button button-dark" href={calendlyUrl} target="_blank" rel="noreferrer">Schedule a call ↗</a> : <p className="setup-note">Add <code>NEXT_PUBLIC_CALENDLY_URL</code> to enable scheduling.</p>}</aside>
  </div>;
}
