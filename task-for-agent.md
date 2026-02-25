# Task: Write TypeScript API Contract Types for ENS Names-by-Address API

## Background

You are designing TypeScript types for a REST API that returns ENS (Ethereum Name Service) names associated with a given Ethereum address.

ENS names can be owned/controlled via multiple different on-chain mechanisms ("relations"), and different names have radically different lifecycle models — some never expire, some follow ENSv1 .eth rules with grace periods, and others have lifecycles we don't yet know how to classify. The types must be future-proof and correctly use discriminated unions to handle these cases.

---

## Endpoint

```
GET /api/names/by-address/:address
```

---

## Request

### Path Parameter

| Field     | Type    | Description                                      |
|-----------|---------|--------------------------------------------------|
| `address` | Address | 20-byte Ethereum hex address, any capitalization |

### Query Parameters

| Field                 | Type                   | Required | Default                               | Description |
|-----------------------|------------------------|----------|---------------------------------------|-------------|
| `chainId`             | string \| "any"        | No       | "any"                                 | Chain scope. "any" = no filter. Valid values: "1" (Ethereum), "8453" (Base), etc. |
| `relations`           | string (CSV)           | No       | "token_owner,explicit_registry_owner" | Comma-separated distinct set of: `token_owner`, `explicit_registry_owner`, `resolved_any`. Errors on unknown or repeated values. |
| `lifecycleStatus`     | string (CSV)           | No       | "any"                                 | Comma-sep filter. Options: `active`, `expiring_soon`, `released_grace`, `released_full`. Applies only to names with `lifecycle.type = "graced_expiry"`. Names with `lifecycle.type = "none"` or `"unknown"` are always included when this param is absent or "any". |
| `expiringSoonDuration`| string                 | No       | "120d"                                | Duration format: `1s`, `30m`, `20h`, `2d`, `1y`. A name is `expiring_soon` if `now() > expiry - duration`. |
| `sortBy`              | "name" \| "expiration" | No       | "name"                                | Sort field. See note on `expiration` sort for names with no lifecycle. |
| `sortDirection`       | "asc" \| "desc"        | No       | "asc"                                 | |
| `limit`               | integer (1–100)        | No       | 10                                    | Results per page. |
| `cursor`              | string                 | No       | —                                     | Opaque cursor from previous response. |

> **Note on `sortBy=expiration`:** Names with `lifecycle.type = "none"` (no expiry) must be placed at a defined position — either always first or always last — when sorting by expiration. This policy must be captured in a JSDoc comment on the relevant type.

---

## Response

### Success `200 OK`

Top-level shape:
- `responseCode`: `"ok"`
- `accurateAsOf`: Unix timestamp (seconds). All relative time fields (e.g. `expiresIn`) are anchored to this.
- `names`: Array of name result objects (see below)
- `pagination`: Pagination state

### Name Result Object

Each name has the following fields:

---

#### `name` — discriminated union on `type`

- `{ type: "known"; name: string }` — all labels are normalized and fully decoded.

  Example: `{ type: "known", name: "vitalik.eth" }`

- `{ type: "undecoded"; name: string; parts: NamePart[] }` — one or more labels are unknown (only their hash is available). The `name` field contains the stringified name using encoded labelhash notation (`[<hex>]` for unknown labels). The `parts` array has one entry per label (left to right), each with:
  - `labelHash: string` — always present (keccak256 hash of the label)
  - `label: string | null` — decoded label if known; `null` if unknown

  Example:
  ```json
  {
    "type": "undecoded",
    "name": "[4f5b8...91234].eth",
    "parts": [
      { "labelHash": "0x4f5b812789fc606be1b3b16908db13fc...", "label": null },
      { "labelHash": "0x93cdeb708b7545dc668eb9280176169d...", "label": "eth" }
    ]
  }
  ```

---

#### `domainId` — `Namehash`

Namehash of the domain. Unique deterministic identifier. Always lowercase hex.

---

#### `relations`

Always returns all known relations for the name regardless of which `relations` query param was passed. Contains:

- **`resolved`**: `Record<CoinType, { type: "known"; address: Address } | { type: "none" }>`
  Map of SLIP-44 coinType string → resolution state. Each value is either a confirmed address (`"known"`) or confirmed unset (`"none"`). The map only includes coin types we have indexed; absence of a key means no data for that coin type.

