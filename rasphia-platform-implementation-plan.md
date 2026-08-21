# Rasphia Platform Implementation Plan

## 1. Product definition

Rasphia is a multi-tenant operating layer for local service businesses. It finds revenue leaks, recommends fixed services, and runs the approved workflows behind them.

The core promise is:

> Rasphia diagnoses where leads, appointments, and returning customers fall through—then deploys AI agents to turn those moments into growth, retention, and revenue.

The product must not be a blank automation builder. Merchants select from fixed Rasphia services, connect the tools they already use, review the workflow, and activate it.

## 2. Fixed Rasphia services

Every diagnosis can recommend up to three services from this catalogue:

1. Instant lead response
2. Customer follow-up & reactivation
3. Review & reputation management
4. Booking & no-show protection
5. Membership & renewal retention
6. Quote follow-up & repeat service
7. Payment & package automation
8. Local discovery & AI visibility

Each service is a prebuilt workflow with configurable business rules, approved messages, and outcome reporting.

## 3. Agreed technology and integration decisions

| Area | Decision |
|---|---|
| Authentication | Google OAuth for Rasphia account creation and dashboard access |
| Email | Central Rasphia Resend account |
| Email sender | `Business Name via Rasphia <business-slug@rasphia.com>` |
| Calendar | Google Calendar only for the initial release |
| Messaging | One managed Rasphia WhatsApp Business Platform account for the initial release |
| Payments | Stripe and Razorpay only |
| Booking | Native Rasphia public booking pages, not third-party booking integrations |
| Knowledge base | Optional, folder-scoped Google Drive connection |
| Data | A multi-tenant Rasphia database is the system of record |

## 4. Workspace, identity, and tenancy model

Each merchant has an isolated workspace. A Google sign-in creates a Rasphia user, a merchant workspace, and an empty customer database partition.

```text
Google sign-in
  → Rasphia user
  → merchant workspace
  → owner membership
  → workspace-scoped customer database
  → onboarding
  → dashboard
```

Use Google identity scopes only at sign-up:

```text
openid email profile
```

Request Google Calendar or Drive permissions only when the merchant explicitly connects that product. This is incremental authorization, not part of initial sign-up.

### Roles

| Role | Access |
|---|---|
| Owner | Billing, integrations, data, settings, team, workflows |
| Admin | Operations, customers, bookings, workflows, integrations |
| Staff | Assigned bookings and conversations only |
| Viewer | Read-only dashboard reporting |

Every operational row must be protected by `workspace_id`. Never accept a workspace ID from the client without verifying that the authenticated user belongs to it.

## 5. Merchant onboarding

The desired setup time is fewer than 15 minutes for a basic lead-response and booking workflow.

```text
1. Continue with Google
2. Create business profile
3. Select business goal
4. Connect only required tools
5. Configure and preview workflow
6. Run a test
7. Activate
```

### Step 1: Google sign-in

Create the user, workspace, owner membership, and initial settings.

### Step 2: Business profile

Collect:

- Business name and public booking slug
- Business type/niche
- Country, timezone, and business address
- Main email and notification email
- Preferred customer channels: email, WhatsApp, or both
- Business hours and brand tone

### Step 3: Goal selection

Merchant selects one or more goals:

- More leads
- More bookings
- More repeat customers
- Fewer no-shows
- Faster payment collection
- More time back

Rasphia then recommends relevant fixed services.

### Step 4: Connect tools

Show only integrations required for the selected service.

| Service | Required connection | Optional connection |
|---|---|---|
| Instant lead response | Email | WhatsApp, Google Calendar |
| Follow-up & reactivation | Email or WhatsApp | CSV import, Google Calendar |
| Reviews | Email or WhatsApp | Google Business Profile in a later phase |
| Booking & no-show protection | Google Calendar | Stripe or Razorpay |
| Membership retention | Customer CSV import | Calendar, payment provider |
| Quote follow-up | Email | WhatsApp, Drive knowledge base |
| Payment automation | Stripe or Razorpay | Email, WhatsApp, native booking |
| Local discovery | Business profile | Website and Google Business Profile in a later phase |

### Step 5: Workflow preview

The merchant sees before activation:

- Trigger
- Customer audience
- Message channel
- Exact message copy
- Timing
- Booking/payment link behavior
- Escalation conditions
- Success metric

### Step 6: Test mode

