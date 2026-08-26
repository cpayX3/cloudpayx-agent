import type {
  ResolvedXRPLAsset
} from "./cloudpayx_xrpl_asset_resolver";

import type {
  XRPLBookSimulation
} from "./cloudpayx_xrpl_market_math";

import {
  combineRiskDimensions,
  riskLevel,
  scoreExecutionRisk,
  scoreLiquidityRisk,
  scoreNetworkRisk,
  type RiskDimension,
  type RiskLevel,
  type RiskSignal
} from "./cloudpayx_xrpl_risk_math";

export type UniversalRiskIntent =
  | "TRADE"
  | "TRANSFER"
  | "OWNERSHIP";

export type UniversalRiskSignal =
  | RiskSignal
  | "NOT_APPLICABLE";

export type AssetRiskObservation = {
  assetKey: string;
  score: number;
  flags: string[];
};

export type UniversalRiskContext = {
  intent: UniversalRiskIntent;

  from: ResolvedXRPLAsset;
  to?: ResolvedXRPLAsset;

  amount: number;

  network: {
    ledgerAgeSeconds: number;
    loadFactor: number;
  };

  assetRisks:
    AssetRiskObservation[];

  market?: {
    simulation:
      XRPLBookSimulation;
    visibleOfferCount: number;
  };
};

export type DimensionResult = {
  status:
    | "ASSESSED"
    | "NOT_APPLICABLE"
    | "UNAVAILABLE";
  score: number | null;
  level: RiskLevel | null;
  flags: string[];
};

export type UniversalRiskResult = {
  success: true;
  service:
    "cloudpayx_risk_check_v3";
  version: "3.0";
  network: "xrpl:0";

  request: {
    intent: UniversalRiskIntent;
    from: string;
    to: string | null;
    amount: number;
  };

  risk: {
    score: number | null;
    max_score: 100;
    level: RiskLevel | null;
  };

  dimensions: {
    network: DimensionResult;
    asset: DimensionResult;
    liquidity: DimensionResult;
    execution: DimensionResult;
  };

  decision: {
    signal:
      UniversalRiskSignal;
    flags: string[];
    reason: string;
  };
};

function dimension(
  risk: RiskDimension
): DimensionResult {
  return {
    status: "ASSESSED",
    score: risk.score,
    level: riskLevel(risk.score),
    flags: [...risk.flags]
  };
}

function unavailable(
  flag: string
): DimensionResult {
  return {
    status: "UNAVAILABLE",
    score: null,
    level: null,
    flags: [flag]
  };
}

function notApplicable():
  DimensionResult {
  return {
    status: "NOT_APPLICABLE",
    score: null,
    level: null,
    flags: []
  };
}

function aggregateAssetRisk(
  observations:
    AssetRiskObservation[]
): RiskDimension {
  let score = 0;
  const flags: string[] = [];

  for (
    const observation
    of observations
  ) {
    score = Math.max(
      score,
      Math.min(
        100,
        Math.max(
          0,
          observation.score
        )
      )
    );

    flags.push(
      ...observation.flags.map(
        flag =>
          `${observation.assetKey}:${flag}`
      )
    );
  }

  return {
    score,
    flags
  };
}

function nonMarketDecision(
  network: RiskDimension,
  asset: RiskDimension
): {
  score: number;
  level: RiskLevel;
  signal: RiskSignal;
  flags: string[];
} {
  const score =
    Math.max(
      network.score,
      asset.score
    );

  const signal: RiskSignal =
    score >= 80
      ? "ABORT"
      : score >= 25
        ? "REVIEW"
        : "ALLOW";

  return {
    score,
    level: riskLevel(score),
    signal,
    flags: [
      ...network.flags,
      ...asset.flags
    ]
  };
}

export function assessUniversalRisk(
  context: UniversalRiskContext
): UniversalRiskResult {
  if (
    !Number.isFinite(context.amount) ||
    context.amount <= 0
  ) {
    throw new Error(
      "Risk amount must be positive."
    );
  }

  const networkRisk =
    scoreNetworkRisk(
      context.network
        .ledgerAgeSeconds,
      context.network
        .loadFactor
    );

  const assetRisk =
    aggregateAssetRisk(
      context.assetRisks
    );

  const base = {
    success: true as const,
    service:
      "cloudpayx_risk_check_v3" as const,
    version: "3.0" as const,
    network: "xrpl:0" as const,

    request: {
      intent: context.intent,
      from: context.from.key,
      to: context.to?.key ?? null,
      amount: context.amount
    }
  };

  if (
    context.intent === "TRADE"
  ) {
    const marketCapable =
      context.from
        .capabilities.fungible &&
      context.from
        .capabilities.orderBook &&
      Boolean(context.to) &&
      context.to!
        .capabilities.fungible &&
      context.to!
        .capabilities.orderBook;

    if (!marketCapable) {
      return {
        ...base,
        risk: {
          score: null,
          max_score: 100,
          level: null
        },
        dimensions: {
          network:
            dimension(networkRisk),
          asset:
            dimension(assetRisk),
          liquidity:
            notApplicable(),
          execution:
            notApplicable()
        },
        decision: {
          signal:
            "NOT_APPLICABLE",
          flags: [
            "TRADE_MARKET_NOT_APPLICABLE"
          ],
          reason:
            "One or more assets do not support fungible XRPL order-book trading."
        }
      };
    }

    if (!context.market) {
      return {
        ...base,
        risk: {
          score: 80,
          max_score: 100,
          level: "CRITICAL"
        },
        dimensions: {
          network:
            dimension(networkRisk),
          asset:
            dimension(assetRisk),
          liquidity:
            unavailable(
              "MARKET_DATA_UNAVAILABLE"
            ),
          execution:
            unavailable(
              "MARKET_DATA_UNAVAILABLE"
            )
        },
        decision: {
          signal: "ABORT",
          flags: [
            ...networkRisk.flags,
            ...assetRisk.flags,
            "MARKET_DATA_UNAVAILABLE"
          ],
          reason:
            "Trade risk cannot be approved without current execution data."
        }
      };
    }

    const liquidityRisk =
      scoreLiquidityRisk(
        context.market.simulation,
        context.market
          .visibleOfferCount
      );

    const executionRisk =
      scoreExecutionRisk(
        context.market.simulation
      );

    const combined =
      combineRiskDimensions({
        network: networkRisk,
        asset: assetRisk,
        liquidity:
          liquidityRisk,
        execution:
          executionRisk
      });

    return {
      ...base,
      risk: {
        score: combined.score,
        max_score: 100,
        level: combined.level
      },
      dimensions: {
        network:
          dimension(networkRisk),
        asset:
          dimension(assetRisk),
        liquidity:
          dimension(liquidityRisk),
        execution:
          dimension(executionRisk)
      },
      decision: {
        signal: combined.signal,
        flags: combined.flags,
        reason:
          "Trade risk assessed using network, asset, liquidity and execution dimensions."
      }
    };
  }

  const assessed =
    nonMarketDecision(
      networkRisk,
      assetRisk
    );

  return {
    ...base,
    risk: {
      score: assessed.score,
      max_score: 100,
      level: assessed.level
    },
    dimensions: {
      network:
        dimension(networkRisk),
      asset:
        dimension(assetRisk),
      liquidity:
        notApplicable(),
      execution:
        notApplicable()
    },
    decision: {
      signal: assessed.signal,
      flags: assessed.flags,
      reason:
        context.intent ===
        "TRANSFER"
          ? "Transfer risk assessed without applying market-liquidity assumptions."
          : "Ownership risk assessed without applying fungible-market assumptions."
    }
  };
}
