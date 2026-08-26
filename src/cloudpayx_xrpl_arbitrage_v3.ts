import {
  resolveXRPLAsset,
  toXRPLAssetObject,
  type ResolvedXRPLAsset,
  type XRPLAssetInput
} from "./cloudpayx_xrpl_asset_resolver";

import {
  simulateXRPLBook,
  type XRPLBookSimulation
} from "./cloudpayx_xrpl_market_math";

import type {
  XRPLRequestClient
} from "./cloudpayx_xrpl_data_collector";

export type XRPLArbitrageV3Input = {
  base?: unknown;
  quote?: unknown;
  base_issuer?: unknown;
  quote_issuer?: unknown;
  amount?: unknown;
};

export type XRPLArbitrageSignal =
  | "ALLOW"
  | "REVIEW"
  | "ABORT"
  | "NOT_APPLICABLE";

export type XRPLArbitrageV3Result = {
  success: true;
  service:
    "cloudpayx_arbitrage_check_v3";
  version: "3.0";
  network: "xrpl:0";
  request: {
    base: string;
    quote: string;
    amount: number;
    amount_asset: string;
  };
  applicable: boolean;
  cycle: {
    path: string[];
    complete: boolean;
  };
  legs: {
    forward: XRPLBookSimulation | null;
    reverse: XRPLBookSimulation | null;
  };
  opportunity: {
    exists: boolean;
    gross_profit_base: number | null;
    gross_return_pct: number | null;
    combined_slippage_pct: number | null;
    minimum_edge_pct: number;
  };
  decision: {
    signal: XRPLArbitrageSignal;
    flags: string[];
    reason: string;
  };
  ledger_index: number | null;
  sources: string[];
  generated_at: string;
};

const MINIMUM_EDGE_PCT = 0.05;

const EMPTY_SIMULATION:
  XRPLBookSimulation = {
    output: 0,
    consumedInput: 0,
    executableOffers: 0,
    completeFill: false,
    bestRate: 0,
    averageExecutionRate: 0,
    slippagePct: 100
  };

function parseAssetReference(
  value: unknown,
  fallbackIssuer: unknown,
  field: "base" | "quote"
): ResolvedXRPLAsset {
  let input: XRPLAssetInput;

  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    input =
      value as XRPLAssetInput;
  } else {
    const asset =
      String(value ?? "").trim();

    if (!asset) {
      throw new Error(
        `${field} asset is required.`
      );
    }

    input = {
      asset,
      issuer: fallbackIssuer
    };
  }

  return resolveXRPLAsset(input);
}

function parseAmount(
  value: unknown
): number {
  const amount =
    Number(value ?? 100);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "amount must be a positive number."
    );
  }

  return amount;
}

function offersFrom(
  result: Record<string, any>
): any[] {
  return Array.isArray(
    result.offers
  )
    ? result.offers
    : [];
}

