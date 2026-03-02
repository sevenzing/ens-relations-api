// ============================================================
// Primitive Types
// ============================================================

/** 20-byte Ethereum hex address, checksummed or not */
export type Address = string;

/** Seconds since Unix epoch */
export type UnixTimestamp = number;

/** Chain identifier, e.g. "1" (Ethereum mainnet), "8453" (Base) */
export type ChainId = string;

/** Lowercase 32-byte hex namehash — unique deterministic identifier for an ENS domain */
export type Node = string;

/** SLIP-44 numeric string coin type, e.g. "60" = ETH */
export type CoinType = string;

/** Opaque pagination cursor returned by a previous response */
export type Cursor = string;

/**
 * Interpreted name — a string with special guarantees on label formatting.
 * Every label is either a normalized label or an encoded labelhash in `[<hex>]` notation.
 * More details: https://ensnode.io/docs/reference/terminology/#interpreted-name
 */
export type InterpretedName = string;

/** Chain-scoped Ethereum address */
export type Account = { chainId: number; address: Address };

// ============================================================
// Token Info
// ============================================================

/** Metadata for the NFT token associated with a name (present when tokenOwner.type = "active" or "released_grace") */
export type TokenInfo = {
  /** CAIP-19 Asset Identifier, e.g. "eip155:1/erc721:0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85/12345" */
  id: string;
  /** Chain and contract address of the token contract */
  contract: Account;
  /** Token ID serialized as a decimal string (bigint-safe) */
  tokenId: string;
  /** Asset namespace, e.g. "erc721" */
  assetNamespace: string;
};

// ============================================================
// Relations
// ============================================================

export type Relations = {
  /**
   * Map of SLIP-44 coinType → resolution state.
   * Each entry is either a confirmed address (`"active"`) or confirmed unset (`"none"`).
   * Absence of a key means no indexed data for that coin type.
   *
   * NOTE: Not implemented in this version — included for future-proofing only.
   */
  resolved: Record<CoinType, { type: "active"; address: Address } | { type: "none" }>;

  /**
   * ENS root registry owner.
   *   - "active" — root registry owner is the specified address
   *   - "none"   — confirmed no root registry owner; name may still be resolvable
   *                via ENSIP-10 wildcard resolution
   */
  rootRegistryOwner: { type: "active"; owner: Account } | { type: "none" };

  /**
   * NFT ownership state.
   *   - "active"         — token exists and has not expired; previous owner retains no special claim
   *   - "released_grace" — token has expired but is still within its grace period;
   *                        the previous owner retains a priority claim to re-register
   *   - "none"           — confirmed no current owner (zero address, burned, fully released, or never tokenized)
   *   - "unknown"        — cannot determine ownership; not yet implemented or impossible to resolve
   *
   * Only `tokenOwner` has the `"unknown"` variant; other relation fields do not.
   */
  tokenOwner:
    | { type: "active"; owner: Account; token: TokenInfo }
    | { type: "released_grace"; previousOwner: Account; token: TokenInfo }
    | { type: "none" }
    | { type: "unknown" };
};

// ============================================================
// Lifecycle
// ============================================================

/**
 * ENSv1 graced-expiry lifecycle status — discriminated union on `type`.
 *
 * - "active"         — name is currently registered and not expired
 * - "released_grace" — name has expired but is still within its grace period;
 *                      `expiresIn` is omitted (would be negative)
 */
export type GracedExpiryStatus =
  | {
      type: "active";
      /** Absolute expiry timestamp */
      expiresAt: UnixTimestamp;
      /** Seconds from `accurateAsOf` until expiry; always positive in this variant */
      expiresIn: number;
      /**
       * True if within the server-defined threshold of expiry (~120 days).
       * Exact threshold is not committed to in the contract — rely on this boolean
       * rather than computing it from `expiresIn`.
       */
      expiringSoon: boolean;
    }
  | {
      type: "released_grace";
      /** Address who held the token before it expired */
      previousTokenOwner: Address;
      /** Absolute timestamp when the grace period ends */
      gracePeriodEndsAt: UnixTimestamp;
      /** Seconds from `accurateAsOf` until grace period ends */
      gracePeriodEndsIn: number;
    };

/**
 * Discriminated union representing the lifecycle of an ENS name.
 *
 * Variants:
 *   - "none"          — We know the name has no lifecycle; it never expires (e.g. the TLD "eth").
 *   - "unknown"       — We don't know the lifecycle or haven't implemented handling yet
 *                       (e.g. "box", "gift.box", unwrapped subnames like "abc.lev.eth").
 *   - "graced_expiry" — ENSv1 .eth lifecycle: known expiry date + grace period after expiry.
 *
 * NOTE: Clients MUST handle unknown `type` values gracefully — new variants may be added in
 * future API versions without a breaking change. Treat any unrecognized type as "unknown"
 * for display and filtering purposes.
 */
export type Lifecycle =
  | { type: "none" }
  | { type: "unknown" }
  | { type: "graced_expiry"; status: GracedExpiryStatus };

// ============================================================
// Name Result
// ============================================================

