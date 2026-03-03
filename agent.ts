#!/usr/bin/env tsx

import { config as loadEnv } from "dotenv";
loadEnv(); // Load .env before anything reads process.env

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ── Configuration ─────────────────────────────────────────────────────────────

const PLATFORM_API_BASE_URL = process.env.MAX_PLATFORM_API_BASE_URL;
const TOKEN = process.env.MAX_TOKEN;

const AUTH_HEADERS: Record<string, string> = {
  Authorization: `Token ${TOKEN}`,
  Accept: "application/json",
};

// ── Load persistent context ────────────────────────────────────────────────────

const CONTEXT_FILE = path.join(__dirname, "context.md");
let SYSTEM_PROMPT: string;
try {
  SYSTEM_PROMPT = fs.readFileSync(CONTEXT_FILE, "utf-8");
} catch {
  SYSTEM_PROMPT = "You are a MAX contact management assistant.";
}

SYSTEM_PROMPT += `

## Your Role
You are a specialized agent for managing contacts in the MAX platform. Help the user
list, create, update, delete, and bulk-import contacts using the available tools.

Always:
- Confirm destructive actions (delete) before proceeding when intent is ambiguous.
- Warn that deleting a contact's last customer link permanently deletes the contact.
- Remind users of required CSV columns (email) before bulk import.
- Present API results in a readable, summarized format — don't dump raw JSON unless asked.
- Ask for missing required parameters rather than guessing.
`;

// ── API helper ─────────────────────────────────────────────────────────────────

async function apiCall(
  method: string,
  urlPath: string,
  options: RequestInit = {}
): Promise<string> {
  const url = `${PLATFORM_API_BASE_URL}${urlPath}`;
  const headers: Record<string, string> = { ...AUTH_HEADERS };

  headers["version"] = "beta";
  // Set JSON content type only for string bodies.
  // For FormData, let fetch set Content-Type with the multipart boundary.
  if (typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  console.log(`calling endpoint ${url} with method ${method} and headers ${JSON.stringify(headers)}`);
  console.log(`body: ${options.body}`);

  try {
    const resp = await fetch(url, { method, ...options, headers });
    const text = await resp.text();
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      console.log(`HTTP ${resp.status}: ${text}`);
      return `HTTP ${resp.status}: ${text}`;
    }
  } catch (e) {
    console.error(`Request failed: ${String(e)}`);
    return `Request failed: ${String(e)}`;
  }
}

// ── Tool implementations ───────────────────────────────────────────────────────

async function listContacts(
  customerId: string,
  page = 0,
  limit = 50,
  vendorId?: string
): Promise<string> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (vendorId != null) params.set("vendor_id", vendorId);
  return apiCall("GET", `/max/partner/customers/${customerId}/contacts?${params}`);
}

async function getContact(contactId: string): Promise<string> {
  return apiCall("GET", `/max/partner/contacts/${contactId}`);
}

async function createContact(
  customerId: string,
  email: string,
  firstName?: string,
  lastName?: string,
  vendorId?: string
): Promise<string> {
  const body: Record<string, string> = { email };
  if (firstName != null) body.first_name = firstName;
  if (lastName != null) body.last_name = lastName;
  if (vendorId != null) body.vendor_id = vendorId;

  console.log(`calling endpoint /max/partner/customers/${customerId}/contacts with body: ${JSON.stringify(body)}`);
  return apiCall("POST", `/max/partner/customers/${customerId}/contacts`, {
    body: JSON.stringify(body),
  });
}

async function updateContact(
  contactId: string,
  customerId: string,
  email?: string,
  firstName?: string,
  lastName?: string
): Promise<string> {
  const body: Record<string, string> = { customer_id: customerId };
  if (email != null) body.email = email;
  if (firstName != null) body.first_name = firstName;
  if (lastName != null) body.last_name = lastName;
  return apiCall("PUT", `/max/partner/contacts/${contactId}`, {
    body: JSON.stringify(body),
  });
}

async function deleteContact(contactId: string, customerId: string): Promise<string> {
  const params = new URLSearchParams({ customer_id: customerId });
  return apiCall("DELETE", `/max/partner/contacts/${contactId}?${params}`);
}

async function bulkImportContacts(
  customerId: string,
  csvFilePath: string
): Promise<string> {
  const resolved = path.resolve(
    csvFilePath.replace(/^~/, process.env.HOME ?? "~")
  );
  if (!fs.existsSync(resolved)) {
    return `Error: file not found: ${csvFilePath}`;
  }
  const fileBytes = fs.readFileSync(resolved);
  const blob = new Blob([fileBytes], { type: "text/csv" });
  const form = new FormData();
  form.append("file", blob, path.basename(resolved));

  try {
    const resp = await fetch(
      `${PLATFORM_API_BASE_URL}/max/partner/customers/${customerId}/contacts/bulk-import`,
      { method: "POST", headers: { ...AUTH_HEADERS }, body: form }
    );
    const text = await resp.text();
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return `HTTP ${resp.status}: ${text}`;
    }
  } catch (e) {
    return `Request failed: ${String(e)}`;
  }
}

