# Pulse

This repository is a coding challenge for engineering candidates. It is not intended
for production use.

Pulse is a small internal customer-feedback inbox for support teams. Sign in, browse
incoming feedback across email, chat, and app-store channels, open an item to read the
full message and customer details, resolve or reopen it, generate a quick AI summary,
and request AI-assisted next steps for a human agent to review. The app also includes
assignment routing, priority and due-date fields,
customer profile history, internal notes, a small metrics panel, search, and CSV export.

## Requirements

- Node 20+
- npm

## Setup

1. Install dependencies (installs both the server and web packages):

   ```bash
   npm install
   ```

2. Create the environment files from the examples:

   ```bash
   cp server/.env.example server/.env
   cp web/.env.example web/.env
   ```

   The defaults run the app fully offline — the Summarize feature uses a built-in canned
   summarizer (`FAKE_LLM=true`), so no API key is required.

3. Seed the database with sample users, customers, and feedback:

   ```bash
   npm run seed
   ```

4. Start the API and the web app together:

   ```bash
   npm run dev
   ```

   - API: http://localhost:4000
   - Web: http://localhost:5173

Open the web app in your browser and sign in.

## Test logins

- Support agent: `alice@pulse.test` / `PulseAgent2026!`
- Manager: `ben@pulse.test` / `PulseManager2026!`

Agents can claim unassigned feedback and update items assigned to them. Managers can work across
the inbox, reassign ownership, review escalations, merge customers, and delete feedback. These
rules are enforced by the API; the frontend uses the returned permission matrix to show the
appropriate controls.

## Project layout

- `server/` — Node + Express + TypeScript API backed by SQLite (`better-sqlite3`).
- `web/` — React + TypeScript single-page app built with Vite.

## Optional: live summaries

To use a real model for the Summarize feature, set the following in `server/.env`:

```bash
FAKE_LLM=false
OPENAI_API_KEY=sk-...
OPENAI_TRIAGE_MODEL=gpt-4o-mini
OPENAI_SUMMARY_MODEL=gpt-4o-mini
OPENAI_ASSIST_MODEL=gpt-4o-mini
```

## Verification

Run the production checks for both workspaces:

```bash
npm run build
```
