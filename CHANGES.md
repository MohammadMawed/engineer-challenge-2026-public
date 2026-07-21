# Changes Made

This is the short version of what I found and changed.

| Problem | What changed |
| --- | --- |
| The UI looked like a demo and was hard to scan | Reworked the inbox, detail view, profile history, controls, and visual system. |
| Priority values were seeded randomly and then chosen manually | Added AI-assisted priority triage with clear severity rules, a reason, and an `ai`/`human` source. Human choices are never overwritten. |
| AI could make unnecessary repeat calls | Priority decisions are cached by policy version, model, channel, and message hash. Items already triaged are not sent again. |
| Priority did not appear on the first inbox result | Triage now runs during the inbox fetch, with a safe fallback if the provider is unavailable. |
| Summary used a separate raw HTTP call | Summary and priority triage now use the OpenAI SDK with a timeout, retry, and user-facing failure state. |
| Agents had no guidance beyond a summary | Added an AI support copilot that suggests ordered next steps, escalation guidance, and a human verification check without changing the ticket. Context-aware results are cached and concurrent requests are coalesced. |
| The server entry point mixed everything together | Split startup, app setup, routes, middleware, data access, models, database, and LLM service into folders. |
| Requests were hard to diagnose | Added safe request logs with method, path, status, and duration. |
| Pagination skipped the first page | Corrected the offset calculation. |
| Feedback and notes had incomplete CRUD | Added feedback create/update/delete and note edit/delete with ownership/manager checks. |
| Resolve/reopen was a non-idempotent toggle | Added an explicit status endpoint and updated the UI to send the intended state. |
| Changes had no audit trail | Added feedback activity records and an activity panel. |
| Feedback types were mixed together | Added category and tags, duplicate suggestions/marking, and customer merge support. |
| Escalations had no workflow | Added agent escalation requests and manager approval/rejection. |
| Filter totals ignored filters | Counts now use the same parameterised filters as the inbox query. |
| Seeding destroyed data | Seeding now creates missing data only and preserves existing records. |
| Private notes and routing had loose permissions | Private notes are limited to their author and managers; agents can claim unassigned work or route their own items. |
| Manager and agent controls were only partly separated | Added one backend authorization policy and API-provided permission matrix. Agents work their assigned feedback; managers can act across the inbox, review escalations, merge customers, and delete. The UI shows only allowed controls. |
| Login used plaintext passwords and browser-stored tokens | Added password hashing, revocable HttpOnly sessions, restricted CORS, security headers, lockout/rate limits, reset tokens, and authentication audit events. |
| Metrics and database integrity were unreliable | Corrected date-filtered metrics and added tracked migrations, constraints, foreign keys, integrity checks, and verified backups. |
| Some feedback operations loaded full datasets | Kept the inbox at 10 server-paginated rows, added an FTS-backed 50-row duplicate candidate bound, streamed CSV exports, and joined customer/assignee data into list queries. |

## Frontend design changes

- Replaced the noisy demo styling with a restrained support-workspace visual system: neutral surfaces, consistent spacing, readable type, and semantic status colours.
- Reworked the inbox into a scannable queue with metrics, filters, search, pagination, clear badges, and responsive behavior.
- Redesigned the feedback header around customer identity, feedback ID, channel, priority, status, timestamp, and a clearly labelled customer message.
- Rebuilt routing as its own section with ownership, priority, due date, category, tags, edit permissions, AI reasoning, save feedback, and disabled states.
- Turned customer history into compact navigable cards with status, channel, date, wrapped previews, health visualization, and a current-item marker.
- Combined Customer, Notes, Matches, and Activity into a fixed-height tabbed sidebar. Tabs stay visible while long content scrolls inside the active panel, avoiding an excessively long page.
- Redesigned duplicate suggestions with match scores, linked state, original-feedback navigation, clear actions, and undo.
- Improved the activity timeline so it explains what changed rather than showing generic event names.
- Added responsive layouts for desktop, tablet, and mobile, including stacked routing fields, wrapping actions, compact navigation, and safe handling of long text.
- Added loading/error handling, session-expiry behavior, optimistic rollback, and an error boundary so API failures do not crash the interface.
- Added a compact “Suggested next steps” panel with escalation severity, ordered actions, urgency labels, cache state, and a clear human-review warning.

## Important clarification

I did not find priority being calculated from message length. The original priority data
was seeded in a repeating, arbitrary pattern. The new classifier uses message meaning
and an explicit support policy instead.

## Not solved yet

Authentication still needs production identity management, MFA/SSO, and AI-route limits.
Routing should be saved atomically, and there is still no complete ticket lifecycle or automated
test suite.