Send a test email and, where eligible, a test WhatsApp template. Create a test booking and test payment link. Do not activate a workflow until its required connections pass validation.

### Step 7: Activate

Merchant explicitly turns the workflow on. Record the operator, timestamp, current configuration, and template version.

## 6. Dashboard

```text
Overview
Bookings
Conversations
Customers
Workflows
Payments
Knowledge base
Settings
```

### Overview

Prioritize business value:

- New leads
- Bookings created
- Follow-ups sent
- Payments collected
- No-shows recovered
- Reviews requested
- Conversations requiring a human response

### Bookings

- Public booking page configuration
- Services, duration, staff, hours, buffers, and policies
- Upcoming, cancelled, completed, and no-show bookings
- Google Calendar connection and calendar selection
- Deposit/payment requirements

### Conversations

- Shared email and WhatsApp conversation timeline
- Suggested AI replies and source-aware answers
- Human assignment and escalation queue
- Customer activity: enquiry, booking, payment, follow-up, outcome

### Customers

- Workspace-scoped customers only
- Consent, source, tags, booking/payment history, and conversation history
- CSV import with field mapping, deduplication, and consent confirmation
- Segments: new lead, booked, overdue, lapsed, unpaid, trial, repeat

### Workflows

Each fixed service can be draft, test, active, or paused. It exposes its trigger, audience, timing, messages, approval requirement, and outcome metric.

### Payments

- Connect Stripe or Razorpay
- Define deposits, packages, and payment rules
- Create and track payment links
- View paid, pending, failed, expired, cancelled, refunded, and disputed payments

### Knowledge base

- Select a Google Drive folder or upload documents
- Approve documents before AI use
- List allowed topics and mandatory escalations
- Display sync status and source documents

### Settings

- Business profile and brand voice
- Team and permissions
- Email sender/reply routing
- WhatsApp consent and template settings
- Calendar, booking, payments, and notifications
- Data export and deletion controls

## 7. Communications architecture

### 7.1 Email

Rasphia sends from the verified `rasphia.com` domain using Resend.

```text
From: Business Name via Rasphia <business-slug@rasphia.com>
Reply-To: replies@rasphia.com
```

Route replies into the appropriate workspace using a unique reply address or inbound-message metadata. Preserve `workspace_id`, `customer_id`, `workflow_run_id`, and message IDs on every outgoing message.

Use email for:

- Lead replies
- Booking confirmation, cancellation, and reminders
- Quote follow-up
- Reactivation and recall campaigns
- Payment links and receipts
- Review requests

### 7.2 WhatsApp

Use the managed Rasphia WhatsApp Business Platform account for the first release. The visible identity and every consent surface must make the relationship clear:

```text
Rasphia for [Business Name]
```

Use WhatsApp for:

- New enquiry acknowledgement and qualification
- Service/staff matching
- Booking links and booking reminders
- Payment links
- Follow-up and reactivation
- Customer questions answered from approved merchant knowledge
- Human escalation

Every contact must have explicit WhatsApp consent, recorded with time, source, consent language version, and the business name. Use approved templates for business-initiated conversations and preserve the customer-service-window rules.

The shared account is a deliberate MVP trade-off. High-volume or high-trust merchants should later be migrated to a dedicated business-owned WhatsApp account and phone number through Embedded Signup.

### 7.3 AI agent boundaries

The agent may answer only approved, business-specific operational questions. It must escalate:

- Pricing or availability not present in the approved source of truth
- Medical, dental, legal, tax, financial, or safety advice
- Complaints requiring compensation or sensitive handling
- Refunds, disputes, or policy exceptions
- Any confidence-low answer

For healthcare, law, and accounting businesses, the agent is administrative only: it books, routes, collects non-sensitive intake information, and answers approved business FAQs. It does not give professional advice.

## 8. Native booking platform

Each merchant gets a public booking URL:

```text
rasphia.com/book/{business-slug}
```

The booking page contains:

- Business identity and contact information
- Service selection
- Staff selection where applicable
- Live slots from Google Calendar
- Customer name, email, and phone
- Email/WhatsApp consent
- Deposit or payment-link step where required
- Confirmation, cancellation, and rescheduling controls

### Booking completion flow

```text
Customer selects service and slot
  → Rasphia creates booking
  → Rasphia creates Google Calendar event
  → optional payment/deposit link is collected
  → customer receives email confirmation
  → merchant receives email notification
  → customer receives WhatsApp confirmation when consented
  → reminders and follow-up workflow are scheduled
```

