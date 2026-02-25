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
export type Namehash = string;

/** SLIP-44 numeric string coin type, e.g. "60" = ETH */
export type CoinType = string;

/** Duration string, e.g. "120d", "30m", "1y", "1s", "20h" */
export type DurationString = string;

/** Opaque pagination cursor returned by a previous response */
export type Cursor = string;

/** One label (segment) of an ENS name */
export type NamePart = {
  /** keccak256 hash of the label */
  labelHash: string;
  /** Decoded label if known; null if only the hash is available */
  label: string | null;
};

// ============================================================
// Name
// ============================================================

/**
 * A fully resolved ENS name — all labels are normalized and decoded.
 * Example: { type: "known", name: "vitalik.eth" }
 */
export type NameKnown = {
  type: "known";
  name: string;
};

/**
 * A partially decoded ENS name — one or more labels are unknown (only their hash is available).
 * The `name` field uses encoded labelhash notation: [<hex>] for unknown labels.
 * Example: { type: "undecoded", name: "[4f5b8...].eth", parts: [...] }
 */
export type NameUndecoded = {
  type: "undecoded";
  /** Stringified name using [<labelhash>] notation for unknown labels */
  name: string;
  /** One entry per label, left to right */
  parts: NamePart[];
};

export type Name = NameKnown | NameUndecoded;

// ============================================================
// Relations
// ============================================================

/** Confirmed owner address */
export type RelationKnown = { type: "known"; address: Address };

/** Confirmed absence — e.g. zero address, burned token, or unset registry entry */
export type RelationNone = { type: "none" };

/**
 * Cannot determine / not implemented yet
 */
export type RelationUnknown = { type: "unknown" };

export type Relations = {
  /**
   * Map of SLIP-44 coinType → resolution state.
   * absence of a key means no data.
   */
  resolved: Record<CoinType, RelationKnown | RelationNone>;

  /**
   * NFT ownership state.
   */
  tokenOwner: RelationKnown | RelationNone | RelationUnknown;

  /**
   * ENS registry owner state.
   */
  explicitRegistryOwner: RelationKnown | RelationNone;
};

// ============================================================
// Lifecycle
// ============================================================

export type LifecycleStatus = "active" | "expiring_soon" | "released_grace" | "released_full";

export type ExpiryInfo = {
  /** Unix timestamp (seconds) when the name expires */
  expiresAt: UnixTimestamp;
  /** Seconds until expiry relative to `accurateAsOf`; negative if already expired */
  expiresIn: number;
};

export type GracePeriodInfo = {
  /** Unix timestamp (seconds) when the grace period ends */
  gracePeriodEndsAt: UnixTimestamp;
  /** Seconds until grace period ends relative to `accurateAsOf`; negative if already ended */
  gracePeriodEndsIn: number;
};

/**
 * ENSv1 `.eth` base registry lifecycle — the name has a known expiry date and a grace period
 * after expiry before it is fully released (e.g. "lev.eth", wrapped subnames like "abc.lev.eth").
 */
export interface LifecycleGracedExpiry {
  type: "graced_expiry";
  /** Current state of the name */
  status: LifecycleStatus;
  expiry: ExpiryInfo;
  gracePeriod: GracePeriodInfo;
}

/**
 * Discriminated union representing the lifecycle of an ENS name.
 *
 * Variants:
 *   - "none"          — We know the name has no lifecycle; it never expires (e.g. the TLD "eth" itself).
 *   - "unknown"       — We don't know the lifecycle or haven't implemented handling yet
 *                       (e.g. "box", "gift.box", unwrapped subnames like "abc.lev.eth").
 *   - "graced_expiry" — ENSv1 .eth lifecycle: has expiry + grace period.
 *
 * NOTE: Clients MUST handle unknown `type` values gracefully — new variants may be added in
 * future API versions without a breaking change.
 */
export type Lifecycle =
  | { type: "none" }
  | { type: "unknown" }
  | LifecycleGracedExpiry;

// ============================================================
// Name Result
// ============================================================

export type NameResult = {
  name: Name;
  /** Namehash of the domain — unique deterministic identifier, always lowercase hex */
  domainId: Namehash;
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
 * - "validation"  — request failed schema/semantic validation
 * - "not_found"   — requested resource does not exist
 * - "rate_limited"— client has exceeded rate limits
 * - "internal"    — unexpected server-side error
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
// Query Parameters
// ============================================================

/**
 * Known `relations` filter values.
 *
 * Future additions may include (not yet supported):
 *   resolved_<coinType>, reverse_any, reverse_<chainId>, reverse_default,
 *   primary_any, primary_<chainId>, primary_default
 */
export type RelationFilter = "token_owner" | "explicit_registry_owner" | "resolved_any";

export type LifecycleStatusFilter = "active" | "expiring_soon" | "released_grace" | "released_full";

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

    /**
     * Query parameters — all optional.
     */
    query?: {
      /**
       * Chain scope. "any" means no filter.
       * Valid values: "1" (Ethereum), "8453" (Base), etc.
       * @default "any"
       */
      chainId?: ChainId | "any";

      /**
       * Comma-separated relation filter — a distinct set of: `token_owner`, `explicit_registry_owner`, `resolved_any`.
       * Errors on unknown or repeated values.
       * @default "token_owner,explicit_registry_owner"
       *
       * @example "token_owner,resolved_any"
       */
      relations?: string;

      /**
       * Comma-separated lifecycle status filter, or "any".
       * Applies only to names with `lifecycle.type = "graced_expiry"`.
       * Names with `lifecycle.type = "none"` or `"unknown"` are always included
       * when this param is absent or "any".
       * @default "any"
       */
      lifecycleStatus?: "any" | string;

      /**
       * Duration that defines the "expiring soon" window.
       * A name is `expiring_soon` if: now() > expiry - duration.
       * Format: 1s | 30m | 20h | 2d | 1y
       * @default "120d"
       */
      expiringSoonDuration?: DurationString;

      /**
       * Field to sort results by.
       *
       * When `sortBy = "expiration"`:
       * Names with `lifecycle.type = "none"` (no expiry) are sorted to a defined fixed position.
       * Implementation note: names without an expiry are always placed LAST when sorting by
       * expiration in ascending order, and FIRST when sorting in descending order.
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