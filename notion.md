# API Design Proposal: ENS Names by Address

> Naming Decision
> 
> 
> The original task specification refers to this endpoint as "Associated Names." I intentionally chose a more abstract naming — `names/by-address` — for the following reasons:
> 
> 1. **"Associated" is a loaded term.** It couples the endpoint to a narrow concept (address-to-name association) and makes future extensions awkward. This endpoint is fundamentally a *names query scoped to an address with filters*, not an "association lookup."
> 2. **`association` query param is replaced with `relations`.** The values `owner` and `manager` describe how an address is related to a name. It looks similar but it’s just simpler word.
> 3. **`/by-address/` makes the query axis explicit.** This path segment leaves room for future sibling endpoints under the `/api/names/` namespace — for example, `/api/names/by-parent/:parentNode`, `/api/names/search?q=vitalik`, `/api/names/:name`, `/api/names/primary/:address` — without requiring a redesign of the URL structure.

---

## 1. Overview

This document proposes the design of the **Names by Address REST API** for ENSNode. The endpoint returns ENS names where a given Ethereum address holds a specific role (token_owner, explicit_registry_owner), with optional filters for registration lifecycle state (active, grace period, ~~inactive~~, released), expiration window, chain, sorting, and cursor-based pagination. All query parameters except `address` have sensible defaults, so the simplest call is just `GET /api/names/by-address/:address`.

---

## 2. Endpoint

```
GET /api/names/by-address/:address
```

- **Path parameter**: `address` — an Ethereum address (in any capitalization).
- All other parameters are query parameters.

### Why path-param for address?

Follows the existing pattern in `apps/ensapi`:

- `GET /api/registrar-actions/:parentNode`
- `GET /api/resolve/primary-name/:address/:chainId`

The address is the primary entity being queried.

### Why `/names/by-address/`?

The `/names/` prefix establishes a namespace for name-query endpoints. The `/by-address/` segment clarifies that the query axis is an Ethereum address. This leaves room for future sibling endpoints.

---

## 3. Request Parameters

| Parameter | Location | Type | Validation | Required | Default | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `address` | path | `Address` (hex string) | 20 byte hex address | Yes | — | The Ethereum address to query names for. Any capitalization (no checksum validation). |
| `chainId` | query | `ChainId`  | `"any"` |  | No | any | Chain ID to scope the query (e.g., `1` for Ethereum, `8453` for Base). `any` means no filter applied |
| `relations` | query | `string` (comma-sep) | either `any` or comma-sep distinct set of 

`token_owner` , `explicit_registry_owner` , `resolved_any` 

for all comma-sep distinct sets:
  • repeated values raises an error
  • unknown value raises an error | No |

`token_owner,explicit_registry_owner` | In future it's possible to add 

  • `resolved_<coinType>` 
  • `reverse_any`
  • `reverse_<chainId>`
  • `reverse_default`
  • `primary_any`
  • `primary_<chainId>`
  • `primary_defaut`

 |
| `~~lifecycle`~~

token_ | query | `string` (comma-sep) | either `any`  or comma-sep distinct set of 

`active`, 
`expiring_soon` ,
`grace_period`, `released`  | No | any |  |
| `expiringSoonDuration` | query | `string`  | duration in string format like 
  • `1s` 
  • `30m` 
  • `20h` 
  • `2d` 
  • `1y`  | No | `120d` | Defines duration of expiring_soon. Name is in `expiring_soon` lifecycle if `now() > name.expiry_at - expiringSoonDuration` |
| `sortBy` | query | `"name"` | `"expiration"` |  | No | `"name"` | Sort field. |
| `sortDirection` | query | `"asc"` | `"desc"` |  | No | `"asc"` | Sort direction. |
| `limit` | query | `integer` (1–100) |  | No | `10` | Maximum number of results per page. |
| `cursor` | query | `string` |  | No | — | Cursor from a previous response to fetch the next page. |

---

## 4. Response Schema

### Success Response (`200 OK`)

