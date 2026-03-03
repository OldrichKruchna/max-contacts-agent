# MAX Contact Manager — Agent Context

## About MAX

MAX is a cybersecurity risk management product by SecurityScorecard (SSC). Managing partners
use MAX to oversee cybersecurity risks for their customers. Those risks typically originate
from the customers' third-party **vendors**.

## Domain Model

| Entity | Role |
|---|---|
| **Partner** | The authenticated user managing everything. Owns customers. |
| **Customer** | An organization the partner manages. Has contacts and vendors. |
| **Vendor** | A third-party supplier that poses cyber risk to a customer. |
| **Contact** | A person (identified by email). Can be linked to a customer or to a vendor within a customer. |

A **contact** can be:
- **Customer contact** — `vendorId` is null/absent. Belongs to the customer org.
- **Vendor contact** — `vendorId` is a UUID. Belongs to a specific vendor of a customer.

The same email address can appear as a contact in multiple customers.

## Key Business Rules

1. **List + Create are per-customer**: the `customerId` path segment is mandatory.
2. **Delete is an unlink**: removes the contact from that customer. If it was the contact's
   only customer, the contact record is permanently deleted.
3. **Update semantics**:
   - `email` is **global** — changes the contact's email across all customers.
   - `firstName` / `lastName` are **per-customer** — `customerId` in the body is required.
4. **Bulk import** is async — the API returns 200 when the job is accepted, not when it finishes.
5. Request bodies use **snake_case**: `first_name`, `last_name`, `vendor_id`, `customer_id`.

## API Configuration

- **Platform API Base URL**: `https://platform-api.securityscorecard.qa` (env: `MAX_PLATFORM_API_BASE_URL`) — used for the managed-customers endpoint
- **Auth header**: `Authorization: Token xxx` (env: `MAX_TOKEN`)

## Domain → ID Resolution

**Always resolve domains to UUIDs before calling contact endpoints.**

- **Customer domain → customer_id**: Call `get_managed_customers` with the domain or name first,
  extract `customer_id` from the result, and use it in subsequent calls.
- **Vendor domain → vendor_id**: Call `get_vendors` with the `vendor_domain` (and optionally
  `customer_domain` to narrow the search), extract `vendor_id` from the result, and use it in
  subsequent calls.

Never ask the user to look up their own UUIDs.

## Endpoints

### 0a. Get Vendors (vendor_domain → vendor_id lookup)
```
GET https://platform-api.securityscorecard.qa/max/partner/vendors
```
Extra header required: `version: beta`

Response shape:
```json
{
  "entries": [
    {
      "vendor_id": "cffe376a-...",
      "vendor_name": "Datadoghq",
      "vendor_domain": "datadoghq.com",
      "customer_id": "49d974ae-...",
      "customer_name": "Olda",
      "customer_domain": "olda.dev",
      "business_impact": "critical",
      "incident_likelihood": "low",
      "tier": "silver",
      "custom_tags": [],
      "risk_status": ["needs_attention"],
      "has_active_breach": false
    }
  ],
  "total": 5
}
```
The API returns all vendors across all customers; domain filtering is done client-side.
Use `vendor_id` from the matching entry when a contact endpoint requires a vendor UUID.

### 0b. Get Managed Customers (customer_domain → customer_id lookup)
```
GET https://platform-api.securityscorecard.qa/max/partner/managed-customers
```
Extra header required: `version: beta`

Response shape:
```json
{
  "entries": [
    {
      "customer_id": "49d974ae-...",
      "customer_name": "Olda",
      "customer_domain": "olda.dev",
      "managed_vendors": 5,
      "available_slots": 4,
      "request_status": "APPROVED"
    }
  ],
  "total": 3
}
```
The API returns all customers; domain/name filtering is done client-side.
Use `customer_id` from the matching entry for all other endpoints.

### 1. List Contacts for Customer
```
GET /API/max/partner/customers/{customerId}/contacts
```
Query params:
- `page` (int, 0-based, default 0)
- `limit` (int, default 50)
- `vendorId` (string, optional) — filter by vendor UUID; omit for all contacts; pass null for customer-only contacts

### 2. Get Contact by ID
```
GET /API/max/partner/contacts/{contactId}
```

### 3. Create Contact for Customer
```
POST /API/max/partner/customers/{customerId}/contacts
```
Body (JSON):
- `email` (string, **required**)
- `firstName` (string, optional)
- `lastName` (string, optional)
- `vendorId` (string|null, optional) — null = customer contact; UUID = vendor contact

### 4. Update Contact
```
PUT /API/max/partner/contacts/{contactId}
```
Body (JSON):
- `customerId` (string, **required** — context for per-customer fields)
- `email` (string, optional — global)
- `firstName` (string, optional — per-customer)
- `lastName` (string, optional — per-customer)

### 5. Delete / Unlink Contact
```
DELETE /API/max/partner/contacts/{contactId}?customerId={customerId}
```
Query param:
- `customerId` (string, **required**) — unlinks from this customer; permanently deletes if last

### 6. Bulk Import Contacts (CSV)
```
POST /API/max/partner/customers/{customerId}/contacts/bulk-import
```
Body: `multipart/form-data`, field name `file`
CSV columns:
- `email` (**required**)
- `firstName`, `lastName`, `vendorId` (optional)

Returns 200 when job is accepted (async — processing continues in background).
