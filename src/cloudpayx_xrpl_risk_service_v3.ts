import {
  resolveXRPLAsset,
  toXRPLAssetObject,
  type ResolvedXRPLAsset,
  type XRPLAssetInput
} from "./cloudpayx_xrpl_asset_resolver";

import {
  collectXRPLAssetData,
  type XRPLAssetData,
  type XRPLRequestClient
} from "./cloudpayx_xrpl_data_collector";

import {
  simulateXRPLBook,
  type XRPLBookSimulation
} from "./cloudpayx_xrpl_market_math";

import {
  scoreIssuerRisk
} from "./cloudpayx_xrpl_risk_math";

import {
  assessUniversalRisk,
  type AssetRiskObservation,
  type UniversalRiskIntent,
  type UniversalRiskResult
} from "./cloudpayx_xrpl_risk_v3";

export type XRPLRiskAssetReference =
  | string
  | XRPLAssetInput;

export type XRPLRiskServiceV3Input = {
  intent?: unknown;
  from?: unknown;
  to?: unknown;
  from_issuer?: unknown;
  to_issuer?: unknown;
  amount?: unknown;
};

export type XRPLRiskServiceV3Result =
  UniversalRiskResult & {
    ledger: {
      index: number | null;
      age_seconds: number;
      load_factor: number;
    };
    assets: {
      from: ResolvedXRPLAsset;
      to: ResolvedXRPLAsset | null;
    };
    asset_observations:
      AssetRiskObservation[];
    market_observation: {
      pair: string;
      visible_offer_count: number;
      simulation:
        XRPLBookSimulation;
    } | null;
    sources: string[];
    generated_at: string;
  };

function parseIntent(
  value: unknown
): UniversalRiskIntent {
  const intent =
    String(value ?? "TRADE")
      .trim()
      .toUpperCase();

  if (
    intent !== "TRADE" &&
    intent !== "TRANSFER" &&
    intent !== "OWNERSHIP"
  ) {
    throw new Error(
      "intent must be TRADE, TRANSFER, or OWNERSHIP."
    );
  }

  return intent;
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

function assetInput(
  value: unknown,
  fallbackIssuer: unknown,
  field: "from" | "to"
): XRPLAssetInput {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    return value as XRPLAssetInput;
  }

  const asset =
    String(value ?? "").trim();

  if (!asset) {
    throw new Error(
      `${field} asset is required.`
    );
  }

  return {
    asset,
    issuer: fallbackIssuer
  };
}

