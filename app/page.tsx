"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InterestForm } from "./components/interest-form";

type Diagnosis = {
  business: string;
  type: string;
  leaks: { amount: string; copy: string }[];
  plays: { name: string; return: string; copy: string; primary?: boolean }[];
  skip: string;
  note: string;
};

const diagnoses: Diagnosis[] = [
  {
    business: "Meera’s Curl Studio",
    type: "Salon · 4 chairs",
    leaks: [
      { amount: "214 clients", copy: "haven’t returned in 6+ months — and have never been contacted." },
      { amount: "Tue + Wed", copy: "chairs sit 70% empty, even while Saturdays are fully booked." },
    ],
    plays: [
      { primary: true, name: "Win back lapsed regulars", return: "Start here", copy: "They already know and trust you. This is your lowest-cost next booking." },
      { name: "Fill midweek slots", return: "Next", copy: "Offer regulars the right appointment at the right time — without discounting Saturday." },
    ],
    skip: "Don’t run Meta ads yet. Your catchment is two kilometres wide; you’d pay to reach people who will never travel to you.",
    note: "You keep cutting hair. Rasphia runs the follow-up.",
  },
  {
    business: "Dr. Anaya’s Dental Studio",
    type: "Clinic · new practice",
    leaks: [
      { amount: "Search gap", copy: "means potential patients can’t find enough information to confidently choose you." },
      { amount: "31%", copy: "of booked appointments become no-shows because no deposit is taken." },
    ],
    plays: [
      { primary: true, name: "Fix search & AI visibility", return: "Start here", copy: "Patients research before they call. Be easy to find and easy to trust." },
      { name: "Add deposit-backed bookings", return: "Next", copy: "A simple confirmation flow recovers revenue without buying a single lead." },
    ],
    skip: "Don’t buy a lead package yet. First make sure the patients already looking for you can find and book you.",
    note: "You keep treating patients. Rasphia handles the flow.",
  },
  {
    business: "Prana Shala",
    type: "Fitness studio · 6 per batch",
    leaks: [
      { amount: "Trial drop-off", copy: "means first-time visitors are never invited back after their first class." },
      { amount: "One-off visits", copy: "are leaving predictable membership revenue on the table." },
    ],
    plays: [
      { primary: true, name: "Turn trials into memberships", return: "Start here", copy: "The demand is already there — the follow-up and offer are missing." },
      { name: "Partner with local creators", return: "Next", copy: "Local social proof is likely to travel farther than broad, costly ad reach." },
    ],
    skip: "Don’t scale ads first. Retention and social proof will make every future acquisition effort work harder.",
    note: "You keep teaching. Rasphia keeps the momentum moving.",
  },
];

