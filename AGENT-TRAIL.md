# Agent Trail

I used Codex throughout the challenge as an implementation partner, then checked its work with code
reading, builds, database inspection, and live API requests.

## Representative prompts

- “Create the files we need to start.”
- “Use the OpenAI SDK to classify priority on the initial fetch, with caching and logs.”
- “Clean the server structure and split the entry point into folders.”
- “Check the CRUD workflow, activity, duplicates, escalation, and customer history.”
- “Solve the login problems and separate manager controls from agent controls.”
- “Make the frontend responsive and prepare the final handoff files.”

## Where I corrected the agent

- Priority was initially described as length-based. Reading the seed showed it was actually a
  repeating arbitrary pattern, so I replaced it with an explicit support policy.
- Moving files broke the dev entry point, and an early migration attempted to alter a table before
  it existed. I traced both startup errors and corrected script paths and migration order.
- The frontend assumed every API response contained an array and crashed after a `401`. I added
  centralized response handling, session recovery, safe defaults, and an error boundary.
- Hiding buttons was not enough authorization. I added one backend policy and verified that agents
  receive `403` on another agent’s status, note, duplicate, escalation, merge, and delete actions.
- I rejected loading the whole dataset to support AI and duplicates. Inbox data stays paginated,
  duplicate candidates are bounded, and exports stream.

## Verification used

- Root server and web production build.
- Fresh database migration and additive seed smoke test.
- Login, logout, reset, lockout, session revocation, CORS, and authorization requests.
- Pagination, filtered totals, private notes, status activity, and cached AI fallback checks.