function numericOr(
  value: unknown,
  fallback: number
): number {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function boundedScore(
  value: number
): number {
  return Math.min(
    100,
    Math.max(0, value)
  );
}

export function observeXRPLAssetRisk(
  data: XRPLAssetData,
  intent: UniversalRiskIntent
): AssetRiskObservation {
  if (data.kind === "XRP") {
    return {
      assetKey: data.asset.key,
      score: 0,
      flags: []
    };
  }

  if (
    data.kind ===
    "ISSUED_CURRENCY"
  ) {
    const flags =
      data.issuerFlags;

    const result =
      scoreIssuerRisk({
        requireAuthorization:
          Boolean(
            flags
              .requireAuthorization
          ),
        globalFreeze:
          Boolean(
            flags.globalFreeze
          ),
        noFreeze:
          Boolean(flags.noFreeze),
        clawbackEnabled:
          Boolean(
            flags
              .allowTrustLineClawback
          )
      });

    return {
      assetKey: data.asset.key,
      score: result.score,
      flags: result.flags
    };
  }

  if (data.kind === "MPT") {
    let score = 0;
    const flags: string[] = [];

    if (data.capabilities.locked) {
      score += 80;
      flags.push("MPT_LOCKED");
    }

    if (
      data.capabilities
        .requireAuthorization
    ) {
      score += 15;
      flags.push(
        "MPT_AUTHORIZATION_REQUIRED"
      );
    }

    if (
      data.capabilities.canClawback
    ) {
      score += 10;
      flags.push(
        "MPT_CLAWBACK_ENABLED"
      );
    }

    if (
      intent === "TRANSFER" &&
      !data.capabilities.canTransfer
    ) {
      score = 100;
      flags.push(
        "MPT_TRANSFER_DISABLED"
      );
    }

    if (
      intent === "TRADE" &&
      !data.capabilities.canTrade
    ) {
      flags.push(
        "MPT_TRADING_DISABLED"
      );
    }

    return {
      assetKey: data.asset.key,
      score:
        boundedScore(score),
      flags
    };
  }

  const burned =
    Boolean(data.nft.is_burned);

  return {
    assetKey: data.asset.key,
    score: burned ? 100 : 0,
    flags:
      burned
        ? ["NFTOKEN_BURNED"]
        : []
  };
}

async function collectNetwork(
  client: XRPLRequestClient
): Promise<{
  index: number | null;
  ledgerAgeSeconds: number;
  loadFactor: number;
}> {
  const response =
    await client.request({
      command: "server_info"
    });

  const info =
    response.result.info ?? {};

  const validated =
    info.validated_ledger ?? {};

  const indexValue =
    Number(validated.seq);

  return {
    index:
      Number.isFinite(indexValue)
        ? indexValue
        : null,
    ledgerAgeSeconds:
      numericOr(
        validated.age,
        999
      ),
    loadFactor:
      numericOr(
        info.load_factor,
        999
      )
  };
}

export async function assessXRPLRiskV3(
  client: XRPLRequestClient,
  input: XRPLRiskServiceV3Input
): Promise<XRPLRiskServiceV3Result> {
  const intent =
    parseIntent(input.intent);

  const amount =
    parseAmount(input.amount);

  const from =
    resolveXRPLAsset(
      assetInput(
        input.from,
        input.from_issuer,
        "from"
      )
    );

  let to:
    | ResolvedXRPLAsset
    | undefined;

  if (
    input.to !== undefined &&
    input.to !== null &&
    input.to !== ""
  ) {
    to = resolveXRPLAsset(
      assetInput(
        input.to,
        input.to_issuer,
        "to"
      )
    );
  }

  if (
    intent === "TRADE" &&
    !to
  ) {
    throw new Error(
      "to asset is required for TRADE risk."
    );
  }

  if (
    to &&
    to.key === from.key
  ) {
    throw new Error(
      "from and to assets must differ."
    );
  }

  const network =
    await collectNetwork(client);

  const fromData =
    await collectXRPLAssetData(
      client,
      from,
      {
        ledgerIndex: "validated"
      }
    );

  const observations:
    AssetRiskObservation[] = [
      observeXRPLAssetRisk(
        fromData,
        intent
      )
    ];

  let toData:
    | XRPLAssetData
    | undefined;

  if (to) {
    toData =
      await collectXRPLAssetData(
        client,
        to,
        {
          ledgerIndex:
            "validated"
        }
      );

    observations.push(
      observeXRPLAssetRisk(
        toData,
        intent
      )
    );
  }

  let market:
    | {
        simulation:
          XRPLBookSimulation;
        visibleOfferCount:
          number;
      }
    | undefined;

  let marketObservation:
    XRPLRiskServiceV3Result[
      "market_observation"
    ] = null;

  const marketCapable =
    intent === "TRADE" &&
    Boolean(to) &&
    from.capabilities.fungible &&
    from.capabilities.orderBook &&
    to!.capabilities.fungible &&
    to!.capabilities.orderBook;

  if (marketCapable) {
    const response =
      await client.request({
        command: "book_offers",
        taker_gets:
          toXRPLAssetObject(to!),
        taker_pays:
          toXRPLAssetObject(from),
        ledger_index:
          "validated",
        limit: 200
      });

    const offers =
      Array.isArray(
        response.result.offers
      )
        ? response.result.offers
        : [];

    const simulation =
      simulateXRPLBook(
        offers,
        amount
      );

    market = {
      simulation,
      visibleOfferCount:
        offers.length
    };

    marketObservation = {
      pair:
        `${from.key}->${to!.key}`,
      visible_offer_count:
        offers.length,
      simulation
    };
  }

  const assessed =
    assessUniversalRisk({
      intent,
      from,
      to,
      amount,
      network: {
        ledgerAgeSeconds:
          network
            .ledgerAgeSeconds,
        loadFactor:
          network.loadFactor
      },
      assetRisks:
        observations,
      market
    });

  return {
    ...assessed,
    ledger: {
      index: network.index,
      age_seconds:
        network
          .ledgerAgeSeconds,
      load_factor:
        network.loadFactor
    },
    assets: {
      from,
      to: to ?? null
    },
    asset_observations:
      observations,
    market_observation:
      marketObservation,
    sources: [
      "XRPL validated server_info",
      "XRPL validated asset ledger objects",
      ...(marketCapable
        ? [
            "XRPL validated book_offers"
          ]
        : [])
    ],
    generated_at:
      new Date().toISOString()
  };
}