export type NameResult = {
  name: InterpretedName;
  /** Namehash of the domain — unique deterministic identifier, always lowercase hex */
  domainId: Node;
  /**
   * All known relations for this name, regardless of the `relations` query filter applied
   * in the request. Clients should not assume only filtered relations are present.
   */
  relations: Relations;
  lifecycle: Lifecycle;
};

// ============================================================
// Pagination
// ============================================================

export type Pagination = {
  limit: number;
  /** Opaque cursor for the next page; null if this is the last page */
  cursor: Cursor | null;
  hasMore: boolean;
};

// ============================================================
// API Error
// ============================================================

/**
 * Discriminated union of all API error shapes.
 *
 * - "validation"   — request failed schema/semantic validation
 * - "not_found"    — requested resource does not exist
 * - "rate_limited" — client has exceeded rate limits
 * - "internal"     — unexpected server-side error
 */
export type ApiError =
  | {
      type: "validation";
      message: string;
      /** Per-field validation failures, if applicable */
      fields?: { path: string; reason: string }[];
    }
  | { type: "not_found"; message: string }
  | {
      type: "rate_limited";
      message: string;
      /** Seconds to wait before retrying */
      retryAfterSec?: number;
    }
  | { type: "internal"; message: string };

// ============================================================
// Generic API Response
// ============================================================

/**
 * Generic wrapper for all API responses, discriminated on `responseCode`.
 *
 * Usage:
 *   ApiResponse<{ names: NameResult[]; pagination: Pagination; accurateAsOf: UnixTimestamp }>
 */
export type ApiResponse<T> =
  | ({ responseCode: "ok" } & T)
  | { responseCode: "error"; error: ApiError };

// ============================================================
// Query / Filter Types
// ============================================================

/**
 * Known `relations` filter values.
 *
 * Future additions may include (not yet supported):
 *   resolved_<coinType>, reverse_any, reverse_<chainId>, reverse_default,
 *   primary_any, primary_<chainId>, primary_default
 */
export type RelationFilter = "token_owner" | "root_registry_owner";

/**
 * `lifecycleStatus` filter values.
 *
 * Maps to response structure:
 *   - "active"         → lifecycle.type = "graced_expiry" AND status.type = "active"
 *   - "expiring_soon"  → lifecycle.type = "graced_expiry" AND status.type = "active" AND status.expiringSoon = true
 *   - "released_grace" → lifecycle.type = "graced_expiry" AND status.type = "released_grace"
 *   - "none"           → lifecycle.type = "none"
 *   - "unknown"        → lifecycle.type = "unknown"
 */
export type LifecycleStatusFilter =
  | "active"
  | "expiring_soon"
  | "released_grace"
  | "none"
  | "unknown";

// ============================================================
// Endpoints Namespace
// ============================================================

/**
 * Typed API contract.
 *
 * Planned sibling endpoints (not yet implemented):
 *   - GET /api/names/by-parent/:parentNode
 *   - GET /api/names/search
 *   - GET /api/names/primary/:address
 */
export namespace Endpoints {
  export type GetNamesByAddress = {
    method: "GET";
    path: "/api/names/by-address/:address";

    /** Path parameters */
    params: {
      /** 20-byte Ethereum hex address, any capitalization */
      address: Address;
    };

    /** Query parameters — all optional */
    query?: {
      /**
       * Chain scope. "any" means no filter.
       * Valid values: "1" (Ethereum), "8453" (Base), etc.
       * @default "any"
       */
      chainId?: ChainId | "any";

      /**
       * Comma-separated relation filter — a distinct set of: `token_owner`, `root_registry_owner`.
       * Errors on unknown or repeated values.
       * @default "token_owner,root_registry_owner"
       */
      relations?: string;

      /**
       * Comma-separated lifecycle status filter.
       * Options: active, expiring_soon, released_grace, none, unknown.
       * @default "active,none,unknown"
       *
       * Mapping to response structure:
       *   - active         → lifecycle.type = "graced_expiry" AND status.type = "active"
       *   - expiring_soon  → graced_expiry + active + expiringSoon = true
       *   - released_grace → lifecycle.type = "graced_expiry" AND status.type = "released_grace"
       *   - none           → lifecycle.type = "none"
       *   - unknown        → lifecycle.type = "unknown"
       */
      lifecycleStatus?: string;

      /**
       * Field to sort results by.
       *
       * When `sortBy = "expiration"`:
       *   - "none" (never expires) is treated as ∞ — last in asc, first in desc.
       *   - "unknown" is always placed last regardless of direction (missing data, not ∞).
       *   Sort order asc:  known expiries ascending → none (∞) → unknown
       *   Sort order desc: none (∞) → known expiries descending → unknown
       *
       * @default "name"
       */
      sortBy?: "name" | "expiration";

      /**
       * Sort direction.
       * @default "asc"
       */
      sortDirection?: "asc" | "desc";

      /**
       * Maximum number of results per page. Must be between 1 and 100 inclusive.
       * @default 10
       */
      limit?: number;

      /**
       * Opaque pagination cursor from a previous response.
       * Omit to start from the beginning.
       */
      cursor?: Cursor;
    };

    response: ApiResponse<{
      /** Unix timestamp (seconds). All relative time fields (e.g. expiresIn) are anchored to this. */
      accurateAsOf: UnixTimestamp;
      names: NameResult[];
      pagination: Pagination;
    }>;
  };
}
