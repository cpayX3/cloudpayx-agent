import * as xrpl from "xrpl";
import {
  getOfficialAssetBalances,
} from "./cloudpayx_hunter_xrpl_asset_balances";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const XRPL_WS_URL =
  process.env.HUNTER_XRPL_WS_URL ||
  "wss://xrplcluster.com";

const HISTORY_LIMIT = Math.max(
  20,
  Math.min(
    400,
    Number(process.env.HUNTER_XRPL_HISTORY_LIMIT || "200"),
  ),
);

const MAX_ACCOUNTS = Math.max(
  1,
  Math.min(
    100,
    Number(process.env.HUNTER_XRPL_BEHAVIOR_MAX_ACCOUNTS || "40"),
  ),
);

const FUNDED_FILE =
  "data/cloudpayx_hunter_xrpl_funded_prospects.json";

const WHALE_FILE =
  "data/cloudpayx_hunter_xrpl_whales.json";

const OUTPUT_FILE =
  "data/cloudpayx_hunter_xrpl_behavior_intelligence.json";

const HISTORY_FILE =
  "data/cloudpayx_hunter_xrpl_behavior_history.jsonl";

const RLUSD_CURRENCY =
  "524C555344000000000000000000000000000000";

const RLUSD_ISSUER =
  "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";

const INTERNAL_ACCOUNTS = new Set([
  "rBZpuNToTKzUF2fkxWcWw5WLoP41eQQXLm",
  "rsnHPZjBSastxz1BE38WqKBR3sgpATvreL",
]);

type ArchivedAccount = {
  account: string;
  xrpBalance: number;
  currentRlusdBalance?: number;
  currentUsdcBalance?: number;
  highestObservedXrpBalance?: number;
  highestObservedRlusdBalance?: number;
  highestObservedUsdcBalance?: number;
  ownerCount?: number;
  domain?: string | null;
  score?: number;
  transactionCount?: number;
  transactionTypes?: Record<string, number>;
  firstArchivedAt?: string;
  lastArchivedAt?: string;
  searchHitCount?: number;
  observationPersistence?:
    | "FIRST_SEEN"
    | "RECURRING"
    | "PERSISTENT"
    | "HIGH_PERSISTENCE";
  cpXMatch?: string | null;
};

type Amount =
  | string
  | {
      currency?: string;
      issuer?: string;
      value?: string;
    };

function loadJson(path: string): any {
  if (!existsSync(path)) {
    throw new Error(`Missing required archive: ${path}`);
  }

  return JSON.parse(readFileSync(path, "utf8"));
}

function decodeCurrency(value: unknown): string {
  if (typeof value !== "string" || !value) {
    return "UNKNOWN";
  }

  if (value.length !== 40 || !/^[A-Fa-f0-9]+$/.test(value)) {
    return value;
  }

  try {
    const decoded = Buffer
      .from(value, "hex")
      .toString("utf8")
      .replace(/\0/g, "")
      .trim();

    return decoded || value;
  } catch {
    return value;
  }
}

function amountLabel(amount: Amount | undefined): string {
  if (typeof amount === "string") return "XRP";

  if (amount && typeof amount === "object") {
    const currency = decodeCurrency(amount.currency);

    if (
      amount.currency?.toUpperCase() === RLUSD_CURRENCY &&
      amount.issuer === RLUSD_ISSUER
    ) {
      return "RLUSD";
    }

    return currency;
  }

  return "UNKNOWN";
}

