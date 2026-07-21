# Known Issues

Pulse is a stronger base, but it is not a complete production helpdesk.

- Routing saves ownership/priority/due date and category/tags in two requests, so a partial save is
  still possible.
- The lifecycle only has open and resolved. There is no waiting-on-customer state, reply workflow,
  or email/chat ingestion.
- Duplicate scoring is lexical, and customer merge still asks managers for a raw customer ID with
  no preview or undo.
- AI priority and recommendations need evaluation, usage budgets, and per-user rate limits before
  production use. Initial classification can also add latency to an uncached inbox page.
- Permissions cover manager and assigned-agent actions, but not teams, queues, or customer-level
  access. User administration, SSO, and MFA are also outside this challenge.
- There is no complete automated API/UI suite, CI pipeline, production monitoring, or deployment
  configuration.

With another day, I would make routing one transactional endpoint, add focused integration tests
for login and authorization, improve empty/error states, and add “mine”, “unassigned”, and
“overdue” queue filters.
