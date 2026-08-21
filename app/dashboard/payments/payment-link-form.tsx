"use client";

import { FormEvent, useState } from "react";

type Offering = { id: string; name: string; paymentType: string; amount: number; currency: string; interval: string | null };

export function PaymentLinkForm({ offerings }: { offerings: Offering[] }) {
  const [status, setStatus] = useState<"idle" | "creating" | "error">("idle"); const [error, setError] = useState(""); const [link, setLink] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setStatus("creating"); setError(""); setLink(""); const form = new FormData(event.currentTarget); const response = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offeringId: form.get("offeringId"), customerName: form.get("customerName"), customerEmail: form.get("customerEmail"), customerPhone: form.get("customerPhone") }) }); const data = await response.json(); if (!response.ok) { setStatus("error"); setError(data.error || "We couldn’t create the customer link."); return; } setStatus("idle"); setLink(data.url); }
  if (!offerings.length) return <p className="setup-note">Save an offer above before creating a customer payment or subscription link.</p>;
  return <form className="payment-connect-form" onSubmit={submit}><label>Offer<select name="offeringId" required defaultValue=""><option value="" disabled>Select an offer</option>{offerings.map((offering) => <option key={offering.id} value={offering.id}>{offering.name} · {(offering.amount / 100).toFixed(2)} {offering.currency}{offering.paymentType === "recurring" ? ` / ${offering.interval}` : ""}</option>)}</select></label><div className="field-row"><label>Customer name<input name="customerName" required autoComplete="name" /></label><label>Customer email<input name="customerEmail" type="email" required autoComplete="email" /></label></div><label>Customer phone <span>(optional)</span><input name="customerPhone" type="tel" autoComplete="tel" /></label><button className="button button-gold" disabled={status === "creating"}>{status === "creating" ? "Creating link…" : "Create customer link"}</button>{link && <p className="form-success">Ready to share: <a href={link} target="_blank" rel="noreferrer">Open secure checkout</a></p>}{error && <p className="form-error">{error}</p>}</form>;
}
