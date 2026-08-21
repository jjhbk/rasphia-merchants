export const WORKFLOW_CATALOG = [
  { slug: "instant-lead-response", name: "Instant lead response", outcome: "Turn a new enquiry into a qualified booking.", trigger: "New enquiry", channel: "Email or WhatsApp" },
  { slug: "follow-up-reactivation", name: "Customer follow-up & reactivation", outcome: "Bring quiet customers back at the right moment.", trigger: "Customer becomes inactive", channel: "Email or WhatsApp" },
  { slug: "review-reputation", name: "Review & reputation management", outcome: "Ask happy customers and recover unhappy ones privately.", trigger: "Completed visit", channel: "Email or WhatsApp" },
  { slug: "booking-no-show", name: "Booking & no-show protection", outcome: "Confirm, remind, and recover missed appointments.", trigger: "Booking created or missed", channel: "Email, WhatsApp, Calendar" },
  { slug: "membership-renewal", name: "Membership & renewal retention", outcome: "Nudge renewal before a member disappears.", trigger: "Renewal or attendance drop", channel: "Email or WhatsApp" },
  { slug: "quote-repeat-service", name: "Quote follow-up & repeat service", outcome: "Turn open quotes into booked work.", trigger: "Quote sent", channel: "Email or WhatsApp" },
  { slug: "payment-package", name: "Payment & package automation", outcome: "Collect faster with the right payment follow-up.", trigger: "Payment due", channel: "Email or WhatsApp" },
  { slug: "local-discovery", name: "Local discovery & AI visibility", outcome: "Keep the business easier to find and choose.", trigger: "Visibility task due", channel: "Merchant task" },
] as const;

export type WorkflowStatus = "draft" | "test" | "active" | "paused";
export const isWorkflowSlug = (value: string) => WORKFLOW_CATALOG.some((workflow) => workflow.slug === value);