async function getVendors(customerDomain?: string, vendorDomain?: string): Promise<string> {
  try {
    const resp = await fetch(`${PLATFORM_API_BASE_URL}/max/partner/vendors`, {
      method: "GET",
      headers: { ...AUTH_HEADERS, version: "beta" },
    });
    const text = await resp.text();
    let data: { entries: Array<Record<string, unknown>>; total: number };
    try {
      data = JSON.parse(text);
    } catch {
      return `HTTP ${resp.status}: ${text}`;
    }
    // Filter client-side — the API does not support server-side filtering.
    if (customerDomain || vendorDomain) {
      let entries = data.entries ?? [];
      if (customerDomain) {
        entries = entries.filter(
          (e) => (e.customer_domain as string)?.toLowerCase() === customerDomain.toLowerCase()
        );
      }
      if (vendorDomain) {
        entries = entries.filter(
          (e) => (e.vendor_domain as string)?.toLowerCase() === vendorDomain.toLowerCase()
        );
      }
      data = { entries, total: entries.length };
    }
    return JSON.stringify(data, null, 2);
  } catch (e) {
    return `Request failed: ${String(e)}`;
  }
}

async function getManagedCustomers(domain?: string, name?: string): Promise<string> {
  try {
    const resp = await fetch(`${PLATFORM_API_BASE_URL}/max/partner/managed-customers`, {
      method: "GET",
      headers: { ...AUTH_HEADERS, version: "beta" },
    });
    const text = await resp.text();
    let data: { entries: Array<Record<string, unknown>>; total: number };
    try {
      data = JSON.parse(text);
    } catch {
      return `HTTP ${resp.status}: ${text}`;
    }
    // Filter client-side — the API does not support server-side filtering.
    if (domain || name) {
      let entries = data.entries ?? [];
      if (domain) {
        entries = entries.filter(
          (e) => (e.customer_domain as string)?.toLowerCase() === domain.toLowerCase()
        );
      }
      if (name) {
        entries = entries.filter((e) =>
          (e.customer_name as string)?.toLowerCase().includes(name.toLowerCase())
        );
      }
      data = { entries, total: entries.length };
    }
    return JSON.stringify(data, null, 2);
  } catch (e) {
    return `Request failed: ${String(e)}`;
  }
}

// ── Tool schemas ───────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_contacts",
    description:
      "List contacts for a customer. Results are paginated. " +
      "Optionally filter by vendorId to show only vendor contacts for a specific vendor, " +
      "or omit vendorId to list all contacts.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "UUID of the customer whose contacts to list." },
        page: { type: "integer", description: "Page number (0-based). Default 0." },
        limit: { type: "integer", description: "Results per page. Default 50." },
        vendor_id: {
          type: "string",
          description:
            "Optional vendor UUID to filter results. " +
            "Omit entirely to get all contacts; pass null for customer-only contacts.",
        },
      },
      required: ["customer_id"],
    },
  },
  {
    name: "get_contact",
    description: "Retrieve a single contact by its ID.",
    input_schema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "UUID of the contact." },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "create_contact",
    description:
      "Create a new contact for a customer. " +
      "Provide vendorId to create a vendor contact; omit it for a customer contact.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "UUID of the customer this contact belongs to." },
        email: { type: "string", description: "Email address of the contact (required)." },
        first_name: { type: "string", description: "First name (optional)." },
        last_name: { type: "string", description: "Last name (optional)." },
        vendor_id: {
          type: "string",
          description: "Vendor UUID if this is a vendor contact. Omit or null for a customer contact.",
        },
      },
      required: ["customer_id", "email"],
    },
  },
  {
    name: "update_contact",
    description:
      "Update a contact's fields. " +
      "email is global (changes across all customers). " +
      "firstName and lastName are per-customer and require customerId.",
    input_schema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "UUID of the contact to update." },
        customer_id: {
          type: "string",
          description: "UUID of the customer context (required for per-customer fields).",
        },
        email: { type: "string", description: "New email address (global change, optional)." },
        first_name: { type: "string", description: "New first name for this customer (optional)." },
        last_name: { type: "string", description: "New last name for this customer (optional)." },
      },
      required: ["contact_id", "customer_id"],
    },
  },
  {
    name: "delete_contact",
    description:
      "Unlink a contact from a customer. " +
      "If this is the contact's only customer, the contact is permanently deleted.",
    input_schema: {
      type: "object",
      properties: {
        contact_id: { type: "string", description: "UUID of the contact to remove." },
        customer_id: {
          type: "string",
          description: "UUID of the customer to unlink the contact from.",
        },
      },
      required: ["contact_id", "customer_id"],
    },
  },
  {
    name: "bulk_import_contacts",
    description:
      "Bulk import contacts from a CSV file. " +
      "Required CSV column: email. Optional: firstName, lastName, vendorId. " +
      "Async job — returns 200 when accepted.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "UUID of the customer to import contacts for.",
        },
        csv_file_path: { type: "string", description: "Path to the CSV file to upload." },
      },
      required: ["customer_id", "csv_file_path"],
    },
  },
  {
    name: "get_vendors",
    description:
      "List all vendors managed by this partner, with their vendor_id, vendor_domain, and associated customer. " +
      "Use this to resolve a vendor domain to a vendor_id before calling other tools. " +
      "Always call this first when the user provides a vendor domain instead of a vendor UUID.",
    input_schema: {
      type: "object",
      properties: {
        customer_domain: {
          type: "string",
          description: "Filter by exact customer domain (e.g. 'olda.dev'). Client-side match.",
        },
        vendor_domain: {
          type: "string",
          description: "Filter by exact vendor domain (e.g. 'datadoghq.com'). Client-side match.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_managed_customers",
    description:
      "List all customers managed by this partner, with their customer_id, domain, and name. " +
      "Use this to resolve a domain or company name to a customer_id before calling other tools. " +
      "Always call this first when the user provides a domain or name instead of a UUID.",
    input_schema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Filter by exact domain (e.g. 'olda.dev'). Client-side match.",
        },
        name: {
          type: "string",
          description: "Filter by partial company name (case-insensitive). Client-side match.",
        },
      },
      required: [],
    },
  },
];

