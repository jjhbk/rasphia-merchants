"use client";

import { useEffect, useRef, useState } from "react";
import { InterestForm } from "./components/interest-form";

type Scenario = { tag: string; user: string; note: string; business: string; body: string; chips: string[]; alternative: string; action: string; followup: string; confirmation: string };
type Market = "IN" | "US" | "GB";

const marketForLocale = (locale: string): Market => locale.toLowerCase().includes("-us") ? "US" : locale.toLowerCase().includes("-gb") ? "GB" : "IN";
const marketCopy = (scenario: Scenario, market: Market): Scenario => {
  if (market === "IN") return scenario;
  const isUS = market === "US";
  const money = (value: number) => new Intl.NumberFormat(isUS ? "en-US" : "en-GB", { style: "currency", currency: isUS ? "USD" : "GBP", maximumFractionDigits: 0 }).format(Math.round(value * (isUS ? 0.012 : 0.0095)));
  const replace = (text: string) => text
    .replace(/₹1,850/g, money(1850)).replace(/₹2,400/g, money(2400)).replace(/₹2,800/g, money(2800)).replace(/₹1,200–1,400/g, `${money(1200)}–${money(1400)}`).replace(/₹800/g, money(800)).replace(/₹4,500/g, money(4500)).replace(/₹7,200/g, money(7200)).replace(/₹6,500/g, money(6500)).replace(/₹12,000/g, money(12000)).replace(/₹2,000/g, money(2000)).replace(/₹3,000/g, money(3000)).replace(/₹8,000/g, money(8000))
    .replace(/Banjara Hills/g, isUS ? "Brooklyn Heights" : "Clapham").replace(/Kondapur/g, isUS ? "Austin" : "Richmond").replace(/Madhapur/g, isUS ? "Cambridge" : "Islington").replace(/Pedana/g, isUS ? "Portland" : "Bristol");
  return Object.fromEntries(Object.entries(scenario).map(([key, value]) => [key, typeof value === "string" ? replace(value) : Array.isArray(value) ? value.map((item) => typeof item === "string" ? replace(item) : item) : value])) as Scenario;
};

