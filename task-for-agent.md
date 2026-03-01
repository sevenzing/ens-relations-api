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

| Field             | Type                   | Required | Default                           | Description |
|-------------------|------------------------|----------|-----------------------------------|-------------|
| `chainId`         | string \| "any"        | No       | "any"                             | Chain scope. "any" = no filter. Valid values: "1" (Ethereum), "8453" (Base), etc. |
| `relations`       | string (CSV)           | No       | "token_owner,root_registry_owner" | Comma-separated distinct set of: `token_owner`, `root_registry_owner`. Errors on unknown or repeated values. In future it's possible to add like `resolved_any`. |
| `lifecycleStatus` | string (CSV)           | No       | "active,none,unknown"             | Comma-sep filter on lifecycle state. Options: `active`, `expiring_soon`, `released_grace`, `none`, `unknown`. See mapping below. |
| `sortBy`          | "name" \| "expiration" | No       | "name"                            | Sort field. See note on `expiration` sort ordering for names with `lifecycle.type = "none"` or `"unknown"`. |
| `sortDirection`   | "asc" \| "desc"        | No       | "asc"                             | |
| `limit`           | integer (1–100)        | No       | 10                                | Results per page. |
| `cursor`          | string                 | No       | —                                 | Opaque cursor from previous response. |

**`lifecycleStatus` filter mapping to response structure:**
- `active` → `lifecycle.type = "graced_expiry"` AND `lifecycle.status.type = "active"`
- `expiring_soon` → `lifecycle.type = "graced_expiry"` AND `lifecycle.status.type = "active"` AND `lifecycle.status.expiringSoon = true`
- `released_grace` → `lifecycle.type = "graced_expiry"` AND `lifecycle.status.type = "released_grace"`
- `none` → `lifecycle.type = "none"` (covers names that never expire and names that are fully released)
- `unknown` → `lifecycle.type = "unknown"`

> **Note on `sortBy=expiration` ordering:** `lifecycle.type = "none"` (never expires) is treated as `∞` and follows the sort direction — last in `asc`, first in `desc`. `lifecycle.type = "unknown"` is always placed last regardless of sort direction, as it is missing data rather than a known infinite value.
> Sort order for `asc`: known expiries ascending → `none` (∞) → `unknown`
> Sort order for `desc`: `none` (∞) → known expiries descending → `unknown`

> **Note on `expiring_soon` threshold:** The threshold for what counts as "expiring soon" is hardcoded server-side (~120 days). It is intentionally not exposed as a query param, and the exact threshold is not committed to in the API contract — it may change. Clients should rely on the `expiringSoon` boolean field rather than computing it themselves.

---

## Response

### Success `200 OK`

Top-level shape:
- `responseCode`: `"ok"`
- `accurateAsOf`: Unix timestamp (seconds). All relative time fields (`expiresIn`, `gracePeriodEndsIn`) are anchored to this value.
- `names`: Array of name result objects (see below)
- `pagination`: Pagination state

### Name Result Object

Each name has the following fields:

---

#### `name` — `InterpretedName`

A `string` with special formatting guarantees: every label is either a normalized label or an encoded labelhash in `[<hex>]` notation. Full definition: https://ensnode.io/docs/reference/terminology/#interpreted-name

---

#### `domainId` — `Node`

Namehash of the domain. Unique deterministic identifier. Always lowercase hex.

---

#### `relations`

Always returns all known relations for the name regardless of which `relations` query param was passed. Contains:

- **`resolved`**: `Record<CoinType, { type: "known"; address: Address } | { type: "none" }>`
  Map of SLIP-44 coinType string → resolution state. Each entry is either a confirmed address (`"known"`) or confirmed unset (`"none"`). The map only includes coin types we have indexed; absence of a key means no data for that coin type. 
  
  > NOTE: Do not implement in this version — include the type definition only, for future proofing.

- **`rootRegistryOwner`**: discriminated union on `type`
  ENS root registry owner:
  - `{ type: "known"; address: Address }` — registry owner is set
  - `{ type: "none" }` — confirmed not set

