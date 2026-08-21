import postgres from "postgres";

export async function queueActiveWorkflowUpdate(input: { workspaceId: string; customerId: string; workflowSlug: string; triggerType: string; body: string; scheduledFor: Date; channels: Array<"email" | "whatsapp"> }) {
  if (!process.env.DATABASE_URL || input.scheduledFor.getTime() <= Date.now()) return false;
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    return await sql.begin(async (tx) => {
      const workflows = await tx<{ id: string }[]>`select id from workspace_workflows where workspace_id = ${input.workspaceId} and service_slug = ${input.workflowSlug} and status = 'active' limit 1`;
      if (!workflows[0]) return false;
      const runs = await tx<{ id: string }[]>`insert into workflow_runs (workspace_id, workflow_id, customer_id, trigger_type, status, input) values (${input.workspaceId}, ${workflows[0].id}, ${input.customerId}, ${input.triggerType}, 'queued', ${tx.json({ scheduledFor: input.scheduledFor })}) returning id`;
      for (const channel of input.channels) {
        const scheduled = await tx<{ id: string }[]>`insert into scheduled_customer_messages (workspace_id, customer_id, channel, purpose, body, scheduled_for) values (${input.workspaceId}, ${input.customerId}, ${channel}, 'update', ${input.body}, ${input.scheduledFor}) returning id`;
        await tx`insert into workflow_actions (workspace_id, workflow_run_id, action_type, channel, status, payload) values (${input.workspaceId}, ${runs[0].id}, 'scheduled_customer_update', ${channel}, 'queued', ${tx.json({ scheduledMessageId: scheduled[0].id })})`;
      }
      return true;
    });
  } finally { await sql.end(); }
}