Store booking status separately from payment status. A booking can be `confirmed` while its payment is `pending`.

## 9. Google Calendar integration

Google Calendar is the only calendar integration in the initial release.

Required capabilities:

- Google OAuth with incremental calendar scope
- Select one or more calendars to check for conflicts
- Select one target calendar for Rasphia-created events
- Read free/busy availability
- Create, update, and cancel events
- Add booking/customer metadata to event descriptions
- Handle OAuth refresh and expired/revoked authorization
- Support timezone, booking duration, and buffer rules

The application remains authoritative for booking status; Calendar is the merchant-facing schedule mirror.

## 10. Payments architecture

### 10.1 Merchant payment connections

For the MVP, the merchant provides:

- Provider: Stripe or Razorpay
- API key/secret stored encrypted at rest
- Webhook secret stored encrypted at rest
- Currency
- Business display name
- Deposit/payment rules

Create one `payment_connection` per provider account, attached to one workspace. Do not log credentials, expose them in client responses, or send them to analytics providers.

### 10.2 Payment links

Rasphia creates payment links in the merchant's payment account. It sends the URL through the approved email and WhatsApp channels and connects it to the booking/customer/workflow timeline.

```text
Booking or workflow event
  → create provider payment link
  → persist payment_link record
  → send email and/or WhatsApp message
  → receive verified webhook
  → update payment record and booking status
  → send receipt/confirmation
```

### 10.3 Webhooks

Use tenant-aware public endpoints:

```text
/api/webhooks/stripe/{workspace-id}
/api/webhooks/razorpay/{workspace-id}
```

Each endpoint must:

1. Read the raw request body.
2. Verify the provider signature with the encrypted webhook secret.
3. Persist the incoming event before processing.
4. Deduplicate by provider event ID.
5. Resolve the workspace/payment connection.
6. Update payment and booking records idempotently.
7. Queue customer and merchant notifications.
8. Return a fast `2xx` response.

Stripe Connect should be evaluated as the post-MVP replacement for per-merchant Stripe secret-key storage. It allows merchant-owned connected accounts and platform-created payment links while keeping the merchant as the payment recipient.

## 11. Google Drive knowledge base

Drive is optional. Ask merchants to select one folder, never grant broad access by default.

Suitable documents:

- Services, pricing, and package descriptions
- FAQs
- Deposit, cancellation, and return policies
- Staff/service descriptions
- Brand tone and approved responses
- Quote templates

Knowledge ingestion flow:

```text
Merchant selects Drive folder
  → Rasphia lists files
  → merchant approves files
  → Rasphia extracts/chunks/indexes content
  → source and version are attached to every answer
  → scheduled sync checks for approved file changes
```

Exclude sensitive patient, legal-client, financial-client, and confidential files until the relevant privacy and compliance requirements are explicitly implemented.

## 12. Database model

The database is the single source of truth. Google Calendar, payments, email, and WhatsApp are connected channels, not the source of truth.

### Identity and tenancy

```text
users
oauth_accounts
sessions

workspaces
workspace_members
workspace_invites
workspace_settings
```

### Connections and business configuration

```text
google_connections
calendar_connections
drive_connections
payment_connections
whatsapp_connections

booking_pages
booking_services
staff
availability_rules
```

### Customer system of record

```text
customers
customer_consents
customer_tags
customer_events
customer_conversations
messages
message_deliveries
```

### Bookings and payments

```text
bookings
booking_reminders
payment_links
payments
payment_events
webhook_events
```

### Automation and knowledge

```text
workflow_templates
workflow_enrollments
workflow_runs
workflow_actions
approval_requests

knowledge_sources
knowledge_documents
knowledge_chunks
```

All tables containing merchant data include `workspace_id`; indexes and row-level authorization must use it.

## 13. Core workflow templates

