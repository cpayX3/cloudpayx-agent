import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export type HunterEndpointService =
  | "risk"
  | "arbitrage"
  | "stablecoin_route"
  | "asset_analysis";

const SNAPSHOT_FILE = join(
  process.cwd(),
  "data",
  "cloudpayx_hunter_xrpl_behavior_intelligence.json",
);

const CACHE_MS = 60_000;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

let cachedAt = 0;
let cachedMtimeMs = -1;
let cachedSnapshot: any = null;

function increment(
  target: Record<string, number>,
  key: string,
  amount = 1,
): void {
  if (!key) return;
  target[key] = (target[key] || 0) + amount;
}

function topEntries(
  values: Record<string, number>,
  limit = 10,
): Array<{
  key: string;
  count: number;
}> {
  return Object.entries(values)
    .map(([key, count]) => ({
      key,
      count,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.key.localeCompare(right.key),
    )
    .slice(0, limit);
}

function readSnapshot(): any | null {
  const now = Date.now();

  if (
    cachedSnapshot &&
    now - cachedAt < CACHE_MS
  ) {
    return cachedSnapshot;
  }

  if (!existsSync(SNAPSHOT_FILE)) {
    cachedAt = now;
    cachedSnapshot = null;
    return null;
  }

  const file = statSync(SNAPSHOT_FILE);

  if (
    cachedSnapshot &&
    file.mtimeMs === cachedMtimeMs
  ) {
    cachedAt = now;
    return cachedSnapshot;
  }

  const parsed = JSON.parse(
    readFileSync(SNAPSHOT_FILE, "utf8"),
  );

  if (
    !parsed ||
    !Array.isArray(parsed.accounts)
  ) {
    throw new Error(
      "Hunter behavior snapshot has an invalid structure",
    );
  }

  cachedAt = now;
  cachedMtimeMs = file.mtimeMs;
  cachedSnapshot = parsed;

  return parsed;
}

function supportsStablecoin(record: any): boolean {
  const currencies =
    Array.isArray(record?.observedCurrencies)
      ? record.observedCurrencies
      : [];

  return currencies.some((entry: any) =>
    entry?.key === "RLUSD" ||
    entry?.key === "USDC"
  );
}

export function getHunterEndpointIntelligence(
  service: HunterEndpointService,
): any {
  try {
    const snapshot = readSnapshot();

    if (!snapshot) {
      return {
        available: false,
        reason: "HUNTER_SNAPSHOT_UNAVAILABLE",
      };
    }

    const accounts = snapshot.accounts;
    const classifications:
      Record<string, number> = {};
    const pairs: Record<string, number> = {};
    const currencies: Record<string, number> = {};

    let persistentAccounts = 0;
    let selectedAccounts = 0;
    let confidenceTotal = 0;

    for (const account of accounts) {
      const classification = String(
        account?.behaviorClassification ||
        "MACHINE_LIKE_UNRESOLVED",
      );

      increment(classifications, classification);

      if (
        account?.observationPersistence ===
          "PERSISTENT" ||
        account?.observationPersistence ===
          "HIGH_PERSISTENCE"
      ) {
        persistentAccounts += 1;
      }

      const selected =
        service === "risk"
          ? [
              "DUST_DISTRIBUTOR_CANDIDATE",
              "TAGGED_PAYMENT_ROUTER_CANDIDATE",
              "AUTOMATED_PAYMENT_ACCOUNT",
            ].includes(classification)
          : service === "arbitrage"
            ? [
                "MARKET_MAKING_CANDIDATE",
                "DEX_AUTOMATION_CANDIDATE",
              ].includes(classification)
            : service === "stablecoin_route"
              ? supportsStablecoin(account)
              : true;

      if (!selected) continue;

      selectedAccounts += 1;
      confidenceTotal += Number(
        account?.behaviorConfidence || 0,
      );

      for (
        const entry of
          account?.observedPairs || []
      ) {
        increment(
          pairs,
          String(entry?.key || ""),
          Number(entry?.count || 0),
        );
      }

      for (
        const entry of
          account?.observedCurrencies || []
      ) {
        increment(
          currencies,
          String(entry?.key || ""),
          Number(entry?.count || 0),
        );
      }
    }

    const generatedAt =
      snapshot.generatedAt ||
      snapshot.generated_at ||
      null;

    const generatedMs = generatedAt
      ? Date.parse(generatedAt)
      : NaN;

    const ageMs = Number.isFinite(generatedMs)
      ? Math.max(0, Date.now() - generatedMs)
      : null;

    return {
      available: true,
      source:
        "cloudpayX Hunter public XRPL behavioral observation",
      mode: "READ_ONLY_AGGREGATE",
      generated_at: generatedAt,
      snapshot_age_seconds:
        ageMs === null
          ? null
          : Math.round(ageMs / 1000),
      stale:
        ageMs === null
          ? true
          : ageMs > STALE_AFTER_MS,
      service_scope: service,
      observed_accounts: accounts.length,
      selected_accounts: selectedAccounts,
      persistent_accounts: persistentAccounts,
      average_confidence:
        selectedAccounts > 0
          ? Number(
              (
                confidenceTotal /
                selectedAccounts
              ).toFixed(2),
            )
          : null,
      classifications,
      top_observed_pairs: topEntries(pairs),
      top_observed_currencies:
        topEntries(currencies),
      limitations: [
        "Behavioral classifications are probabilistic.",
        "Observed activity does not establish identity, ownership, jurisdiction, agency, or malicious intent.",
        "Currency symbols are not issuer verification; issuer-aware regional attribution is pending.",
      ],
    };
  } catch (error) {
    console.error(
      "Hunter intelligence unavailable:",
      error,
    );

    return {
      available: false,
      reason: "HUNTER_SNAPSHOT_INVALID",
    };
  }
}
