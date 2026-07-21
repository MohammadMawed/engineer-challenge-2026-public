# Decisions

## What I found

Pulse worked on the happy path, but several shortcuts would hurt real users. Priority came from
repeating seed values rather than the feedback meaning. Pagination and filtered totals were
wrong, authentication trusted browser-stored tokens, authorization was inconsistent, and API
failures could crash the inbox. The server entry point also mixed database, routes, auth, and LLM
code, which made each fix riskier than it needed to be.

## What I changed

I focused first on trust and the daily support workflow.

- Split the server into routes, services, data, database, middleware, models, and bootstrap code.
- Added tracked SQLite migrations, constraints, indexes, additive seeding, and verified backups.
- Replaced plaintext passwords and local-storage JWTs with hashed passwords, revocable HttpOnly
  sessions, login throttling, reset tokens, restricted origins, and authentication audit events.
- Centralised authorization. Agents can claim unassigned work and act on their own feedback;
  managers can reassign, review escalations, merge customers, and delete feedback. The API remains
  the enforcement point, while the UI uses returned permissions to show the right controls.
- Replaced arbitrary priority with an OpenAI SDK classifier that returns a bounded priority and a
  short reason. Results are persisted and cached, and a human choice is never overwritten.
- Kept AI assistive rather than autonomous. Summaries and suggested next steps help the agent, but
  cannot change customer data or execute actions.
- Fixed pagination and totals, added explicit status updates, CRUD, notes, activity, duplicates,
  escalation, customer history, streamed exports, and a calmer responsive interface.
- Removed unsafe HTML rendering and neutralised spreadsheet formulas in CSV exports.

## Trade-offs

I did not try to build a full helpdesk. Routing still saves through two requests, the lifecycle is
only open/resolved, and there is no complete automated test suite or external-channel ingestion.
AI quality also needs evaluation against real support decisions before any automatic routing.

The most time went into fixing failures exposed by the refactor: migration ordering, startup paths,
session handling, and making frontend controls agree with backend permissions. I chose to make those
foundations reliable instead of adding more visible features.