function ledgerIndexFrom(
  ...results: Record<string, any>[]
): number | null {
  for (const result of results) {
    const value =
      Number(
        result.ledger_index ??
        result.ledger_current_index
      );

    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

export async function analyzeXRPLArbitrageV3(
  client: XRPLRequestClient,
  input: XRPLArbitrageV3Input
): Promise<XRPLArbitrageV3Result> {
  const base =
    parseAssetReference(
      input.base,
      input.base_issuer,
      "base"
    );

  const quote =
    parseAssetReference(
      input.quote,
      input.quote_issuer,
      "quote"
    );

  const amount =
    parseAmount(input.amount);

  if (base.key === quote.key) {
    throw new Error(
      "base and quote assets must differ."
    );
  }

  const path = [
    base.key,
    quote.key,
    base.key
  ];

  const marketCapable =
    base.capabilities.fungible &&
    base.capabilities.orderBook &&
    quote.capabilities.fungible &&
    quote.capabilities.orderBook;

  if (!marketCapable) {
    return {
      success: true,
      service:
        "cloudpayx_arbitrage_check_v3",
      version: "3.0",
      network: "xrpl:0",
      request: {
        base: base.key,
        quote: quote.key,
        amount,
        amount_asset: base.key
      },
      applicable: false,
      cycle: {
        path,
        complete: false
      },
      legs: {
        forward: null,
        reverse: null
      },
      opportunity: {
        exists: false,
        gross_profit_base: null,
        gross_return_pct: null,
        combined_slippage_pct: null,
        minimum_edge_pct:
          MINIMUM_EDGE_PCT
      },
      decision: {
        signal:
          "NOT_APPLICABLE",
        flags: [
          "ORDER_BOOK_ARBITRAGE_NOT_APPLICABLE"
        ],
        reason:
          "One or more assets do not currently support executable XRPL order-book trading."
      },
      ledger_index: null,
      sources: [],
      generated_at:
        new Date().toISOString()
    };
  }

  const baseObject =
    toXRPLAssetObject(base);

  const quoteObject =
    toXRPLAssetObject(quote);

  const forwardBook =
    await client.request({
      command: "book_offers",
      taker_gets: quoteObject,
      taker_pays: baseObject,
      ledger_index: "validated",
      limit: 200
    });

  const reverseBook =
    await client.request({
      command: "book_offers",
      taker_gets: baseObject,
      taker_pays: quoteObject,
      ledger_index: "validated",
      limit: 200
    });

  const forwardOffers =
    offersFrom(
      forwardBook.result
    );

  const reverseOffers =
    offersFrom(
      reverseBook.result
    );

  const forward =
    simulateXRPLBook(
      forwardOffers,
      amount
    );

  const reverse =
    forward.completeFill &&
    forward.output > 0
      ? simulateXRPLBook(
          reverseOffers,
          forward.output
        )
      : {
          ...EMPTY_SIMULATION
        };

  const roundTripComplete =
    forward.completeFill &&
    reverse.completeFill;

  const finalBaseAmount =
    roundTripComplete
      ? reverse.output
      : 0;

  const grossProfitBase =
    roundTripComplete
      ? finalBaseAmount - amount
      : 0;

  const grossReturnPct =
    roundTripComplete
      ? (
          grossProfitBase /
          amount
        ) * 100
      : null;

  const combinedSlippagePct =
    roundTripComplete
      ? (
          1 -
          (
            (
              1 -
              forward.slippagePct /
              100
            ) *
            (
              1 -
              reverse.slippagePct /
              100
            )
          )
        ) * 100
      : null;

  const opportunityExists =
    roundTripComplete &&
    grossReturnPct !== null &&
    grossReturnPct >
      MINIMUM_EDGE_PCT;

  const flags: string[] = [];

  if (!forward.completeFill) {
    flags.push(
      "FORWARD_LEG_INSUFFICIENT_DEPTH"
    );
  }

  if (
    forward.completeFill &&
    !reverse.completeFill
  ) {
    flags.push(
      "REVERSE_LEG_INSUFFICIENT_DEPTH"
    );
  }

  if (
    roundTripComplete &&
    grossReturnPct !== null &&
    grossReturnPct <= 0
  ) {
    flags.push(
      "NO_POSITIVE_EDGE"
    );
  }

  if (
    roundTripComplete &&
    grossReturnPct !== null &&
    grossReturnPct > 0 &&
    grossReturnPct <=
      MINIMUM_EDGE_PCT
  ) {
    flags.push(
      "EDGE_BELOW_THRESHOLD"
    );
  }

  if (
    combinedSlippagePct !== null &&
    combinedSlippagePct > 1
  ) {
    flags.push(
      "ELEVATED_ROUND_TRIP_SLIPPAGE"
    );
  }

  let signal:
    XRPLArbitrageSignal;

  if (
    opportunityExists &&
    combinedSlippagePct !== null &&
    combinedSlippagePct <= 1
  ) {
    signal = "ALLOW";
  } else if (
    roundTripComplete &&
    grossReturnPct !== null &&
    grossReturnPct > 0
  ) {
    signal = "REVIEW";
  } else {
    signal = "ABORT";
  }

  return {
    success: true,
    service:
      "cloudpayx_arbitrage_check_v3",
    version: "3.0",
    network: "xrpl:0",
    request: {
      base: base.key,
      quote: quote.key,
      amount,
      amount_asset: base.key
    },
    applicable: true,
    cycle: {
      path,
      complete:
        roundTripComplete
    },
    legs: {
      forward,
      reverse
    },
    opportunity: {
      exists:
        opportunityExists,
      gross_profit_base:
        roundTripComplete
          ? grossProfitBase
          : null,
      gross_return_pct:
        grossReturnPct,
      combined_slippage_pct:
        combinedSlippagePct,
      minimum_edge_pct:
        MINIMUM_EDGE_PCT
    },
    decision: {
      signal,
      flags,
      reason:
        opportunityExists
          ? "A complete executable round trip exceeds the configured minimum edge."
          : "No qualifying executable round-trip edge was found."
    },
    ledger_index:
      ledgerIndexFrom(
        forwardBook.result,
        reverseBook.result
      ),
    sources: [
      "XRPL validated forward book_offers",
      "XRPL validated reverse book_offers"
    ],
    generated_at:
      new Date().toISOString()
  };
}
