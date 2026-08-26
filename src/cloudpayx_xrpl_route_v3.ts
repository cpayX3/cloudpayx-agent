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

export type XRPLRouteV3Input = {
  from?: unknown;
  to?: unknown;
  from_issuer?: unknown;
  to_issuer?: unknown;
  amount?: unknown;
  objective?: unknown;
};

export type XRPLRouteSignal =
  | "ALLOW"
  | "REVIEW"
  | "ABORT"
  | "NOT_APPLICABLE";

export type XRPLRouteLeg = {
  from: string;
  to: string;
  visible_offer_count: number;
  simulation: XRPLBookSimulation;
  ledger_index: number | null;
};

export type XRPLRouteCandidate = {
  type: "DIRECT" | "XRP_BRIDGED";
  path: string[];
  complete_fill: boolean;
  expected_output: number;
  estimated_slippage_pct: number;
  legs: XRPLRouteLeg[];
};

export type XRPLRouteV3Result = {
  success: true;
  service:
    "cloudpayx_stablecoin_route_v3";
  version: "3.0";
  network: "xrpl:0";
  request: {
    from: string;
    to: string;
    amount: number;
    amount_asset: string;
    objective: "BEST_EXECUTION";
  };
  applicable: boolean;
  routes_evaluated:
    XRPLRouteCandidate[];
  recommended_route:
    XRPLRouteCandidate | null;
  decision: {
    signal: XRPLRouteSignal;
    flags: string[];
    reason: string;
  };
  sources: string[];
  generated_at: string;
};

