# MAX Contact Manager Agent

A specialized AI agent that manages contacts in [SecurityScorecard](https://securityscorecard.com)'s **MAX** cybersecurity risk management platform using natural language. Instead of following [the manual guide](https://zitenote.atlassian.net/wiki/spaces/MAXX/pages/5713100852/Guide+How+to+use+MAX+Contact+Management+endpoints) and writing Python scripts on top of the public Contacts API, you talk to the agent in natural language.

## Why a specialized agent?

A generic AI agent with access to API docs and a key can technically call any endpoint, but the results are unpredictable and fragile. This agent is purpose-built for MAX Contacts, which gives it several advantages:

- **Controlled scope** — the agent can only do what its limited set of tools (endpoint calls) allows; no surprise actions.
- **Built-in MAX context** — it understands the domain model (partners, customers, vendors, contacts) and the business rules around them, so it makes the right calls without guesswork.
- **Reliable** — because tools and context are pre-defined, responses are consistent and reproducible.
- **Secure** — secrets are loaded from a `.env` file. In production this could be swapped for Vault or any other centralized secret store.
- **Observable** — the architecture supports adding NewRelic (or similar) so that unexpected behavior or repeated actions trigger a supervision notification.

## What it can do

- **Add, edit, delete, and list** MAX Contacts using natural language
- **Resolve domains to IDs automatically** — say "list contacts for olda.dev" and the agent looks up the customer/vendor UUID behind the scenes
- **Link contacts to vendors** — assign a contact to a specific third-party vendor within a customer
- **Guard against mistakes** — confirms destructive actions and warns when deleting a contact's last customer link (which permanently removes it)

## How it works

The agent runs an agentic tool-use loop powered by **Claude** (Anthropic API). It exposes the MAX Contacts API as a set of tools that the model can call on your behalf:

| Tool | Purpose |
|---|---|
| `get_managed_customers` | Resolve a customer domain/name to a UUID |
| `get_vendors` | Resolve a vendor domain to a UUID |
| `list_contacts` | Paginated contact listing with optional vendor filter |
| `get_contact` | Fetch a single contact by ID |
| `create_contact` | Add a customer or vendor contact |
| `update_contact` | Change email (global) or name (per-customer) |
| `delete_contact` | Unlink a contact from a customer |

## Quick start

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)
- A valid MAX platform token

### Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in your Anthropic API key and MAX platform token.

### Run

```bash
npm start
```

Then just type naturally:

```
You: list all contacts for olda.dev
You: For our customer olda.dev and their vendor tesla.com add a new contact - john@tesla.com, fullname John Matrix
You: add john@example.com as a vendor contact for datadoghq.com under olda.dev customer
You: delete that contact
```

Type `quit` or `exit` to stop.

## TODO

- [ ] Bulk-import contacts from a CSV file (`bulk_import_contacts` tool)

## Related

- [MAXX-5062](https://securityscorecard.atlassian.net) — ticket that exposed the public Contact Management endpoints
- [Guide: How to use MAX Contact Management endpoints](https://zitenote.atlassian.net/wiki/spaces/MAXX/pages/5713100852/Guide+How+to+use+MAX+Contact+Management+endpoints) — the manual approach this agent replaces