const scenarios: Scenario[] = [
  { tag: "SALONS", user: "My mom's visiting this weekend and I want to treat her. Need a salon genuinely good with thick, greying curly hair — gentle with sensitive scalps, somewhere calm, not a loud chain. Around ₹2,000 total for both of us, Saturday morning, near Banjara Hills.", note: "Matched on 6 of your constraints", business: "Meera's Curl Studio", body: " is the strongest fit — 8 years specializing in curly and textured hair, including silver-strand colour care, with an in-house herbal scalp ritual for sensitive scalps. A quiet 4-chair studio, 1.2 km from Banjara Hills. Their mother–daughter Saturday 10:30 slot is open: a curl shaping cut plus a gentle scalp treatment comes to ₹1,850 for both.", chips: ["curl + grey-hair care", "sensitive-scalp safe", "quiet 4-chair studio", "1.2 km · Banjara Hills", "sat 10:30 · two seats", "₹1,850 for both"], alternative: "Backup: Root & Ritual (2.8 km) has 11:15 open, but tends to be busier on weekends.", action: "Book Sat 10:30 for two →", followup: "Perfect — book it, and mention her scalp is sensitive.", confirmation: "Booked ✓ Saturday 10:30, two seats at Meera's Curl Studio. I've added a note about your mom's sensitive scalp, and your payment link for ₹1,850 is ready." },
  { tag: "WELLNESS", user: "Recovering from a knee injury and want to get back to yoga — needs to be genuinely gentle, small batches, morning before 8 am, and an instructor who actually understands rehab. Near Kondapur.", note: "Matched on 5 of your constraints", business: "Prana Shala", body: " is the right fit — the lead instructor is certified in therapeutic yoga and has worked with post-injury recovery for 6 years. Batches cap at 6 people, the 6:30 am slot has two seats free, and it's 1.4 km from Kondapur. First class is free so you can check the pace before committing.", chips: ["therapeutic yoga cert.", "post-injury experience", "max 6 per batch", "6:30 am · 2 seats", "1.4 km · Kondapur", "first class free"], alternative: "Alternative: Sthira Studio (2.1 km) runs one-on-one rehab sessions at ₹800 each.", action: "Reserve 6:30 am trial class →", followup: "Reserve it — and let them know it's my left knee.", confirmation: "Reserved ✓ Tomorrow 6:30 am trial at Prana Shala. I've noted the left-knee recovery so the instructor prepares modified poses. No payment needed — first class is free." },
  { tag: "DENTISTS", user: "My dad needs a crown replaced but he's genuinely anxious about dentists. Need someone patient who explains everything, weekend appointments, EMI on card, near Madhapur — hoping to stay under ₹8,000.", note: "Matched on 5 of your constraints", business: "Dr. Anaya's Dental Studio", body: " fits best — 12 years in prosthodontics with a practice known for anxious-patient care: numbing-first protocol, every step explained before it happens, no rushed chair time. 900 m from Madhapur metro. A zirconia crown is ₹7,200 with 3-month EMI, and Saturday 9:30 is open.", chips: ["anxious-patient care", "crowns · prosthodontics", "sat 9:30 open", "900 m · Madhapur", "₹7,200 · EMI available"], alternative: "Alternative: Smile Lane (1.6 km) quotes ₹6,500 but books two visits instead of one.", action: "Book Sat 9:30 →", followup: "Book it — and mention he has high blood pressure.", confirmation: "Booked ✓ Saturday 9:30 with Dr. Anaya. I've noted your dad's blood pressure on the appointment so they plan anesthesia accordingly, and your EMI payment link is ready." },
  { tag: "LAWYERS", user: "I'm freelancing for a US client and need a lawyer to review their contract — someone who actually knows cross-border freelance agreements, fixed fee not hourly, turnaround within 3 days. Remote is fine.", note: "Matched on 4 of your constraints", business: "Adv. Meher Kapoor", body: " is your match — specializes in tech and freelance contracts, 200+ cross-border agreement reviews for Indian freelancers with US and EU clients. Fixed ₹4,500 per contract review with written notes, 48-hour turnaround, and a Thursday 6 pm video consult is open.", chips: ["cross-border contracts", "freelancer specialist", "fixed ₹4,500", "48-hr turnaround", "thu 6 pm · video"], alternative: "Alternative: LexBridge Partners does firm-level review at ₹12,000 if the deal grows.", action: "Book Thursday 6 pm consult →", followup: "Book the consult and send her the draft contract.", confirmation: "Booked ✓ Thursday 6 pm video consult with Adv. Kapoor. A secure upload link for your draft is ready, and your ₹4,500 payment link confirms the review slot." },
  { tag: "ARTISANS", user: "Looking for an anniversary gift — something handwoven with a real story behind it, made by a local artisan, under ₹3,000, delivered by Friday, gift-wrapped if possible.", note: "Matched on 5 of your constraints", business: "Lakshmamma's Loom Collective", body: " in Pedana has it — a hand-blocked Kalamkari stole in natural indigo and madder root dyes, woven by a 14-member women's collective, each piece signed by its maker with a card telling her story. ₹2,400, ships tomorrow, arrives Thursday, gift-wrapped in handmade paper.", chips: ["hand-blocked kalamkari", "natural dyes", "signed by the maker", "₹2,400", "arrives thursday", "gift-wrapped"], alternative: "Also lovely: a Pochampally ikat table runner at ₹2,800, arriving Friday.", action: "Order the Kalamkari stole →", followup: "Order it — add a handwritten note saying ‘Happy 10th.’", confirmation: "Ordered ✓ The stole ships tomorrow and arrives Thursday, gift-wrapped with your handwritten ‘Happy 10th’ note. Payment link for ₹2,400 is ready." }
];

