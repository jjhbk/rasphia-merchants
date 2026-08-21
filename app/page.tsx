"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { InterestForm } from "./components/interest-form";

const capabilities = [
  { number: "01", title: "Capture every enquiry", copy: "Give customers one clear path from WhatsApp or your public booking page into a customer record your team can act on.", proof: "WhatsApp routing · Native booking page · Customer database" },
  { number: "02", title: "Book without the back-and-forth", copy: "Show the services you offer, collect customer details, reserve the time, and send a Google Calendar invitation automatically.", proof: "Service catalogue · Google Calendar · Confirmations" },
  { number: "03", title: "Follow up at the right moment", copy: "Keep customers informed through email and WhatsApp—from booking reminders to reactivation and post-service updates.", proof: "Email · Approved WhatsApp templates · Scheduled updates" },
  { number: "04", title: "Collect and track revenue", copy: "Send secure one-time, deposit, package, or subscription links and see who paid without chasing spreadsheets.", proof: "Stripe · Razorpay · Payment ledger" },
];

const outcomes = [
  { label: "Growth", title: "Respond while intent is high.", copy: "Turn new enquiries into qualified conversations and bookings before they go cold." },
  { label: "Retention", title: "Give customers a reason to return.", copy: "Automate reminders, rebooking, renewals, recalls, and thoughtful follow-ups." },
  { label: "Revenue", title: "Make the next payment easy.", copy: "Move customers from interest to a secure payment link, package, or subscription." },
];

const niches = [
  ["Law firms & CAs", "Turn urgent enquiries into consultations."],
  ["Gyms", "Convert trials and protect renewals."],
  ["Restaurants", "Request reviews and recover unhappy guests."],
  ["Real estate", "Keep every buyer and seller warm."],
  ["Med spas", "Fill consultations, cancellations, and rebookings."],
  ["Dentists & doctors", "Bring overdue patients back to care."],
  ["Service providers", "Follow up quotes and repeat-service dates."],
];

function ProductJourney() {
  const [active, setActive] = useState(0);
  const steps = [
    { label: "Enquiry captured", meta: "WhatsApp · just now", title: "A new customer asks about a consultation" },
    { label: "Booking confirmed", meta: "Calendar synced", title: "The customer chooses a service and time" },
    { label: "Updates delivered", meta: "Email + WhatsApp", title: "Both the customer and business stay informed" },
    { label: "Payment received", meta: "Razorpay · ₹2,500", title: "The payment appears in the workspace" },
  ];
  useEffect(() => { const timer = window.setInterval(() => setActive((value) => (value + 1) % steps.length), 2600); return () => window.clearInterval(timer); }, [steps.length]);
  return <div className="home-product" aria-label="Rasphia customer journey demonstration"><div className="home-product-bar"><span><i /> Rasphia is working</span><b>Customer journey</b></div><div className="home-product-customer"><span>A</span><div><small>New customer</small><strong>Ananya Sharma</strong></div><em>Active</em></div><div className="home-journey">{steps.map((step, index) => <button type="button" key={step.label} className={index === active ? "active" : index < active ? "done" : ""} onClick={() => setActive(index)}><span>{index < active ? "✓" : index + 1}</span><div><small>{step.label}</small><strong>{step.title}</strong><em>{step.meta}</em></div></button>)}</div><div className="home-product-result"><span>One customer record</span><strong>Enquiry → booking → follow-up → payment</strong></div></div>;
}