function DiagnosisPreview() {
  const [active, setActive] = useState(0);
  const diagnosis = diagnoses[active];

  useEffect(() => {
    const timer = window.setInterval(() => setActive((current) => (current + 1) % diagnoses.length), 8500);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="diagnosis-card" aria-label="Example Rasphia business diagnosis">
    <div className="diagnosis-head">
      <div><span className="live-dot" />Your Rasphia diagnosis</div>
      <button type="button" onClick={() => setActive((active + 1) % diagnoses.length)} aria-label="Show another example diagnosis">↻</button>
    </div>
    <div className="diagnosis-body" key={active}>
      <div className="business-title"><strong>{diagnosis.business}</strong><span>{diagnosis.type}</span></div>
      <section className="diagnosis-section">
        <p className="diagnosis-label">Where revenue is leaking</p>
        {diagnosis.leaks.map((leak) => <div className="leak" key={leak.amount}><b>{leak.amount}</b><span>{leak.copy}</span></div>)}
      </section>
      <section className="diagnosis-section">
        <p className="diagnosis-label">Your highest-priority plays</p>
        {diagnosis.plays.map((play) => <div className={`play ${play.primary ? "primary" : ""}`} key={play.name}>
          <div className="play-top"><span>{play.return}</span><b>{play.name}</b></div><p>{play.copy}</p>
        </div>)}
      </section>
      <div className="skip"><b>What to skip</b><span>{diagnosis.skip}</span></div>
      <div className="deploy"><span>Ready when you are</span><button type="button">Deploy these plays →</button></div>
      <p className="diagnosis-note">{diagnosis.note}</p>
    </div>
  </div>;
}

const demoFlows = [
  { label: "Gym", trigger: "Trial class ends", customer: "Asha · attended her first strength class", message: "Hey Asha — great having you in class today. Want a 3-class starter pass for this week?", outcome: "Starter pass booked", metric: "+1 membership opportunity" },
  { label: "Clinic", trigger: "Check-up becomes overdue", customer: "Rahul · last visit 7 months ago", message: "Hi Rahul, you’re due for a routine check-up. There are two convenient times open this week.", outcome: "Check-up booked", metric: "No manual chasing" },
  { label: "Agent", trigger: "Viewing is completed", customer: "Maya · viewed a 2-bed in Bandra", message: "Thanks for viewing today. I’ve saved two similar homes that fit what you liked — should I send them over?", outcome: "Conversation re-opened", metric: "Lead stays warm" },
];

function WorkflowDemo() {
  const [active, setActive] = useState(0);
  const flow = demoFlows[active];

  return <section className="demo-section" id="demo"><div className="wrap demo-grid"><div className="demo-copy"><p className="section-label">See it in action</p><h2>A customer moment becomes the next right move.</h2><p>Choose a business to watch Rasphia notice a signal, make the follow-up personal, and push the outcome forward.</p><div className="demo-tabs" role="tablist" aria-label="Choose a workflow demo">{demoFlows.map((item, index) => <button key={item.label} type="button" className={index === active ? "active" : ""} onClick={() => setActive(index)} role="tab" aria-selected={index === active}>{item.label}</button>)}</div><Link className="button button-gold" href="/diagnosis">Build my workflow</Link></div><div className="workflow-demo" key={flow.label}><div className="workflow-top"><span><i /> Live workflow</span><b>{flow.label}</b></div><div className="workflow-steps"><article><small>01 · Signal</small><strong>{flow.trigger}</strong><p>{flow.customer}</p></article><div className="workflow-arrow">↓</div><article className="workflow-message"><small>02 · Rasphia follows up</small><p>{flow.message}</p><span>Sent on WhatsApp · just now</span></article><div className="workflow-arrow">↓</div><article className="workflow-outcome"><small>03 · Outcome</small><strong>✓ {flow.outcome}</strong><p>{flow.metric}</p></article></div></div></div></section>;
}

const pillars: [string, string, string, string[]][] = [
  ["01 · Growth", "Get found. Get chosen.", "AI agents keep your local presence, content, reviews, and outreach moving after we identify the channel most likely to pay back.", ["Search, maps, social & AI visibility", "Local creator and campaign coordination", "Campaigns launched and measured"]],
  ["02 · Retention", "Keep them coming back.", "AI agents answer repeat questions, follow up with quiet customers, and help fill spare capacity without another dashboard.", ["Lapsed-customer win-backs", "WhatsApp, email & reply automation", "Bookings, reminders & replies"]],
  ["03 · Revenue", "Make every booking count.", "We connect the booking and payment journey so deposits, payment links, packages, and flexible options support predictable revenue.", ["Deposits & payment links", "Autopay, EMI & no-show protection", "Packages & memberships"]],
];

const examples: [string, string, string][] = [
  ["Neighbourhood salon", "Win back regulars and fill midweek chairs.", "Not broad ads — customers already live nearby and know you exist."],
  ["New dental clinic", "Build high-trust search visibility and add deposits.", "Patients research before they call; no-show protection comes before paid lead volume."],
  ["Boutique fitness studio", "Convert trials and create a compelling membership offer.", "Retention and local social proof are a stronger foundation than rented reach."],
];

const nicheServices = [
  { niche: "Law firms & CAs", promise: "Sell speed.", outcome: "More qualified consultations.", flow: ["Reply instantly", "Triage the enquiry", "Book the call"], delivery: ["Website and WhatsApp intake", "Matter-type triage and document checklist", "Calendar routing and reminders"] },
  { niche: "Gyms", promise: "Keep memberships moving.", outcome: "More trials becoming members.", flow: ["Spot drop-off", "Send the right nudge", "Renew on time"], delivery: ["Trial-to-membership nurture", "Attendance and renewal alerts", "Class, coach, and win-back messages"] },
  { niche: "Restaurants", promise: "Protect your reputation.", outcome: "More reviews. Faster recovery.", flow: ["Ask happy guests", "Respond on-brand", "Recover unhappy ones"], delivery: ["Timed review requests", "Review-response drafts", "Private guest recovery flows"] },
  { niche: "Real estate agents", promise: "Never lose the follow-up.", outcome: "More warm leads reaching a decision.", flow: ["Capture the lead", "Follow up after viewing", "Nurture until ready"], delivery: ["Source-aware lead routing", "Viewing reminders and follow-up", "Property-match nurture updates"] },
  { niche: "Med spas", promise: "Build full calendars.", outcome: "More consultations and rebookings.", flow: ["Answer in minutes", "Follow up the plan", "Fill cancellations"], delivery: ["Fast consultation response", "Treatment-plan and package follow-up", "Cancellation-fill and rebooking flows"] },
  { niche: "Dentists & doctors", promise: "Book the check-up.", outcome: "More overdue patients returning.", flow: ["Find who is due", "Make booking easy", "Recover no-shows"], delivery: ["Care-based recall campaigns", "Booking and reminder flows", "No-show recovery and review prompts"] },
  { niche: "Service providers", promise: "Follow up automatically.", outcome: "More quotes converting into jobs.", flow: ["Follow up the quote", "Ask for the review", "Bring them back"], delivery: ["SMS, WhatsApp, and email follow-up", "Job-complete review and referral requests", "Seasonal repeat-service reminders"] },
];

export default function Home() {
  return <main>
    <nav><div className="wrap nav-inner"><a className="wordmark" href="#top">rasph<em>ia</em></a><div className="nav-actions"><a className="nav-utility" href="#services">Services</a><a className="nav-utility" href="#demo">See it in action</a><Link className="nav-utility" href="/faq">FAQ</Link><Link className="nav-utility" href="/login">Sign in</Link><Link className="button button-dark" href="/diagnosis">Get free diagnosis</Link></div></div></nav>

    <header id="top" className="hero"><div className="wrap hero-grid">
      <div className="hero-copy"><p className="eyebrow">AI agents for growth · retention · revenue</p><h1>You don’t need <span>more marketing</span>.<br />You need the <em>next move that pays back</em>.</h1><p className="lede">Rasphia diagnoses where leads, appointments, and returning customers fall through—then deploys AI agents to turn those moments into growth, retention, and revenue.</p><div className="actions"><Link className="button button-gold" href="/diagnosis">Get your free diagnosis</Link><a className="button button-outline button-play" href="#demo"><span>▶</span> See it in action</a></div><p className="note">Diagnose the leak · Deploy the AI workflow · Track the outcome</p></div>
      <DiagnosisPreview />
    </div></header>

    <div className="strip"><div className="wrap strip-inner"><span>Diagnoses <b>your business</b>, not a category</span><span>Shows what <b>not to spend on</b></span><span>Deploys <b>AI agents to run the work</b></span></div></div>

    <WorkflowDemo />

    <section><div className="wrap"><p className="section-label">The real problem</p><h2>Everyone has advice. Almost nobody has your answer.</h2><p className="section-intro">Run ads. Post more. Try influencers. Build a website. Send offers. Every suggestion costs time or money — and without a diagnosis, you only learn what doesn’t work after you have paid for it.</p><div className="before-after"><article className="before-card"><small>Without a diagnosis</small><h3>More activity. More guessing.</h3><ul><li>Ad spend that attracts the wrong customers</li><li>Old regulars who quietly never return</li><li>Empty capacity every week</li><li>Five disconnected tools to manage</li></ul><p>Money spent. Nothing learned. Same problem next month.</p></article><article className="after-card"><small>With Rasphia</small><h3>A clear next move.</h3><ul><li>Business-specific leaks, made visible</li><li>Two or three plays, ranked by priority</li><li>An honest recommendation of what to skip</li><li>Execution without another dashboard</li></ul><p>Know before you spend. Then make it happen.</p></article></div></div></section>

    <section className="tight" id="how"><div className="wrap"><p className="section-label">The Rasphia engine</p><h2>Three outcomes. One connected system.</h2><p className="section-intro">The right answer may be different for every business. Rasphia connects growth, retention, and revenue so each move strengthens the next.</p><div className="pillars">{pillars.map(([number, title, copy, items]) => <article className="pillar" key={title}><small>{number}</small><h3>{title}</h3><p>{copy}</p><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div></div></section>

    <section className="tight"><div className="wrap"><p className="section-label">Same engine. Different answer.</p><h2>The right play for a salon can be the wrong play for a clinic.</h2><div className="examples">{examples.map(([business, answer, contrast]) => <article key={business}><h3>{business}</h3><p><strong>{answer}</strong> {contrast}</p></article>)}</div></div></section>

    <section className="services-section" id="services"><div className="wrap"><p className="section-label">Services by niche</p><h2>See the value in one glance.</h2><p className="section-intro">One business problem. One clear promise. One workflow we can build.</p><div className="niche-services">{nicheServices.map((service) => <article className="niche-service" key={service.niche}><p className="niche-name">{service.niche}</p><h3>{service.promise}</h3><div className="service-result"><span>Business result</span><strong>{service.outcome}</strong></div><div className="service-flow" aria-label={`${service.niche} workflow`}>{service.flow.map((step, index) => <div key={step}><b>{index + 1}</b><span>{step}</span></div>)}</div><details><summary>What we build</summary><p>{service.delivery.join(" · ")}</p></details></article>)}</div></div></section>

    <section className="dark"><div className="wrap"><p className="section-label">Why it works</p><h2>The most useful recommendation can be the money you don’t spend.</h2><div className="reasons"><article><h3>Your data, not a generic playbook</h3><p>Pricing, bookings, capacity, customers, reviews, and what is already working provide the context for every recommendation.</p></article><article><h3>AI agents that run the play</h3><p>We build agents for customer support, WhatsApp and email follow-up, review requests, local outreach, and the booking or payment handoff.</p></article><article><h3>One system, not seven subscriptions</h3><p>Keep the customer journey connected instead of handing it between a booking app, payment tool, marketing platform, and agency.</p></article></div></div></section>

    <section className="steps-section"><div className="wrap"><p className="section-label">Getting started</p><h2>Fifteen minutes to see where growth is getting stuck.</h2><div className="steps"><article><b>1</b><h3>Share the picture</h3><p>Tell us about your business, your customers, and where you feel stuck.</p></article><article><b>2</b><h3>See your diagnosis</h3><p>We identify the leaks, rank the next moves, and show what is not worth doing yet.</p></article><article><b>3</b><h3>Deploy the right agents</h3><p>Choose the work to run. Rasphia builds and operates the AI agents and connected customer journeys behind it.</p></article></div></div></section>

    <section id="start" className="final"><div className="wrap"><p className="section-label">Your free diagnosis</p><h2>Find the two moves that matter most right now.</h2><p className="section-intro">Tell us a little about your business. We’ll follow up with a no-pressure conversation and a clearer view of where to start.</p><InterestForm /></div></section>
    <footer><div className="wrap footer-inner"><span>© 2026 · Rasphia</span><span><Link href="/faq">FAQ</Link> · GROW · RETAIN · EARN</span></div></footer>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Service",
      name: "Rasphia business diagnosis and AI growth execution",
      url: "https://rasphia.com/",
      description: "A free business diagnosis for local service businesses, followed by optional AI-assisted execution for discoverability, customer follow-up, bookings, and payments.",
      provider: { "@type": "Organization", name: "Rasphia", url: "https://rasphia.com" },
      areaServed: "Worldwide",
      audience: { "@type": "Audience", audienceType: "Local service businesses" },
      serviceType: ["Business growth diagnosis", "Local business AI discoverability", "Customer retention automation"],
    }) }} />
  </main>;
}