function ChatDemo() {
  const [platform, setPlatform] = useState<"Claude" | "ChatGPT">("Claude");
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(0);
  const [typingIndex, setTypingIndex] = useState<number | null>(null);
  const [market, setMarket] = useState<Market>("IN");
  const cardRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const scenario = marketCopy(scenarios[scenarioIndex], market);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMarket(marketForLocale(window.navigator.language));
      setReplayKey((key) => key + 1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!startedRef.current) return;
    setVisibleCount(0); setTypingIndex(null);
    const timers: number[] = [];
    const reveal = (index: number, delay: number, typing = false) => timers.push(window.setTimeout(() => {
      if (typing) { setTypingIndex(index); timers.push(window.setTimeout(() => { setTypingIndex(null); setVisibleCount(index + 1); }, 1100)); }
      else setVisibleCount(index + 1);
    }, delay));
    reveal(0, 500); reveal(1, 1500, true); reveal(2, 3600); reveal(3, 4600, true);
    // Give the completed recommendation a little more time to settle before rotating.
    timers.push(window.setTimeout(() => setScenarioIndex((index) => (index + 1) % scenarios.length), 15000));
    return () => timers.forEach(window.clearTimeout);
  }, [replayKey, scenarioIndex]);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !startedRef.current) { startedRef.current = true; setReplayKey((key) => key + 1); observer.disconnect(); } }, { threshold: 0.4 });
    observer.observe(card); return () => observer.disconnect();
  }, []);
  const reset = () => setReplayKey((key) => key + 1);
  const selectPlatform = (choice: "Claude" | "ChatGPT") => { setPlatform(choice); reset(); };
  const renderMessage = (index: number) => {
    if (typingIndex === index) return <div className="typing" key={`typing-${index}`}><i /><i /><i /></div>;
    if (visibleCount <= index) return null;
    if (index === 0) return <article className="message user-message reveal-message"><small>You</small><p>{scenario.user}</p></article>;
    if (index === 1) return <article className="message ai-message reveal-message"><AiLabel platform={platform} /><div className="ai-copy"><small className="match-note">{scenario.note}</small><p><strong>{scenario.business}</strong>{scenario.body}</p><div className="chips">{scenario.chips.map((chip) => <span key={chip}>{chip}</span>)}</div><p className="alternative">{scenario.alternative}</p><button className="book-button">{scenario.action}</button></div></article>;
    if (index === 2) return <article className="message user-message reveal-message"><small>You</small><p>{scenario.followup}</p></article>;
    return <article className="message ai-message reveal-message"><AiLabel platform={platform} /><div className="ai-copy"><p>{scenario.confirmation}</p></div></article>;
  };
  return <div className={`chat-card ${platform === "Claude" ? "skin-claude" : "skin-gpt"}`} aria-label="Example AI recommendation">
    <div className="chat-head"><div className="chat-tabs" role="tablist" aria-label="Choose assistant">
      {(["Claude", "ChatGPT"] as const).map((item) => <button key={item} className="chat-tab" role="tab" aria-selected={platform === item} onClick={() => selectPlatform(item)}>{item}</button>)}
    </div><div className="chat-live"><span className="head-brand">{platform}</span><i className="chat-dot" /><span>RASPHIA · {scenario.tag}</span></div></div>
    <div className="chat-body" ref={cardRef}>
      {[0, 1, 2, 3].map(renderMessage)}
      <button className="replay" onClick={reset}>↺ replay</button>
    </div>
    <div className="chat-input"><span>＋</span><span>Ask anything…</span><b>↑</b></div>
  </div>;
}

function AiLabel({ platform }: { platform: string }) { return <div className="ai-label"><b>{platform === "Claude" ? "✳" : "◎"}</b><span>{platform}</span><small>via Rasphia</small></div>; }

const offerings = [["01 · Discover", "AI Discoverability", "Context-rich, AI-readable profiles that let Claude and ChatGPT understand what makes you distinct — so you're matched to real intent, not keywords."], ["02 · Act", "AI Booking & Ordering", "Live availability and ordering, callable right inside the chat. Appointments, orders, customizations, and notes arrive straight to you."], ["03 · Pay", "AI-Native Payments", "Secure UPI and card links generated in-conversation and confirmed back into the chat. No checkout page to rebuild."]];
const audiences = [["Salons & personal care", "‘Good with curly hair’ beats ‘salon near me’. Your specialty becomes the reason you're chosen."], ["Wellness & fitness studios", "Gentle-on-the-knee yoga, beginner batches, injury-aware trainers — matched to a person's actual goal."], ["Tutors & instructors", "Patient with beginners. Great with exam-stressed teens. Teaching style, finally discoverable."], ["Artisans & local brands", "Your story and provenance are the product. We make them the reason someone buys — at full price."], ["Home & repair trades", "Verified skill, real work history, honest pricing — trust signals that win jobs word-of-mouth used to."], ["Event professionals", "Photographers, decorators, caterers — taste-driven choices where the right context closes the booking."]];