export default function Home() {
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  useEffect(() => { let mounted = true; fetch("/api/auth/session").then((response) => response.ok ? response.json() : null).then((data: { signedIn?: boolean; dashboardUrl?: string } | null) => { if (mounted && data?.signedIn && data.dashboardUrl) setDashboardUrl(data.dashboardUrl); }).catch(() => undefined); return () => { mounted = false; }; }, []);
  return <main className="home-v2">
    <nav className="home-nav"><div className="wrap nav-inner"><a className="wordmark home-wordmark" href="https://www.rasphia.com/" aria-label="Rasphia homepage"><Image src="/rasphia_logo.png" alt="Rasphia logo" width={36} height={36} priority /><span>rasph<em>ia</em></span></a><div className="nav-actions"><a className="nav-utility" href="#platform">Platform</a><a className="nav-utility" href="#industries">Industries</a><a className="nav-utility" href="#how">How it works</a><Link className="nav-utility" href="/privacy">Privacy</Link><Link className="nav-utility" href={dashboardUrl || "/login"}>{dashboardUrl ? "Dashboard" : "Sign in"}</Link><Link className="button button-dark" href="/diagnosis">Get free diagnosis</Link></div></div></nav>

    <header className="home-hero" id="top"><div className="wrap home-hero-grid"><div className="home-hero-copy"><p className="eyebrow">AI agents for growth · retention · revenue</p><h1>Turn every enquiry into a <em>booked, followed-up, paying customer.</em></h1><p className="lede">Rasphia gives local businesses one connected system to capture leads, book appointments, send customer updates, follow up automatically, and collect payments.</p><div className="actions"><Link className="button button-gold" href="/diagnosis">Find my highest-value workflow</Link><a className="button button-outline button-play" href="#platform"><span>▶</span> See how it works</a></div><div className="home-hero-proof"><span>Google Calendar</span><span>WhatsApp</span><span>Email</span><span>Stripe</span><span>Razorpay</span></div></div><ProductJourney /></div></header>

    <section className="home-promise"><div className="wrap"><p>Most businesses do not need more leads first.</p><h2>They need fewer customers slipping through the gaps.</h2><div><span>Missed enquiry</span><b>→</b><span>No follow-up</span><b>→</b><span>Empty calendar</span><b>→</b><span>Lost revenue</span></div></div></section>

    <section className="home-platform" id="platform"><div className="wrap"><div className="home-section-head"><div><p className="section-label">One connected customer engine</p><h2>From first message to money received.</h2></div><p>Rasphia keeps the customer, conversation, appointment, update, and payment connected—so your team always knows what should happen next.</p></div><div className="home-capabilities">{capabilities.map((item) => <article key={item.number}><small>{item.number}</small><h3>{item.title}</h3><p>{item.copy}</p><strong>{item.proof}</strong></article>)}</div></div></section>

    <section className="home-outcomes" id="how"><div className="wrap home-outcomes-grid"><div><p className="section-label">What Rasphia changes</p><h2>Less chasing.<br />More momentum.</h2><p>AI agents handle the repetitive customer moments while your team stays in control of the relationship.</p><Link className="button button-gold" href="/diagnosis">Diagnose my business</Link></div><div>{outcomes.map((outcome) => <article key={outcome.label}><span>{outcome.label}</span><div><h3>{outcome.title}</h3><p>{outcome.copy}</p></div></article>)}</div></div></section>

    <section className="home-control"><div className="wrap home-control-grid"><div className="home-control-card"><div className="home-control-head"><span>Rasphia workspace</span><b>4/4 connected</b></div><div className="home-control-metrics"><article><small>Calendar</small><strong>Connected</strong></article><article><small>WhatsApp</small><strong>Connected</strong></article><article><small>Booking page</small><strong>Ready</strong></article><article><small>Payments</small><strong>Connected</strong></article></div><div className="home-control-event"><span>✓</span><div><b>Consultation booked and paid</b><small>Email, WhatsApp, and calendar updates delivered</small></div></div></div><div><p className="section-label">Simple for the business</p><h2>Set it up once. See every customer clearly.</h2><ul><li>A dedicated workspace for each business</li><li>A public booking page you can share anywhere</li><li>Customer profiles with bookings, messages, and payments</li><li>Fixed workflows you can activate without rebuilding the process</li><li>Custom workflows when your business needs something specific</li></ul><Link className="button button-dark" href={dashboardUrl || "/login"}>{dashboardUrl ? "Open dashboard" : "Create my workspace"}</Link></div></div></section>

    <section className="home-industries" id="industries"><div className="wrap"><div className="home-section-head"><div><p className="section-label">Built around your customer journey</p><h2>Different businesses. Clear outcomes.</h2></div><p>The system stays consistent. The trigger, message, timing, and result are tailored to how your business grows.</p></div><div className="home-niches">{niches.map(([name, result]) => <article key={name}><span>↗</span><h3>{name}</h3><p>{result}</p></article>)}</div></div></section>

    <section className="home-steps"><div className="wrap"><p className="section-label">Start with the right move</p><h2>See the opportunity before you automate it.</h2><div className="home-step-grid"><article><b>1</b><h3>Diagnose</h3><p>Show us where leads, appointments, retention, or payments feel stuck.</p></article><article><b>2</b><h3>Connect</h3><p>Add Google Calendar, WhatsApp, email, and your preferred payment provider.</p></article><article><b>3</b><h3>Run</h3><p>Activate the workflow and let Rasphia keep the customer journey moving.</p></article><article><b>4</b><h3>See the result</h3><p>Track customers, bookings, messages, and payments in one workspace.</p></article></div></div></section>

    <section className="google-data-section" id="google-data"><div className="wrap google-data-grid"><div><p className="section-label">Rasphia Google data disclosure</p><h2>Clear permission. Clear purpose.</h2><p>Rasphia uses Google Sign-In to create and secure a user account. Google Calendar access is requested separately only when a signed-in user chooses to connect Calendar for availability, booking events, and customer invitations.</p><p>Rasphia stores the Google account identifier, profile details, and encrypted Calendar authorization tokens only for providing these user-facing features. Google user data is not sold, used for advertising, or used to train AI models.</p><p className="google-data-policy"><Link href="/privacy">Read the Rasphia Privacy Policy</Link></p></div><div className="google-data-card"><h3>Google integrations used by Rasphia</h3><dl><div><dt>Google Sign-In</dt><dd><strong>Scopes:</strong> <code>openid</code>, <code>https://www.googleapis.com/auth/userinfo.email</code>, and <code>https://www.googleapis.com/auth/userinfo.profile</code>. Rasphia uses the Google account ID, verified email address, name, and profile image to create and authenticate the user’s Rasphia account.</dd></div><div><dt>Google Calendar</dt><dd><strong>Scopes:</strong> <code>https://www.googleapis.com/auth/calendar.events</code>, <code>https://www.googleapis.com/auth/calendar.freebusy</code>, and <code>https://www.googleapis.com/auth/calendar.calendarlist.readonly</code>. Rasphia uses these scopes to list calendars, check free/busy availability, create and update booking events, and invite customers.</dd></div><div><dt>Data sharing and control</dt><dd>Google data is shared only with infrastructure providers required to operate Rasphia. Users can disconnect Calendar or request account and data deletion by contacting <a href="mailto:rasphia.ai@gmail.com">rasphia.ai@gmail.com</a>.</dd></div><div><dt>Data not requested</dt><dd>Rasphia does not request Google Drive, Gmail message, Contacts, or Google Ads access.</dd></div></dl><p>Access is limited to the feature the user explicitly connects.</p></div></div></section>

    <section className="home-final" id="start"><div className="wrap"><div className="home-final-copy"><p className="section-label">Your next best move</p><h2>Find the workflow that will pay back first.</h2><p>Get a free business diagnosis, then choose whether Rasphia should help you run the work.</p></div><InterestForm /></div></section>

    <footer><div className="wrap footer-inner"><Link className="footer-brand" href="#top" aria-label="Rasphia home"><Image src="/rasphia_logo.png" alt="Rasphia" width={34} height={34} /><span>rasph<em>ia</em></span></Link><span>© 2026 · Rasphia</span><span><Link href="/faq">FAQ</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · GROW · RETAIN · EARN</span></div></footer>
  </main>;
}