- **`tokenOwner`**: discriminated union on `type`
  NFT ownership. Three possible states:
  - `{ type: "known"; address: Address }` — confirmed owner
  - `{ type: "none" }` — confirmed no owner (zero address, burned token, or no token exists)
  - `{ type: "unknown" }` — cannot determine (e.g., not yet indexed for this chain/name)

  > Only `tokenOwner` has the `"unknown"` variant for now; other relation fields do not.

- **`explicitRegistryOwner`**: discriminated union on `type`
  ENS registry owner:
  - `{ type: "known"; address: Address }` — registry owner is set
  - `{ type: "none" }` — confirmed not set

---

#### `lifecycle` — discriminated union on `type`

```
type Lifecycle =
  | { type: "none" }
  | { type: "unknown" }
  | LifecycleGracedExpiry
  // NOTE: clients MUST support receiving new `type` values in the future. If client does not know how to handle a new type, it must consider it as "unknown".
```

**Variants:**

1. **`{ type: "none" }`**
   We know this name has no lifecycle — it never expires.
   Example: the TLD "eth" itself.

2. **`{ type: "unknown" }`**
   We don't know the lifecycle, or we haven't implemented handling for it yet.
   Examples: "box", "gift.box", unwrapped subnames like "abc.lev.eth"

3. **`{ type: "graced_expiry"; status: ...; expiry: ...; gracePeriod: ... }`**
   ENSv1 `.eth` base registry lifecycle — the name has a known expiry date AND a grace period after expiry before it is fully released.
   Examples: "lev.eth", wrapped subnames like "abc.lev.eth"

   Fields:
   - `status`: current state — one of:
     - `"active"` — registered and not expiring soon
     - `"expiring_soon"` — within `expiringSoonDuration` of expiry
     - `"released_grace"` — expired; original owner can still re-register (grace period active)
     - `"released_full"` — grace period ended; anyone can register
   - `expiry`: `{ expiresAt: UnixTimestamp; expiresIn: number }` — `expiresIn` is seconds from `accurateAsOf`; negative if already expired
   - `gracePeriod`: `{ gracePeriodEndsAt: UnixTimestamp; gracePeriodEndsIn: number }`

---

### Pagination

- `limit`: `number`
- `cursor`: `string | null` — opaque next-page cursor; `null` if no next page
- `hasMore`: `boolean`

---

### Error Response `400 | 500`

- `responseCode`: `"error"`
- `error`: discriminated union on `type`:
  - `{ type: "validation"; message: string; fields?: { path: string; reason: string }[] }`
  - `{ type: "not_found"; message: string }`
  - `{ type: "rate_limited"; message: string; retryAfterSec?: number }`
  - `{ type: "internal"; message: string }`

---

## Primitive Types to Define

```ts
type Address = string;         // 20-byte hex, checksummed or not
type UnixTimestamp = number;   // seconds since epoch
type ChainId = string;         // e.g. "1", "8453"
type Namehash = string;        // lowercase 32-byte hex
type CoinType = string;        // SLIP-44 numeric string, e.g. "60" = ETH
type DurationString = string;  // e.g. "120d", "30m", "1y"
type Cursor = string;          // opaque pagination cursor

type NamePart = {
  labelHash: string;    // keccak256 hash of the label
  label: string | null; // decoded label, or null if unknown
};
```

---

## Output Format Requirements

Produce a **single TypeScript file** (`api-contract.ts`) using:

- A top-level `Endpoints` namespace with one named type per endpoint.
  Each type has: `method`, `path`, `params?` (path params), `query?` (query params), `response`.
- A generic `ApiResponse<T>` using a discriminated union on `responseCode: "ok" | "error"`.
- An `ApiError` type using a discriminated union on `type`.
- All domain types at the top level (not nested inside the namespace).
- Lifecycle as a proper discriminated union with JSDoc on each variant.
- Relations always returned in full regardless of query filter.

**Style:**
- Use `export type` for union types and plain object shapes.
- Use `export interface` only for shapes that benefit from `extends`.
- Use `/** */` JSDoc to explain non-obvious fields.
- Prefer `T | null` (explicit absence) over `T | undefined`.

---

## Future Extensibility (encode as JSDoc comments in output)

- `relations` query param may gain: `resolved_<coinType>`, `reverse_any`, `reverse_<chainId>`, `reverse_default`, `primary_any`, `primary_<chainId>`, `primary_default`
- `lifecycle.type` may gain new variants — clients must treat unknown values gracefully
- Sibling endpoints planned: `/api/names/by-parent/:parentNode`, `/api/names/search`, `/api/names/primary/:address`