```json
{
  "responseCode": "ok", // string. Response status indicator.

  "accurateAsOf": 1735689000, // UnixTimestamp (seconds). All relative time fields (e.g. expiresIn) are anchored to this value.

  "names": [
    {
      "name": "vitalik.eth", // string. Fully qualified ENS domain name.

      "domainId": "0xee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835", 
      // Hex string in lower case. Namehash of the domain (unique deterministic identifier).

      "relations": {
        "resolved": {
          "60": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
          // Record<string, Address>.
          // Map of coinType → resolved address.
          // Example: "60" = ETH (SLIP-44 coin type).
        },

        "tokenOwner": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        // Address | null.
        // NFT owner of the name (if tokenized).
        // null = confirmed no token ownership exists or set to ZERO_ADDRESS

        "explicitRegistryOwner": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
        // Address | null.
        // ENS registry owner (manager).
        // null = not set
      },

      "lifecycle": {
        "expiry": {
          "status": "known", 
          // "known" | "none" | "unknown".
          // "known"   → expiry exists and timestamps are authoritative.
          // "none"    → system confirms no expiry exists.
          // "unknown" → expiry may exist but we cannot determine it.
          // This enables explicit "we-may-not-know" semantics.

          "expiresAt": 1700000000,
          // UnixTimestamp | null.
          // Present only if status = "known".

          "expiresIn": 10000
          // number (seconds) | null.
          // MUST equal: expiresAt - accurateAsOf.
          // Negative if already expired.
          // Present only if status = "known".
        },

        "gracePeriod": {
          "status": "known", 
          // "known" | "none" | "unknown".
          // Same epistemic semantics as expiry.status.

          "gracePeriodEndsAt": 1800000000,
          // UnixTimestamp | null.
          // Present only if status = "known".

          "gracePeriodEndsIn": 20000
          // number (seconds) | null.
          // MUST equal: gracePeriodEndsAt - accurateAsOf.
          // Negative if already past.
          // Present only if status = "known".
        },

        "state": {
          "current": {
            "status": "known",
            // "known" | "none" | "unknown".
            // "none" means name not in any of possible state. (is it possible?)
            // "unknown" means current state cant be determined in single state.

            "type": "active",
            // string | null.
            // Identifier of current lifecycle state.
            // Contract-specific and not globally standardized.

            "since": 1600000000,
            // UnixTimestamp | null.
            // When current state began.

            "ends": 1799999999
            // UnixTimestamp | null.
            // When current state is expected to end.
            // null = open-ended or unknown.
          },

          "all": [
            {
              "type": "active",
              // string. Lifecycle state identifier.

              "since": 1600000000,
              // UnixTimestamp. State start time.

              "ends": 1799999999,
              // UnixTimestamp | null.
              // State end time. null = open-ended.

              "inState": true
              // boolean.
              // Whether this state is active at accurateAsOf.
              // Derived from: since <= accurateAsOf < ends (if ends != null).
            },
            {
              "type": "expiring_soon",
              "since": 1650000000,
              "ends": 1699999999,
              "inState": false
            },
            {
              "type": "grace_period",
              "since": 1700000000,
              "ends": 1800000000,
              "inState": false
            },
            {
              "type": "expired",
              "since": 1750000000,
              "ends": null,
              "inState": false
            },
            {
              "type": "released",
              "since": 1800000000,
              "ends": null,
              "inState": false
            }
          ]
          // Array<object>.
          // All known lifecycle intervals.
          // States are NOT guaranteed to be mutually exclusive. 
          // They are sorted by ("since", "type").
          // Semantics depend on the controlling contract implementation.
        }
      }
    }
  ],

  "pagination": {
    "limit": 10,        // number. Maximum results returned.
    "cursor": "eyJuIjoiemVidS5ldGgiLCJlIjoxNzU2Njg0ODAwLCJpZCI6IjB4YWJjIn0=", 
    // string | null. Cursor for next page.

    "hasMore": true     // boolean. Whether more results exist.
  }
}

```

### Error Response (`400 | 500`)

```json
{
  "responseCode": "error",
  "error": {
    "message": "Invalid Input",
    "details": { ... }
  }
}

```

## Discussion

### Roles vs Relationships

> Lev:
> 

I understand the idea of “giant graph of names and addresses” but for regular ENS developer `owner` and `manager`  are `roles` (for example in [app.ens.domains](http://app.ens.domains/)) not `relationships`. 

![image.png](API%20Design%20Proposal%20ENS%20Names%20by%20Address/image.png)

For now i decided to use `relations` because while `owner` is a role, i dont feel like `resolved_any`  is a role too. but i dont like but names so decided to use short version `relations` instead of `relationships`

# Quick idea from Josiah

1. enum for lifecycle type
    1. none
        1. We know there’s no lifecycle.
        2. Ex: The name “eth”
    2. unknown
        1. We don’t know the lifecycle or we haven’t implement special handling for it yet.
        2. Ex: The name “box”, or “gift.box”, or “abc.lev.eth” (if name is unwrapped)
    3. simple (second layer name registered in .eth base registry?) 
        1. The lifecycle rules implemented by the ENSv1 .**eth base registry.**
            1. expiry date
            2. grace period
            3. recently released
            4. fully released
        2. Ex: “lev.eth”, “abc.lev.eth” (if name is wrapped?)
    4. *clients must support receiving new enum values that might be added in the future*
2. define discriminated type union based on this enum

```jsx
how to query all active?

lifecycle_type=simple&lifecycle_simple_status=active|expired|
lifecycle_simple_status=active|expired

interface LifecycleNone {
	type: LifecycleType.None;
}

interface LifecycleUnknown {
	type: LifecycleType.Unknown;
}

interface LifecycleExpirable {
   expiry: date;
}

interface LifecycleSimple extends LifecycleExpirable {
	type: LifecycleType.Simple;
	status: SimpleLifecycleStatus;
	grace: date;
}

type Lifecycle = LifecycleNone | LifecycleUnknown | LifecycleSimple;
```