| Service | Trigger | Core actions | Outcome |
|---|---|---|---|
| Instant lead response | New form, email, or WhatsApp enquiry | Reply, qualify, route, send booking link | Qualified consultation/booking |
| Follow-up & reactivation | Customer becomes inactive | Personalised return invitation and booking link | Return booking |
| Reputation management | Completed positive visit | Review request; route unhappy replies privately | More quality reviews and faster recovery |
| Booking/no-show protection | Booking created or missed | Confirmation, reminders, deposit link, recovery | Fewer empty slots |
| Membership retention | Attendance decline or renewal date | Nudge, plan/booking offer, staff alert | Renewal or re-engagement |
| Quote follow-up | Quote sent | Timed follow-up, question routing, booking/payment link | Quote converted to job |
| Payment automation | Booking/invoice requires payment | Payment link, reminder, paid confirmation | Faster collections |
| Discovery/AI visibility | Diagnosis identifies weak visibility | Task checklist and approved business-fact updates | More qualified discovery |

## 14. Security, consent, and reliability requirements

- Encrypt provider tokens, API keys, and webhook secrets at rest.
- Use least-privilege OAuth scopes and incremental authorization.
- Log administrative actions, workflow activation, consent, and human overrides.
- Keep raw provider webhook events for replay/debugging.
- Make all webhook, email, message, booking, and payment processing idempotent.
- Use queues for workflow execution and retries; do not perform long work inside webhooks.
- Implement unsubscribe/opt-out handling for email and WhatsApp.
- Keep tenant data isolated in every database query and background job.
- Add rate limits and abuse controls to public booking and lead forms.
- Provide deletion/export tools for a merchant's data and customers.
- Require human approval for high-risk content and policy exceptions.

## 15. Delivery phases

### Phase 0: Foundation

- Authentication with Google OAuth
- Workspaces, roles, row-level tenant authorization
- Customer database and event timeline
- Dashboard shell and onboarding
- Audit logging, encrypted connection storage, queues, and webhook event store

### Phase 1: Native booking and email

- Business settings and services
- Public Rasphia booking pages
- Google Calendar availability and event creation
- Resend email sender, templates, delivery records, and reply routing
- Booking confirmation, cancellation, and reminder workflows

### Phase 2: Payments

- Stripe and Razorpay connection setup
- Payment link generation
- Verified and idempotent provider webhooks
- Deposit rules and payment-linked bookings
- Email payment requests, receipts, and failure reminders

### Phase 3: WhatsApp and conversation routing

- Managed WhatsApp inbound/outbound webhooks
- Workspace routing and customer identity matching
- Consent capture and template management
- Lead qualification, booking/payment links, and human handoff
- Conversation inbox and timeline

### Phase 4: Fixed workflows and reporting

- Activate the eight fixed Rasphia services
- Draft/test/active/paused workflow lifecycle
- Outcome metrics per workflow
- Customer segments and CSV import
- Merchant overview dashboard

### Phase 5: Knowledge base and advanced integrations

- Folder-scoped Google Drive connection
- Document approval, indexing, sync, and source tracking
- AI response guardrails and escalation controls
- Stripe Connect evaluation
- Dedicated merchant WhatsApp account onboarding for qualifying merchants
- Google Business Profile and discovery tooling

## 16. MVP acceptance criteria

A merchant can:

1. Sign in with Google and create a workspace.
2. Set up their business profile and native booking page.
3. Connect Google Calendar.
4. Add services, availability, and booking rules.
5. Receive a booking through their public Rasphia URL.
6. Receive a merchant email while the customer receives an email confirmation.
7. Connect Stripe or Razorpay and collect a payment/deposit link.
8. See booking, customer, message, and payment history in one tenant-isolated dashboard.
9. Activate at least instant lead response, booking reminders, payment reminders, and customer reactivation.
10. Connect WhatsApp, where consent/template requirements are met, and route conversations to the correct workspace.

## 17. External implementation constraints

- Resend requires a verified domain for production sending; use the verified Rasphia domain rather than creating a mailbox for each merchant. [Resend sender documentation](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend)
- WhatsApp business-initiated outreach requires opt-in and approved templates outside the active customer-service window; do not represent Rasphia as a merchant without clear permission. [WhatsApp Business Policy](https://whatsappbusiness.com/policy/)
- Razorpay payment links and webhooks support the planned payment-link flow; webhook signature verification must use the raw request body. [Razorpay Payment Links](https://razorpay.com/docs/api/payments/payment-links/), [Razorpay webhooks](https://razorpay.com/docs/webhooks/payment-links/)
- Stripe Connect is the preferred future model for merchant-owned payment accounts and payment links, avoiding persistent storage of a merchant's Stripe secret key. [Stripe Connect Payment Links](https://docs.stripe.com/connect/payment-links)
