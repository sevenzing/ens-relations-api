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

| Field             | Type                   | Required | Default                                | Description |
|-------------------|------------------------|----------|----------------------------------------|-------------|
| `chainId`         | string \| "any"        | No       | "any"                                  | Chain scope. "any" = no filter. Valid values: "1" (Ethereum), "8453" (Base), etc. **Not implemented in this version — future-proof only.** |
| `relations`       | string (CSV)           | No       | "token_owner,root_registry_owner"      | Comma-separated distinct set of: `token_owner`, `root_registry_owner`. Errors on unknown or repeated values. In future it's possible to add like `resolved_any`. |
| `lifecycleStatus` | string (CSV)           | No       | "active,expiring_soon,indefinite,unknown" | Comma-sep filter on lifecycle state. Options: `active`, `expiring_soon`, `released_grace`, `available`, `indefinite`, `unknown`. See mapping below. |
| `sortBy`          | "name" \| "expiration" | No       | "name"                                 | Sort field. See note on `expiration` sort ordering for names with `lifecycle.type = "indefinite"` or `"unknown"`. |
| `sortDirection`   | "asc" \| "desc"        | No       | "asc"                                  | |
| `limit`           | integer (1–100)        | No       | 10                                     | Results per page. |
| `cursor`          | string                 | No       | —                                      | Opaque cursor from previous response. |

**`lifecycleStatus` filter mapping to response structure:**
- `active` → `lifecycle.type = "graced_expiry"` AND `lifecycle.status.type = "active"`
- `expiring_soon` → `lifecycle.type = "graced_expiry"` AND `lifecycle.status.type = "active"` AND `lifecycle.status.expiringSoon = true`
- `released_grace` → `lifecycle.type = "graced_expiry"` AND `lifecycle.status.type = "released_grace"`
- `available` → `lifecycle.type = "graced_expiry"` AND `lifecycle.status.type = "available"`
- `indefinite` → `lifecycle.type = "indefinite"`
- `unknown` → `lifecycle.type = "unknown"`

> **Note on `sortBy=expiration` ordering:** `lifecycle.type = "indefinite"` (never expires) is treated as `∞` and follows the sort direction — last in `asc`, first in `desc`. `lifecycle.type = "unknown"` is always placed last regardless of sort direction, as it represents missing data rather than a known value.
> Sort order for `asc`: known expiries ascending → `indefinite` (∞) → `unknown`
> Sort order for `desc`: `indefinite` (∞) → known expiries descending → `unknown`

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

- **`resolved`**: `Record<CoinType, { type: "active"; address: Address } | { type: "none" }>`
  Map of SLIP-44 coinType string → resolution state. Each entry is either a confirmed address (`"active"`) or confirmed unset (`"none"`). The map only includes coin types we have indexed; absence of a key means no data for that coin type.

  > NOTE: Do not implement in this version — include the type definition only, for future proofing.

- **`rootRegistryOwner`**: discriminated union on `type`
  ENS root registry owner:
  - `{ type: "active"; owner: Account }` — root registry owner is the specified address
  - `{ type: "none" }` — confirmed no root registry owner. Note that the name may still exist and be resolvable as a result of ENSIP-10 and ENS wildcard resolution.

- **`tokenOwner`**: discriminated union on `type` — represents NFT ownership.

  **`{ type: "active"; owner: Account; token: TokenInfo }`**
  Token is owned by the specified `owner` and hasn't expired.

  **`{ type: "released_grace"; previousOwner: Account; token: TokenInfo }`**
  Token has expired but is still within its grace period and therefore cannot be registered again yet. The previous owner will automatically regain ownership if the name is renewed before the grace period expires. Shares the same token metadata structure as `"active"`.

  **`{ type: "none" }`**
  Confirmed no current token owner. Covers: zero address, burned token, fully released (past grace period), or name never tokenized.

  **`{ type: "unknown" }`**
  Cannot determine ownership — either impossible right now or not yet implemented.

  > Only `tokenOwner` has the `"unknown"` variant; other relation fields do not.

---

##### `TokenInfo` (included on `tokenOwner.type = "active"` and `"released_grace"`)

Fields from the underlying token record:
- `id: string` — CAIP-19 Asset Identifier (e.g. `"eip155:1/erc721:0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85/12345"`)
- `contract: Account` — chain and contract address of the token contract
- `tokenId: string` — bigint serialized as string
- `assetNamespace: string` — e.g. `"erc721"`

---

#### `lifecycle` — discriminated union on `type`

Describes the name's registration lifecycle.

```
type Lifecycle =
  | { type: "indefinite" }
  | { type: "unknown" }
  | { type: "graced_expiry"; status: GracedExpiryStatus }
  // NOTE: clients MUST support receiving new `type` considering them as "unknown"
```

**`{ type: "indefinite" }`**
We know this name never expires — it has no expiry date by design.
Example: the TLD "eth" itself.

**`{ type: "unknown" }`**
We don't know the lifecycle, or we haven't implemented handling for it yet.
Examples: "box", "gift.box", unwrapped subnames like "abc.lev.eth"

This is also the fallback value SDK clients should use when they receive a `type` value they don't recognize — treat any unknown future variant as `"unknown"` for display and filtering purposes.

**`{ type: "graced_expiry"; status: GracedExpiryStatus }`**
ENSv1 `.eth` base registry lifecycle. All direct subnames of `.eth` have this lifecycle type regardless of whether they are currently registered or not — the lifecycle type is fixed, only the status varies.
Examples: "vitalik.eth" (active), "nrg.eth" (available), "crazy.eth" (available, never registered)

---

##### `GracedExpiryStatus` — discriminated union on `type`

**`{ type: "active"; expiresAt: UnixTimestamp; expiresIn: number; expiringSoon: boolean }`**
Name is currently registered and the token has not expired.
- `expiresAt` — absolute expiry timestamp
- `expiresIn` — seconds from `accurateAsOf`; always positive in this variant
- `expiringSoon` — true if within the server-defined threshold of expiry (~120 days). Exact threshold is not committed to in the contract.

**`{ type: "released_grace"; previousTokenOwner: Address; gracePeriodEndsAt: UnixTimestamp; gracePeriodEndsIn: number }`**
Name has expired but is still within its grace period. No `expiresIn` field — it would be negative (name already expired), so it is omitted.
- `previousTokenOwner` — address who held the token before it expired
- `gracePeriodEndsAt` — absolute timestamp when grace period ends
- `gracePeriodEndsIn` — seconds from `accurateAsOf` until grace period ends

**`{ type: "available" }`**
Name is available for registration — either it was never registered, or it was fully released after its grace period ended. No additional fields.
Note: a name that was previously registered and one that was never registered are represented identically in this status.

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

type Account = { chainId: number; address: Address }; // chain-scoped address
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
- `lifecycle.type` and `GracedExpiryStatus.type` may gain new variants — clients must treat unknown values gracefully
- Sibling endpoints planned: `/api/names/by-parent/:parentNode`, `/api/names/search`, `/api/names/primary/:address`