// ── Tool dispatch ──────────────────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

async function executeTool(name: string, input: ToolInput): Promise<string> {
  const s = (key: string) => input[key] as string | undefined;
  const n = (key: string, fallback: number) => (input[key] as number | undefined) ?? fallback;

  switch (name) {
    case "list_contacts":
      return listContacts(s("customer_id")!, n("page", 0), n("limit", 50), s("vendor_id"));
    case "get_contact":
      return getContact(s("contact_id")!);
    case "create_contact":
      return createContact(s("customer_id")!, s("email")!, s("first_name"), s("last_name"), s("vendor_id"));
    case "update_contact":
      return updateContact(s("contact_id")!, s("customer_id")!, s("email"), s("first_name"), s("last_name"));
    case "delete_contact":
      return deleteContact(s("contact_id")!, s("customer_id")!);
    case "bulk_import_contacts":
      return bulkImportContacts(s("customer_id")!, s("csv_file_path")!);
    case "get_vendors":
      return getVendors(s("customer_domain"), s("vendor_domain"));
    case "get_managed_customers":
      return getManagedCustomers(s("domain"), s("name"));
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Agentic loop ───────────────────────────────────────────────────────────────

// Use a loose message type to accommodate ThinkingBlock content in the history.
// The Anthropic SDK accepts ThinkingBlock from response.content back in messages at runtime.
type HistoryMessage = { role: "user" | "assistant"; content: unknown };

async function runTurn(client: Anthropic, messages: HistoryMessage[]): Promise<string> {
  while (true) {
    const stream = client.messages.stream({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: messages as Anthropic.MessageParam[],
      // Cast needed: SDK types haven't caught up with the "adaptive" value yet (Opus 4.6 GA).
      // thinking: { type: "adaptive" } as unknown as Anthropic.ThinkingConfigParam,
    });

    const response = await stream.finalMessage();

    // Append full content (thinking + text + tool_use blocks) to preserve multi-turn context.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    }

    // Execute all tool calls and collect results.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        process.stdout.write(
          `  \x1b[90m[tool] ${block.name}(${JSON.stringify(block.input)})\x1b[0m\n`
        );
        let result: string;
        try {
          result = await executeTool(block.name, block.input as ToolInput);
        } catch (e) {
          result = `Tool error: ${String(e)}`;
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "Error: ANTHROPIC_API_KEY is not set.\n" +
      "Copy .env.example to .env and add your Anthropic API key, then run again."
    );
    process.exit(1);
  }

  const client = new Anthropic();
  const messages: HistoryMessage[] = [];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  console.log("\x1b[1mMAX Contact Manager Agent\x1b[0m");
  console.log(`Connected to: ${PLATFORM_API_BASE_URL}`);
  console.log("Type 'quit' or 'exit' to stop.\n");

  while (true) {
    const input = (await ask("You: ")).trim();
    if (!input) continue;
    if (["quit", "exit", "q"].includes(input.toLowerCase())) {
      console.log("Bye!");
      rl.close();
      break;
    }

    messages.push({ role: "user", content: input });

    try {
      const reply = await runTurn(client, messages);
      console.log(`\nAgent: ${reply}\n`);
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        console.error(`Anthropic API error: ${e.message}`);
      } else {
        throw e;
      }
    }
  }
}

main().catch(console.error);
