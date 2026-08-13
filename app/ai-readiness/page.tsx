import type { Metadata } from "next";
import Link from "next/link";
import { ScoreChecker } from "./score-checker";

export const metadata: Metadata = { title: "AI Readiness Score | Rasphia", description: "See how ready your store is for AI-driven commerce." };
export default function AiReadinessPage() { return <main className="readiness-page"><nav><div className="wrap nav-inner"><Link href="/" className="wordmark">rasph<em>ia</em></Link><Link className="button button-dark" href="/#start">Talk to us</Link></div></nav><header className="readiness-header"><div className="wrap"><p className="eyebrow">Free AI commerce audit</p><h1>Is your store ready to be the answer?</h1><p>See whether AI can discover your business, complete a booking or order, and move a customer to payment.</p><ScoreChecker /></div></header></main>; }