export default function Home() { return <main>
  <nav><div className="wrap nav-inner"><a href="#top" className="wordmark">rasph<em>ia</em></a><a className="button button-dark" href="#start">Talk to us</a></div></nav>
  <header id="top" className="hero"><div className="wrap hero-grid"><div className="hero-copy"><p className="eyebrow">Rasphia · Native to Claude & ChatGPT</p><h1>Your customers aren&apos;t <span>searching</span>.<br />They&apos;re <em>asking</em>.</h1><p className="lede">Millions of people now ask AI for exactly what you offer — and get one confident recommendation back, not ten links. Rasphia makes your business that answer, with booking and payment completing inside the same chat.</p><div className="actions"><a className="button button-gold" href="#start">Get your business AI-ready</a><a className="button button-outline" href="#how">See how it works</a></div><p className="note">No ads to buy. No app to manage. One conversation to get started.</p></div><ChatDemo /></div></header>
  <div className="strip"><div className="wrap strip-inner"><span>AI-assisted local search: <b>up ~7× in one year</b></span><span>Local businesses AI ever recommends: <b>barely 1 in 100</b></span><span>Placement you can buy inside the answer: <b>none — it&apos;s earned</b></span></div></div>
  <section><div className="wrap"><p className="section-label">The problem</p><h2>Everything that makes customers choose you is invisible to AI.</h2><p className="section-intro">An AI knows your name and a pin on a map. It doesn&apos;t know you&apos;re brilliant with bridal makeup for mature skin, that your Tuesday batch is beginner-friendly, or that your pottery uses clay from your village.</p><div className="comparison"><div className="comparison-card before"><small>What AI sees today</small><h3>Meera&apos;s Salon</h3><div className="skeleton"><i /><i /><i /></div><p>A name. A category. A star rating. Nothing to reason with — nothing worth recommending.</p></div><div className="comparison-card after"><small>What AI sees with us</small><h3>Meera&apos;s Curl Studio</h3><dl><div><dt>Specialty</dt><dd>Curly & textured hair · DevaCut trained · 8 yrs</dd></div><div><dt>Perfect for</dt><dd>First-time curl cuts, transition from straightening</dd></div><div><dt>Pricing</dt><dd>₹1,200–1,400 cut · consultation included</dd></div><div><dt>Available</dt><dd>Live slots — bookable inside the chat</dd></div></dl><p>The depth a loyal customer would use to recommend you — readable, reasoned, bookable.</p></div></div></div></section>
  <section className="tight"><div className="wrap"><p className="section-label">Core offerings</p><h2>Three layers. One continuous flow.</h2><p className="section-intro">From the moment someone asks, to the moment they&apos;ve paid — Rasphia covers the entire journey inside the conversation.</p><div className="cards">{offerings.map(([number, title, copy]) => <article className="info-card" key={title}><small>{number}</small><h3>{title}</h3><p>{copy}</p></article>)}</div></div></section>
  <section id="how" className="tight"><div className="wrap"><p className="section-label">How it works</p><h2>One conversation. Then you&apos;re the answer.</h2><div className="cards process">{[["1", "We capture what makes you distinct", "One sitting — in person or on a call. We ask the questions a smart friend would ask before recommending you."], ["2", "We build your AI-readable profile", "We structure it, connect it, and keep it current. You approve everything before it goes live."], ["3", "Conversations become customers", "When you&apos;re the match, customers book or buy inside the chat. You get the booking; they never start over."]].map(([number, title, copy]) => <article className="info-card" key={number}><b className="number">{number}</b><h3>{title}</h3><p>{copy}</p></article>)}</div></div></section>
  <section className="tight"><div className="wrap"><p className="section-label">Who this is for</p><h2>Built for businesses whose value doesn&apos;t fit in a keyword.</h2><div className="audiences">{audiences.map(([title, copy]) => <article key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div></div></section>
  <section className="why"><div className="wrap"><p className="section-label">Why now</p><h2>The next decade of local discovery is being decided in conversations you&apos;re not part of yet.</h2><div className="why-points">{[["You can&apos;t buy your way in", "There&apos;s no ad slot inside an AI&apos;s answer. Recommendations are earned through depth and substance."], ["Early trust compounds", "The businesses assistants learn to rely on now become the defaults later — just like early movers on maps."], ["These customers arrive pre-sold", "By the time you&apos;re recommended, the customer has already said exactly what they want. What reaches you is a buyer."]].map(([title, copy]) => <article key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div></div></section>
  <section id="start" className="final"><div className="wrap"><h2>Be the answer, inside Claude and ChatGPT.</h2><p className="section-intro">One conversation is all it takes to get started. We&apos;ll show you exactly what your business looks like when an assistant recommends it — before you commit to anything.</p><InterestForm /></div></section>
  <footer><div className="wrap footer-inner"><span>© 2026 · Rasphia</span><span>CONTEXT-RICH · CONTEXT-AWARE · AI-NATIVE</span></div></footer>
</main>; }
