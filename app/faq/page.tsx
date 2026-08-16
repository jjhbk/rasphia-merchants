import type { Metadata } from "next";
import Link from "next/link";

const faqs = [
  {
    question: "What does Rasphia do?",
    answer: "Rasphia gives local service businesses a free, business-specific diagnosis of where growth, retention, or revenue is getting stuck. It then ranks the few moves most likely to pay back and can help execute them with AI-assisted discoverability, customer follow-up, booking, and payment workflows.",
  },
  {
    question: "How much does a Rasphia growth diagnosis cost?",
    answer: "The initial Rasphia business diagnosis is free. It is a no-pressure starting point to identify the highest-priority opportunities and what a business should avoid spending on first; any follow-on execution is discussed separately.",
  },
  {
    question: "What kinds of businesses does Rasphia work with?",
    answer: "Rasphia is designed for local service businesses, including neighbourhood salons, dental clinics, and boutique fitness studios. It is most useful where bookings, repeat customers, local discovery, reviews, spare capacity, or no-shows materially affect revenue.",
  },
  {
    question: "What happens in a business diagnosis?",
    answer: "You share a business name or website and answer a few context questions. Rasphia researches publicly available information, identifies likely leaks, and produces a practical Grow, Retain, and Get Paid strategy with prioritized plays and clear guidance on what not to do yet.",
  },
  {
    question: "Can Rasphia help a business appear in AI search and chat assistants?",
    answer: "Yes. Rasphia can improve the information AI systems need to understand and recommend a local business, including clear public facts, AI-readable website content, reviews, local presence, booking information, and the handoff from discovery to action.",
  },
  {
    question: "Does Rasphia replace a marketing agency or a booking tool?",
    answer: "Rasphia starts with the business problem rather than a fixed channel or tool. Depending on the diagnosis, it can coordinate the right growth work and connect customer follow-up, bookings, deposits, payment links, packages, and memberships into one customer journey.",
  },
];

export const metadata: Metadata = {
  title: "Rasphia FAQ | Local Business Growth Diagnosis",
  description: "Answers about Rasphia's free local-business growth diagnosis, the businesses it serves, and AI-assisted growth, retention, booking, and payment execution.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return <main className="faq-page">
    <nav><div className="wrap nav-inner"><Link href="/" className="wordmark">rasph<em>ia</em></Link><Link className="button button-dark" href="/diagnosis">Get free diagnosis</Link></div></nav>
    <header className="faq-header"><div className="wrap">
      <p className="eyebrow">Rasphia FAQ</p>
      <h1>Clear answers before you make your next move.</h1>
      <p>Rasphia helps local service businesses identify the few growth, retention, and revenue moves most likely to pay back.</p>
    </div></header>
    <section className="faq-section"><div className="wrap faq-content">
      {faqs.map(({ question, answer }) => <article className="faq-item" key={question}><h2>{question}</h2><p>{answer}</p></article>)}
      <aside className="faq-cta"><p className="section-label">Start with your business</p><h2>See what matters most right now.</h2><p>Get a free, research-led diagnosis before committing to another channel, campaign, or tool.</p><Link className="button button-gold" href="/diagnosis">Get free diagnosis</Link></aside>
    </div></section>
    <footer><div className="wrap footer-inner"><span>© 2026 · Rasphia</span><span>GROW · RETAIN · EARN</span></div></footer>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
  </main>;
}
