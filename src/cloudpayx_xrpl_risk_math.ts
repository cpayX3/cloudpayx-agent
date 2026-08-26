import type {
  XRPLBookSimulation
} from "./cloudpayx_xrpl_market_math";

export type RiskSignal =
  | "ALLOW"
  | "REVIEW"
  | "ABORT";

export type RiskLevel =
  | "LOW"
  | "MODERATE"
  | "HIGH"
  | "CRITICAL";

export type RiskDimension = {
  score: number;
  flags: string[];
};

export type IssuerRiskInput = {
  requireAuthorization: boolean;
  globalFreeze: boolean;
  noFreeze: boolean;
  clawbackEnabled: boolean;
};

export function riskLevel(
  score: number
): RiskLevel {
  if (score < 25) return "LOW";
  if (score < 50) return "MODERATE";
  if (score < 80) return "HIGH";
  return "CRITICAL";
}

export function scoreNetworkRisk(
  ledgerAge: number,
  loadFactor: number
): RiskDimension {
  let score = 0;
  const flags: string[] = [];

  if (ledgerAge > 20) {
    score += 40;
    flags.push("STALE_LEDGER");
  } else if (ledgerAge > 10) {
    score += 20;
    flags.push("LEDGER_DELAY");
  }

  if (loadFactor > 4) {
    score += 35;
    flags.push("HIGH_NETWORK_LOAD");
  } else if (loadFactor > 2) {
    score += 15;
    flags.push(
      "ELEVATED_NETWORK_LOAD"
    );
  }

  return {
    score: Math.min(score, 100),
    flags
  };
}

export function scoreIssuerRisk(
  input: IssuerRiskInput
): RiskDimension {
  let score = 0;
  const flags: string[] = [];

  if (input.globalFreeze) {
    score += 70;
    flags.push(
      "GLOBAL_FREEZE_ENABLED"
    );
  }

  if (input.requireAuthorization) {
    score += 15;
    flags.push(
      "AUTHORIZATION_REQUIRED"
    );
  }

  if (input.clawbackEnabled) {
    score += 10;
    flags.push(
      "CLAWBACK_ENABLED"
    );
  }

  return {
    score: Math.min(score, 100),
    flags
  };
}

export function scoreLiquidityRisk(
  simulation: XRPLBookSimulation,
  visibleOfferCount: number
): RiskDimension {
  let score = 0;
  const flags: string[] = [];

  if (visibleOfferCount === 0) {
    score = 100;
    flags.push(
      "NO_VISIBLE_LIQUIDITY"
    );
  } else if (!simulation.completeFill) {
    score = 90;
    flags.push(
      "INSUFFICIENT_DEPTH"
    );
  } else if (
    simulation.executableOffers <= 2
  ) {
    score = 25;
    flags.push(
      "THIN_VISIBLE_BOOK"
    );
  } else if (
    simulation.executableOffers <= 5
  ) {
    score = 10;
    flags.push(
      "LIMITED_VISIBLE_BOOK"
    );
  }

  return {
    score,
    flags
  };
}

export function scoreExecutionRisk(
  simulation: XRPLBookSimulation
): RiskDimension {
  let score = 0;
  const flags: string[] = [];

  if (!simulation.completeFill) {
    score = 100;
    flags.push(
      "INCOMPLETE_FILL"
    );
  } else if (
    simulation.slippagePct > 10
  ) {
    score = 100;
    flags.push(
      "EXTREME_SLIPPAGE"
    );
  } else if (
    simulation.slippagePct > 3
  ) {
    score = 80;
    flags.push(
      "HIGH_SLIPPAGE"
    );
  } else if (
    simulation.slippagePct > 1
  ) {
    score = 45;
    flags.push(
      "ELEVATED_SLIPPAGE"
    );
  } else if (
    simulation.slippagePct > 0.25
  ) {
    score = 20;
    flags.push(
      "MEASURABLE_SLIPPAGE"
    );
  }

  return {
    score,
    flags
  };
}

export function combineRiskDimensions(
  dimensions: {
    network: RiskDimension;
    asset: RiskDimension;
    liquidity: RiskDimension;
    execution: RiskDimension;
  }
): {
  score: number;
  level: RiskLevel;
  signal: RiskSignal;
  flags: string[];
} {
  const weighted =
    dimensions.network.score * 0.20 +
    dimensions.asset.score * 0.20 +
    dimensions.liquidity.score * 0.25 +
    dimensions.execution.score * 0.35;

  let score =
    Math.round(weighted);

  if (
    dimensions.liquidity.score >= 90 ||
    dimensions.execution.score >= 100 ||
    dimensions.asset.score >= 70 ||
    dimensions.network.score >= 70
  ) {
    score = Math.max(score, 80);
  }

  score =
    Math.min(
      100,
      Math.max(0, score)
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
      ...dimensions.network.flags,
      ...dimensions.asset.flags,
      ...dimensions.liquidity.flags,
      ...dimensions.execution.flags
    ]
  };
}