- **`tokenOwner`**: discriminated union on `type` — represents NFT ownership.

  Three variants:

  **`{ type: "known"; address: Address; token: TokenInfo }`**
  The token is known to exist and has not expired. The API must coerce expired-but-still-indexed tokens to `"none"` — the contract says there is no owner the moment a token expires, even if there is no on-chain event removing the token_owner.

  **`{ type: "none" }`**
  Confirmed no current token owner. Covers: zero address, burned token, expired token, or name never tokenized.

  **`{ type: "unknown" }`**
  Cannot determine ownership — either impossible right now or not yet implemented.

  > Only `tokenOwner` has the `"unknown"` variant; other relation fields do not.

---

##### `TokenInfo` (included on `tokenOwner.type = "known"`)

Fields from the underlying token record:
- `id: string` — CAIP-19 Asset Identifier (e.g. `"eip155:1/erc721:0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85/12345"`)
- `chainId: ChainId`
- `contractAddress: Address`
- `tokenId: string` — bigint serialized as string
- `assetNamespace: string` — e.g. `"erc721"`

---

#### `lifecycle` — discriminated union on `type`

Describes the name's registration lifecycle.

```
type Lifecycle =
  | { type: "none" }
  | { type: "unknown" }
  | { type: "graced_expiry"; status: GracedExpiryStatus }
  // NOTE: clients MUST support receiving new `type` considering them as "unknown"
```

**`{ type: "none" }`**
We know this name has no lifecycle — it either never expires or not registered at all.
Example: the TLD "eth" itself.

**`{ type: "unknown" }`**
We don't know the lifecycle, or we haven't implemented handling for it yet.
Examples: "box", "gift.box", unwrapped subnames like "abc.lev.eth"

This is also the fallback value SDK clients should use when they receive a `type` value they don't recognize — treat any unknown future variant as `"unknown"` for display and filtering purposes.

**`{ type: "graced_expiry"; status: GracedExpiryStatus }`**
ENSv1 `.eth` base registry lifecycle — the name has a known expiry date AND a grace period after expiry before it is fully released.
Examples: "lev.eth", wrapped subnames like "abc.lev.eth"

---

##### `GracedExpiryStatus` — discriminated union on `type`

**`{ type: "active"; expiresAt: UnixTimestamp; expiresIn: number; expiringSoon: boolean }`**
Name is currently registered and not expired.
- `expiresAt` — absolute expiry timestamp
- `expiresIn` — seconds from `accurateAsOf`; always positive in this variant
- `expiringSoon` — true if within the server-defined threshold of expiry (~120 days). Exact threshold is not committed to in the contract.

**`{ type: "released_grace"; previousTokenOwner: Address; gracePeriodEndsAt: UnixTimestamp; gracePeriodEndsIn: number }`**
Name has expired but is still within its grace period. No `expiresIn` field — it would be negative (name already expired), so it is omitted.
- `previousTokenOwner` — address who held the token before it expired
- `gracePeriodEndsAt` — absolute timestamp when grace period ends
- `gracePeriodEndsIn` — seconds from `accurateAsOf` until grace period ends

---

### Pagination

- `limit: number`
- `cursor: string | null` — opaque next-page cursor; `null` if no next page
- `hasMore: boolean`

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
type Node = string;            // lowercase 32-byte hex (namehash)
type CoinType = string;        // SLIP-44 numeric string, e.g. "60" = ETH
type Cursor = string;          // opaque pagination cursor

type InterpretedName = string; // string with special label-formatting guarantees
```

---

## Output Format Requirements

Produce a **single TypeScript file** (`api-contract.ts`) using:

- A top-level `Endpoints` namespace with one named type per endpoint.
  Each type has: `method`, `path`, `params?` (path params), `query?` (query params), `response`.
- A generic `ApiResponse<T>` using a discriminated union on `responseCode: "ok" | "error"`.
- An `ApiError` type using a discriminated union on `type`.
- All domain types at the top level (not nested inside the namespace).
- `lifecycle` as a top-level field on the name result object.
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
