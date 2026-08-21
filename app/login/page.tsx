import Link from "next/link";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="auth-page"><nav><div className="wrap nav-inner"><Link className="wordmark" href="/">rasph<em>ia</em></Link><Link className="nav-utility" href="/">Back to home</Link></div></nav><section className="auth-card-wrap"><div className="auth-card"><p className="section-label">Merchant portal</p><h1>Put the right moves to work.</h1><p>Sign in to create your business workspace, connect your tools, and manage your Rasphia workflows.</p><a className="google-button" href="/api/auth/google"><span>G</span> Continue with Google</a><small>We only use your Google profile to create your Rasphia account. Calendar and Drive access are requested later, only if you connect them.</small>{error && <p className="form-error" role="alert">{error}</p>}</div></section></main>;
}
