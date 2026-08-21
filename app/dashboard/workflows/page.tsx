import Link from "next/link";
import { redirect } from "next/navigation";
import postgres from "postgres";
import { getCurrentSession } from "../../../lib/auth";
import { WORKFLOW_CATALOG, type WorkflowStatus } from "../../../lib/workflows";
import { WorkflowCards } from "./workflow-cards";

export default async function WorkflowsPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const statuses = new Map<string, WorkflowStatus>();
  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
    try {
      const rows = await sql<{ service_slug: string; status: WorkflowStatus }[]>`select service_slug, status from workspace_workflows where workspace_id = ${session.workspaceId}`;
      rows.forEach((row) => statuses.set(row.service_slug, row.status));
    } finally { await sql.end(); }
  }
  const workflows = WORKFLOW_CATALOG.map((workflow) => ({ ...workflow, status: statuses.get(workflow.slug) || "draft" as WorkflowStatus }));
  const active = workflows.filter((workflow) => workflow.status === "active").length;
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_URL || "https://calendly.com";
  return <main className="dashboard-page"><aside className="dashboard-nav"><Link className="wordmark" href="/">rasph<em>ia</em></Link><p>{session.workspaceName}</p><nav><Link href="/dashboard">Overview</Link><Link href={`/book/${session.workspaceSlug}`}>Booking page</Link><Link href="/dashboard/conversations">Conversations</Link><Link href="/dashboard/payments">Payments</Link><Link className="active" href="/dashboard/workflows">Workflows</Link></nav></aside><section className="dashboard-content"><div className="dashboard-heading"><div><p className="section-label">Fixed Rasphia services</p><h1>Put the right moves on repeat.</h1><p className="dashboard-intro">Every workflow is purpose-built around a clear customer moment. Activate only what your business needs.</p></div><div className="connection-pill is-connected"><i />{active} active workflow{active === 1 ? "" : "s"}</div></div><section className="custom-workflow-cta"><div><p className="section-label">Need something more specific?</p><h2>Build a custom workflow tailored to your business need.</h2><p>Tell us what should happen, when it should happen, and which customer channel matters most. We’ll map the workflow with you.</p></div><a className="button button-gold" href={calendlyUrl} target="_blank" rel="noreferrer">Schedule a call ↗</a></section><section className="workflow-intro"><span>1</span><p><b>Review the trigger.</b> Each workflow starts from a clear business moment. Use test mode before activating it.</p><span>2</span><p><b>Activate when ready.</b> Rasphia records every run and the customer outcome it creates.</p></section><WorkflowCards workflows={workflows} /></section></main>;
}