function amountValue(amount: Amount | undefined): number | null {
  if (typeof amount === "string") {
    const drops = Number(amount);
    return Number.isFinite(drops)
      ? drops / 1_000_000
      : null;
  }

  if (amount && typeof amount === "object") {
    const value = Number(amount.value);
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

function increment(
  record: Record<string, number>,
  key: string,
  amount = 1,
): void {
  record[key] = (record[key] || 0) + amount;
}

function topEntries(
  record: Record<string, number>,
  limit = 10,
): Array<{ key: string; count: number }> {
  return Object.entries(record)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function xrplDateToIso(value: unknown): string | null {
  if (typeof value !== "number") return null;

  return new Date(
    (value + 946_684_800) * 1000,
  ).toISOString();
}

function classifyBehavior(metrics: {
  offersCreated: number;
  offersCancelled: number;
  payments: number;
  taggedPayments: number;
  incomingPayments: number;
  outgoingPayments: number;
  pairCount: number;
  uniqueCounterpartyCount: number;
  maxRepeatedAmountCount: number;
  xrpPaymentVolume: number;
  recurringArchive: boolean;
}): {
  classification: string;
  confidence: number;
  evidence: string[];
} {
  const {
    offersCreated,
    offersCancelled,
    payments,
    taggedPayments,
    incomingPayments,
    outgoingPayments,
    pairCount,
    uniqueCounterpartyCount,
    maxRepeatedAmountCount,
    xrpPaymentVolume,
    recurringArchive,
  } = metrics;

  const offerActions = offersCreated + offersCancelled;
  const tagRatio =
    payments > 0 ? taggedPayments / payments : 0;
  const outgoingRatio =
    payments > 0 ? outgoingPayments / payments : 0;
  const repeatedAmountRatio =
    payments > 0 ? maxRepeatedAmountCount / payments : 0;
  const averageXrpPayment =
    payments > 0 ? xrpPaymentVolume / payments : 0;

  const dustDistributorCandidate =
    payments >= 20 &&
    outgoingRatio >= 0.9 &&
    tagRatio >= 0.8 &&
    uniqueCounterpartyCount >= 20 &&
    repeatedAmountRatio >= 0.8 &&
    averageXrpPayment > 0 &&
    averageXrpPayment <= 0.01;

  let classification = "MACHINE_LIKE_UNRESOLVED";
  let confidence = 45;
  const evidence: string[] = [];

  if (offerActions >= 20 && pairCount >= 1) {
    classification = "DEX_AUTOMATION_CANDIDATE";
    confidence = 70;
    evidence.push(
      `${offerActions} offer-management actions`,
      `${pairCount} observed trading pair(s)`,
    );

    if (offersCreated >= 20 && offersCancelled >= 10) {
      classification = "MARKET_MAKING_CANDIDATE";
      confidence = 82;
      evidence.push(
        "Repeated offer creation and cancellation",
      );
    }
  } else if (dustDistributorCandidate) {
    classification = "DUST_DISTRIBUTOR_CANDIDATE";
    confidence = 88;
    evidence.push(
      `${Math.round(outgoingRatio * 100)}% outbound payments`,
      `${Math.round(tagRatio * 100)}% tagged payments`,
      `${uniqueCounterpartyCount} unique counterparties`,
      `${Math.round(repeatedAmountRatio * 100)}% repeated amount`,
      `Average XRP payment ${averageXrpPayment.toFixed(6)} XRP`,
      "Consistent with dust distribution or automated ledger messaging",
    );
  } else if (payments >= 5 && tagRatio >= 0.6) {
    classification = "TAGGED_PAYMENT_ROUTER_CANDIDATE";
    confidence = 76;
    evidence.push(
      `${Math.round(tagRatio * 100)}% of payments used tags`,
    );
  } else if (payments >= 5) {
    classification = "AUTOMATED_PAYMENT_ACCOUNT";
    confidence = 65;
    evidence.push(`${payments} observed payments`);
  }

  if (incomingPayments > 0 && outgoingPayments > 0) {
    confidence += 5;
    evidence.push("Bidirectional payment activity");
  }

  if (recurringArchive) {
    confidence += 7;
    evidence.push("Observed across multiple Hunter runs");
  }

  return {
    classification,
    confidence: Math.min(95, confidence),
    evidence,
  };
}

async function enrichAccount(
  client: xrpl.Client,
  archived: ArchivedAccount,
  tier: "MICRO_FUNDED" | "FUNDED_PROSPECT" | "WHALE",
): Promise<any> {
  const currentAssetBalances =
    await getOfficialAssetBalances(
      client,
      archived.account,
    );

  const response = await client.request({
    command: "account_tx",
    account: archived.account,
    ledger_index_min: -1,
    ledger_index_max: -1,
    binary: false,
    forward: false,
    limit: HISTORY_LIMIT,
  } as any);

  const entries =
    (response.result as any).transactions || [];

  const transactionTypes: Record<string, number> = {};
  const pairs: Record<string, number> = {};
  const counterparties: Record<string, number> = {};
  const currencies: Record<string, number> = {};
  const activeHoursUtc: Record<string, number> = {};
  const repeatedAmounts: Record<string, number> = {};

  let successfulTransactions = 0;
  let offersCreated = 0;
  let offersCancelled = 0;
  let payments = 0;
  let incomingPayments = 0;
  let outgoingPayments = 0;
  let selfPayments = 0;
  let taggedPayments = 0;
  let invoicePayments = 0;
  let xrpPaymentVolume = 0;
  let rlusdPaymentVolume = 0;

  const timestamps: number[] = [];
  const hashes: string[] = [];

  for (const entry of entries) {
    const tx =
      entry.tx_json ||
      entry.tx ||
      entry.transaction ||
      {};

    const meta = entry.meta || {};
    const type = String(
      tx.TransactionType || "UNKNOWN",
    );

    increment(transactionTypes, type);

    const result =
      meta.TransactionResult ||
      meta.transaction_result;

    if (result === "tesSUCCESS") {
      successfulTransactions += 1;
    }

    const timestamp =
      typeof tx.date === "number"
        ? tx.date + 946_684_800
        : null;

    if (timestamp !== null) {
      timestamps.push(timestamp);

      const hour = new Date(timestamp * 1000)
        .getUTCHours()
        .toString()
        .padStart(2, "0");

      increment(activeHoursUtc, hour);
    }

    const hash =
      entry.hash ||
      tx.hash ||
      tx.Hash;

    if (typeof hash === "string") {
      hashes.push(hash);
    }

    if (type === "OfferCreate") {
      offersCreated += 1;

      const gets = amountLabel(tx.TakerGets);
      const pays = amountLabel(tx.TakerPays);
      increment(pairs, `${gets}/${pays}`);
      increment(currencies, gets);
      increment(currencies, pays);
    }

    if (type === "OfferCancel") {
      offersCancelled += 1;
    }

    if (type === "Payment") {
      payments += 1;

      const source = String(tx.Account || "");
      const destination = String(tx.Destination || "");

      if (
        source === archived.account &&
        destination === archived.account
      ) {
        selfPayments += 1;
      } else if (source === archived.account) {
        outgoingPayments += 1;
      } else if (destination === archived.account) {
        incomingPayments += 1;
      }

      const counterparty =
        source === archived.account
          ? destination
          : source;

      if (counterparty) {
        increment(counterparties, counterparty);
      }

      if (
        tx.SourceTag !== undefined ||
        tx.DestinationTag !== undefined
      ) {
        taggedPayments += 1;
      }

      if (tx.InvoiceID) invoicePayments += 1;

      const delivered =
        meta.delivered_amount &&
        meta.delivered_amount !== "unavailable"
          ? meta.delivered_amount
          : tx.Amount || tx.DeliverMax;

      const label = amountLabel(delivered);
      const value = amountValue(delivered);

      increment(currencies, label);

      if (value !== null) {
        const rounded = `${label}:${value.toPrecision(8)}`;
        increment(repeatedAmounts, rounded);

        if (label === "XRP") {
          xrpPaymentVolume += value;
        }

        if (label === "RLUSD") {
          rlusdPaymentVolume += value;
        }
      }
    }
  }

  timestamps.sort((a, b) => a - b);

  const gaps = timestamps
    .slice(1)
    .map((value, index) => value - timestamps[index])
    .filter((value) => value >= 0);

  const recurringArchive =
    Boolean(
      archived.firstArchivedAt &&
      archived.lastArchivedAt &&
      archived.firstArchivedAt !== archived.lastArchivedAt,
    );

  const behavior = classifyBehavior({
    offersCreated,
    offersCancelled,
    payments,
    taggedPayments,
    incomingPayments,
    outgoingPayments,
    pairCount: Object.keys(pairs).length,
    uniqueCounterpartyCount:
      Object.keys(counterparties).length,
    maxRepeatedAmountCount: Math.max(
      0,
      ...Object.values(repeatedAmounts),
    ),
    xrpPaymentVolume,
    recurringArchive,
  });

  return {
    account: archived.account,
    tier,
    xrpBalance: archived.xrpBalance,
    currentRlusdBalance:
      currentAssetBalances.rlusdBalance,
    currentUsdcBalance:
      currentAssetBalances.usdcBalance,
    officialStablecoinTrustLines:
      currentAssetBalances.trustLines,
    highestObservedXrpBalance:
      archived.highestObservedXrpBalance ||
      archived.xrpBalance,
    highestObservedRlusdBalance:
      Math.max(
        archived.highestObservedRlusdBalance ||
          archived.currentRlusdBalance ||
          0,
        currentAssetBalances.rlusdBalance,
      ),
    highestObservedUsdcBalance:
      Math.max(
        archived.highestObservedUsdcBalance ||
          archived.currentUsdcBalance ||
          0,
        currentAssetBalances.usdcBalance,
      ),
    ownerCount: archived.ownerCount || 0,
    domain: archived.domain || null,
    archiveScore: archived.score || 0,
    firstArchivedAt: archived.firstArchivedAt || null,
    lastArchivedAt: archived.lastArchivedAt || null,
    recurringArchive,
    searchHitCount: Math.max(
      1,
      Number(archived.searchHitCount || 1),
    ),
    observationPersistence:
      archived.observationPersistence || "FIRST_SEEN",
    cpXMatch:
      behavior.classification === "DUST_DISTRIBUTOR_CANDIDATE"
        ? null
        : archived.cpXMatch || null,

    behaviorClassification: behavior.classification,
    behaviorConfidence: behavior.confidence,
    behaviorEvidence: behavior.evidence,
    identityClaim:
      "BEHAVIORAL_CLASSIFICATION_ONLY_NOT_VERIFIED_AGENT",

    historyTransactions: entries.length,
    successfulTransactions,
    transactionTypes,
    offersCreated,
    offersCancelled,
    payments,
    incomingPayments,
    outgoingPayments,
    selfPayments,
    taggedPayments,
    invoicePayments,

    xrpPaymentVolume,
    rlusdPaymentVolume,

    observedPairs: topEntries(pairs),
    observedCurrencies: topEntries(currencies),
    topCounterparties: topEntries(counterparties),
    repeatedAmounts: topEntries(repeatedAmounts),
    activeHoursUtc: topEntries(activeHoursUtc, 24),

    firstHistoryTransactionAt:
      timestamps.length
        ? new Date(timestamps[0] * 1000).toISOString()
        : null,

    lastHistoryTransactionAt:
      timestamps.length
        ? new Date(
            timestamps[timestamps.length - 1] * 1000,
          ).toISOString()
        : null,

    medianTransactionGapSeconds: median(gaps),
    sampleHashes: hashes.slice(0, 10),
  };
}

function stringSet(
  entries: Array<{ key?: string }> | undefined,
): Set<string> {
  return new Set(
    (entries || [])
      .map((entry) => entry.key)
      .filter(
        (value): value is string =>
          typeof value === "string",
      ),
  );
}

function difference(
  current: Set<string>,
  previous: Set<string>,
): string[] {
  return [...current]
    .filter((value) => !previous.has(value))
    .sort();
}

function compareBehavior(
  current: any,
  previous: any | null,
): {
  changeStatus: "NEW" | "CHANGED" | "NO_MATERIAL_CHANGE";
  changeExplanation: string[];
  previousObservedAt: string | null;
} {
  if (!previous) {
    return {
      changeStatus: "NEW",
      changeExplanation: [
        `New ${current.tier} account added to Hunter intelligence.`,
        `Initial classification: ${current.behaviorClassification} (${current.behaviorConfidence}% confidence).`,
      ],
      previousObservedAt: null,
    };
  }

  const changes: string[] = [];

  const balanceDelta =
    Number(current.xrpBalance || 0) -
    Number(previous.xrpBalance || 0);

  if (Math.abs(balanceDelta) >= 0.000001) {
    changes.push(
      `XRP balance ${
        balanceDelta > 0 ? "increased" : "decreased"
      } by ${Math.abs(balanceDelta).toFixed(6)} XRP.`,
    );
  }

  for (const [
    asset,
    key,
  ] of [
    ["RLUSD", "currentRlusdBalance"],
    ["USDC", "currentUsdcBalance"],
  ] as const) {
    const newBalance = Number(current[key] || 0);
    const hadPreviousBalance =
      Object.prototype.hasOwnProperty.call(previous, key);

    if (!hadPreviousBalance) {
      if (Math.abs(newBalance) >= 0.000001) {
        changes.push(
          `Initial verified balance observed: ${newBalance.toFixed(6)} ${asset}.`,
        );
      }
      continue;
    }

    const oldBalance = Number(previous[key] || 0);
    const delta = newBalance - oldBalance;

    if (Math.abs(delta) >= 0.000001) {
      changes.push(
        `${asset} balance ${
          delta > 0 ? "increased" : "decreased"
        } by ${Math.abs(delta).toFixed(6)} ${asset}.`,
      );
    }
  }

  if (
    current.behaviorClassification !==
    previous.behaviorClassification
  ) {
    changes.push(
      `Classification changed from ${previous.behaviorClassification} to ${current.behaviorClassification}.`,
    );
  }

  if (
    current.behaviorConfidence !==
    previous.behaviorConfidence
  ) {
    changes.push(
      `Behavior confidence changed from ${previous.behaviorConfidence}% to ${current.behaviorConfidence}%.`,
    );
  }

  const currentPairs = stringSet(current.observedPairs);
  const previousPairs = stringSet(previous.observedPairs);

  const addedPairs = difference(
    currentPairs,
    previousPairs,
  );

  const removedPairs = difference(
    previousPairs,
    currentPairs,
  );

  if (addedPairs.length > 0) {
    changes.push(
      `New observed trading pairs: ${addedPairs.join(", ")}.`,
    );
  }

  if (removedPairs.length > 0) {
    changes.push(
      `Pairs no longer present in the latest history window: ${removedPairs.join(", ")}.`,
    );
  }

  const currentCurrencies =
    stringSet(current.observedCurrencies);

  const previousCurrencies =
    stringSet(previous.observedCurrencies);

  const addedCurrencies = difference(
    currentCurrencies,
    previousCurrencies,
  );

  if (addedCurrencies.length > 0) {
    changes.push(
      `New observed currencies: ${addedCurrencies.join(", ")}.`,
    );
  }

  const metricChanges: string[] = [];

  for (const [
    label,
    key,
  ] of [
    ["incoming payments", "incomingPayments"],
    ["outgoing payments", "outgoingPayments"],
    ["tagged payments", "taggedPayments"],
    ["offers created", "offersCreated"],
    ["offers cancelled", "offersCancelled"],
  ] as const) {
    const oldValue = Number(previous[key] || 0);
    const newValue = Number(current[key] || 0);

    if (oldValue !== newValue) {
      metricChanges.push(
        `${label}: ${oldValue} → ${newValue}`,
      );
    }
  }

  if (metricChanges.length > 0) {
    changes.push(
      `Latest ${HISTORY_LIMIT}-transaction sample changed (${metricChanges.join("; ")}).`,
    );
  }

  if (
    current.lastHistoryTransactionAt &&
    current.lastHistoryTransactionAt !==
      previous.lastHistoryTransactionAt
  ) {
    changes.push(
      `Newest observed transaction advanced to ${current.lastHistoryTransactionAt}.`,
    );
  }

  return {
    changeStatus:
      changes.length > 0
        ? "CHANGED"
        : "NO_MATERIAL_CHANGE",
    changeExplanation:
      changes.length > 0
        ? changes
        : [
            "No material behavioral change detected since the previous Hunter enrichment.",
          ],
    previousObservedAt:
      previous.enrichedAt ||
      previous.lastHistoryTransactionAt ||
      null,
  };
}

async function main(): Promise<void> {
  console.log(
    "cloudpayX Hunter XRPL behavior enricher — READ ONLY",
  );
  console.log(
    `Public account_tx history, up to ${HISTORY_LIMIT} transactions per account.`,
  );
  console.log(
    "No signing, payment, outreach, or identity assertion.",
  );

  const fundedReport = loadJson(FUNDED_FILE);
  const whaleReport = loadJson(WHALE_FILE);

  const whales = new Map<string, ArchivedAccount>(
    (whaleReport.whales || []).map(
      (account: ArchivedAccount) => [account.account, account],
    ),
  );

  const merged = new Map<
    string,
    {
      archived: ArchivedAccount;
      tier: "MICRO_FUNDED" | "FUNDED_PROSPECT" | "WHALE";
    }
  >();

  for (
    const account of
    fundedReport.fundedProspects || []
  ) {
    if (
      !account.account ||
      INTERNAL_ACCOUNTS.has(account.account)
    ) {
      continue;
    }

    merged.set(account.account, {
      archived: account,
      tier: (() => {
        const economicBalance = Math.max(
          account.xrpBalance || 0,
          account.currentRlusdBalance || 0,
          account.currentUsdcBalance || 0,
        );

        return economicBalance < 50
          ? "MICRO_FUNDED"
          : economicBalance < 5000
            ? "FUNDED_PROSPECT"
            : "WHALE";
      })(),
    });
  }

  for (const account of whales.values()) {
    if (
      !account.account ||
      INTERNAL_ACCOUNTS.has(account.account)
    ) {
      continue;
    }

    merged.set(account.account, {
      archived: account,
      tier: "WHALE",
    });
  }

  const targets = [...merged.values()]
    .sort((a, b) => {
      if (a.tier === "WHALE" && b.tier !== "WHALE") return -1;
      if (a.tier !== "WHALE" && b.tier === "WHALE") return 1;

      return (
        (b.archived.score || 0) -
          (a.archived.score || 0) ||
        b.archived.xrpBalance -
          a.archived.xrpBalance
      );
    })
    .slice(0, MAX_ACCOUNTS);

  const client = new xrpl.Client(XRPL_WS_URL);
  const accounts: any[] = [];
  const failures: Array<{
    account: string;
    reason: string;
  }> = [];

  await client.connect();

  try {
    for (const target of targets) {
      try {
        accounts.push(
          await enrichAccount(
            client,
            target.archived,
            target.tier,
          ),
        );

        console.log(
          `Enriched ${target.archived.account} (${target.tier})`,
        );
      } catch (error) {
        failures.push({
          account: target.archived.account,
          reason:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }
  } finally {
    await client.disconnect();
  }

  accounts.sort(
    (a, b) =>
      b.behaviorConfidence - a.behaviorConfidence ||
      b.xrpBalance - a.xrpBalance,
  );

  let previousReport: any = null;

  if (existsSync(OUTPUT_FILE)) {
    try {
      previousReport = JSON.parse(
        readFileSync(OUTPUT_FILE, "utf8"),
      );
    } catch {
      throw new Error(
        `Existing behavior report is invalid JSON: ${OUTPUT_FILE}`,
      );
    }
  }

  const previousByAccount = new Map<string, any>(
    (previousReport?.accounts || []).map(
      (account: any) => [account.account, account],
    ),
  );

  const enrichedAt = new Date().toISOString();

  const trackedAccounts = accounts.map(
    (account) => {
      const comparison = compareBehavior(
        account,
        previousByAccount.get(account.account) || null,
      );

      return {
        ...account,
        ...comparison,
        enrichedAt,
      };
    },
  );

  const newCount = trackedAccounts.filter(
    (account) => account.changeStatus === "NEW",
  ).length;

  const changedCount = trackedAccounts.filter(
    (account) => account.changeStatus === "CHANGED",
  ).length;

  const unchangedCount = trackedAccounts.filter(
    (account) =>
      account.changeStatus === "NO_MATERIAL_CHANGE",
  ).length;

  const report = {
    generatedAt: enrichedAt,
    previousGeneratedAt:
      previousReport?.generatedAt || null,
    mode: "READ_ONLY",
    historyLimit: HISTORY_LIMIT,
    accountsRequested: targets.length,
    accountsEnriched: trackedAccounts.length,
    newCount,
    changedCount,
    unchangedCount,
    failures,
    disclaimer:
      "Behavioral classifications are probabilistic and do not establish identity, ownership, agency, or intent.",
    accounts: trackedAccounts,
  };

  mkdirSync("data", { recursive: true });

  writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(report, null, 2) + "\n",
  );

  appendFileSync(
    HISTORY_FILE,
    JSON.stringify({
      generatedAt: enrichedAt,
      previousGeneratedAt:
        previousReport?.generatedAt || null,
      newCount,
      changedCount,
      unchangedCount,
      accounts: trackedAccounts.map(
        (account) => ({
          account: account.account,
          tier: account.tier,
          xrpBalance: account.xrpBalance,
          rlusdBalance:
            account.currentRlusdBalance,
          usdcBalance:
            account.currentUsdcBalance,
          classification:
            account.behaviorClassification,
          confidence:
            account.behaviorConfidence,
          changeStatus: account.changeStatus,
          changeExplanation:
            account.changeExplanation,
        }),
      ),
    }) + "\n",
  );

  console.log(`Accounts requested: ${targets.length}`);
  console.log(`Accounts enriched: ${trackedAccounts.length}`);
  console.log(`New intelligence records: ${newCount}`);
  console.log(`Changed intelligence records: ${changedCount}`);
  console.log(`Unchanged intelligence records: ${unchangedCount}`);
  console.log(`Failures: ${failures.length}`);
  console.log(`Latest snapshot: ${OUTPUT_FILE}`);
  console.log(`Change history: ${HISTORY_FILE}`);
  console.log("NO SIGNING. NO PAYMENT. NO OUTREACH.");
}

main().catch((error) => {
  console.error("Behavior enrichment failed:", error);
  process.exitCode = 1;
});