function parseReference(
  value: unknown,
  fallbackIssuer: unknown,
  field: "from" | "to"
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

function parseObjective(
  value: unknown
): "BEST_EXECUTION" {
  const objective =
    String(
      value ??
      "BEST_EXECUTION"
    )
      .trim()
      .toUpperCase();

  if (
    objective !==
    "BEST_EXECUTION"
  ) {
    throw new Error(
      "objective must be BEST_EXECUTION."
    );
  }

  return "BEST_EXECUTION";
}

function resultOffers(
  result: Record<string, any>
): any[] {
  return Array.isArray(
    result.offers
  )
    ? result.offers
    : [];
}

function resultLedgerIndex(
  result: Record<string, any>
): number | null {
  const value =
    Number(
      result.ledger_index ??
      result.ledger_current_index
    );

  return Number.isFinite(value)
    ? value
    : null;
}

async function quoteLeg(
  client: XRPLRequestClient,
  from: ResolvedXRPLAsset,
  to: ResolvedXRPLAsset,
  amount: number
): Promise<XRPLRouteLeg> {
  const response =
    await client.request({
      command: "book_offers",
      taker_gets:
        toXRPLAssetObject(to),
      taker_pays:
        toXRPLAssetObject(from),
      ledger_index:
        "validated",
      limit: 200
    });

  const offers =
    resultOffers(
      response.result
    );

  return {
    from: from.key,
    to: to.key,
    visible_offer_count:
      offers.length,
    simulation:
      simulateXRPLBook(
        offers,
        amount
      ),
    ledger_index:
      resultLedgerIndex(
        response.result
      )
  };
}

function combinedSlippage(
  legs: XRPLRouteLeg[]
): number {
  let retained = 1;

  for (const leg of legs) {
    retained *=
      1 -
      leg.simulation
        .slippagePct /
      100;
  }

  return (
    1 -
    retained
  ) * 100;
}

function routeCandidate(
  type:
    | "DIRECT"
    | "XRP_BRIDGED",
  path: string[],
  legs: XRPLRouteLeg[]
): XRPLRouteCandidate {
  const complete =
    legs.length > 0 &&
    legs.every(
      leg =>
        leg.simulation
          .completeFill
    );

  const finalLeg =
    legs.at(-1);

  return {
    type,
    path,
    complete_fill:
      complete,
    expected_output:
      complete &&
      finalLeg
        ? finalLeg
            .simulation.output
        : 0,
    estimated_slippage_pct:
      complete
        ? combinedSlippage(
            legs
          )
        : 100,
    legs
  };
}

export async function analyzeXRPLRouteV3(
  client: XRPLRequestClient,
  input: XRPLRouteV3Input
): Promise<XRPLRouteV3Result> {
  const from =
    parseReference(
      input.from,
      input.from_issuer,
      "from"
    );

  const to =
    parseReference(
      input.to,
      input.to_issuer,
      "to"
    );

  const amount =
    parseAmount(input.amount);

  const objective =
    parseObjective(
      input.objective
    );

  if (from.key === to.key) {
    throw new Error(
      "from and to assets must differ."
    );
  }

  const capable =
    from.capabilities.fungible &&
    from.capabilities.orderBook &&
    to.capabilities.fungible &&
    to.capabilities.orderBook;

  if (!capable) {
    return {
      success: true,
      service:
        "cloudpayx_stablecoin_route_v3",
      version: "3.0",
      network: "xrpl:0",
      request: {
        from: from.key,
        to: to.key,
        amount,
        amount_asset:
          from.key,
        objective
      },
      applicable: false,
      routes_evaluated: [],
      recommended_route: null,
      decision: {
        signal:
          "NOT_APPLICABLE",
        flags: [
          "ORDER_BOOK_ROUTING_NOT_APPLICABLE"
        ],
        reason:
          "One or more assets do not currently support executable XRPL order-book routing."
      },
      sources: [],
      generated_at:
        new Date().toISOString()
    };
  }

  const directLeg =
    await quoteLeg(
      client,
      from,
      to,
      amount
    );

  const direct =
    routeCandidate(
      "DIRECT",
      [
        from.key,
        to.key
      ],
      [directLeg]
    );

  const routes:
    XRPLRouteCandidate[] = [
      direct
    ];

  if (
    from.kind !== "XRP" &&
    to.kind !== "XRP"
  ) {
    const xrp =
      resolveXRPLAsset({
        asset: "XRP"
      });

    const firstBridgeLeg =
      await quoteLeg(
        client,
        from,
        xrp,
        amount
      );

    const bridgeLegs = [
      firstBridgeLeg
    ];

    if (
      firstBridgeLeg
        .simulation
        .completeFill &&
      firstBridgeLeg
        .simulation.output > 0
    ) {
      bridgeLegs.push(
        await quoteLeg(
          client,
          xrp,
          to,
          firstBridgeLeg
            .simulation.output
        )
      );
    }

    routes.push(
      routeCandidate(
        "XRP_BRIDGED",
        [
          from.key,
          "XRP",
          to.key
        ],
        bridgeLegs
      )
    );
  }

  const completeRoutes =
    routes
      .filter(
        route =>
          route.complete_fill
      )
      .sort(
        (a, b) =>
          b.expected_output -
          a.expected_output
      );

  const recommended =
    completeRoutes[0] ??
    null;

  const flags: string[] = [];

  if (!direct.complete_fill) {
    flags.push(
      "DIRECT_ROUTE_INSUFFICIENT_DEPTH"
    );
  }

  const bridged =
    routes.find(
      route =>
        route.type ===
        "XRP_BRIDGED"
    );

  if (
    bridged &&
    !bridged.complete_fill
  ) {
    flags.push(
      "XRP_BRIDGED_ROUTE_INSUFFICIENT_DEPTH"
    );
  }

  if (
    recommended &&
    recommended
      .estimated_slippage_pct >
      3
  ) {
    flags.push(
      "ELEVATED_ROUTE_SLIPPAGE"
    );
  }

  let signal:
    XRPLRouteSignal;

  if (!recommended) {
    signal = "ABORT";
  } else if (
    recommended
      .estimated_slippage_pct >
    3
  ) {
    signal = "REVIEW";
  } else {
    signal = "ALLOW";
  }

  return {
    success: true,
    service:
      "cloudpayx_stablecoin_route_v3",
    version: "3.0",
    network: "xrpl:0",
    request: {
      from: from.key,
      to: to.key,
      amount,
      amount_asset:
        from.key,
      objective
    },
    applicable: true,
    routes_evaluated:
      routes,
    recommended_route:
      recommended,
    decision: {
      signal,
      flags,
      reason:
        recommended
          ? "The recommended route provides the highest complete executable output."
          : "No evaluated route can completely fill the requested amount."
    },
    sources: [
      "XRPL validated direct book_offers",
      ...(bridged
        ? [
            "XRPL validated XRP-bridged book_offers"
          ]
        : [])
    ],
    generated_at:
      new Date().toISOString()
  };
}
