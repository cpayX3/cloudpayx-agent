import {
  resolveXRPLAsset,
  type XRPLAssetInput,
  type ResolvedXRPLAsset
} from "./cloudpayx_xrpl_asset_resolver";

import {
  collectXRPLAssetData,
  type XRPLAssetData,
  type XRPLRequestClient
} from "./cloudpayx_xrpl_data_collector";

export type XRPLAssetAnalysisV3Input =
  XRPLAssetInput & {
    ledger_index?: unknown;
    holder?: unknown;
    offer_limit?: unknown;
  };

export type XRPLAssetAnalysisV3Result = {
  success: true;
  service:
    "cloudpayx_asset_analysis_v3";
  version: "3.0";
  network: "xrpl:0";
  asset: ResolvedXRPLAsset;
  ledger_index_requested:
    | number
    | "validated"
    | "closed"
    | "current";
  analysis:
    | {
        type: "NATIVE_XRP";
        native: true;
      }
    | {
        type: "ISSUED_CURRENCY";
        issuer:
          Record<string, any>;
      }
    | {
        type: "MPT";
        issuance:
          Record<string, any>;
        dynamic_capabilities:
          Record<string, boolean>;
        holder:
          Record<string, any> | null;
      }
    | {
        type: "NFT";
        nft:
          Record<string, any>;
        buy_offers:
          Record<string, any>[];
        sell_offers:
          Record<string, any>[];
        market: {
          buy_offer_count: number;
          sell_offer_count: number;
        };
      };
};

const CLASSIC_ADDRESS =
  /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function parseLedgerIndex(
  value: unknown
):
  | number
  | "validated"
  | "closed"
  | "current" {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "validated";
  }

  if (
    typeof value === "number"
  ) {
    if (
      !Number.isInteger(value) ||
      value <= 0
    ) {
      throw new Error(
        "ledger_index must be a positive integer or validated, closed, or current."
      );
    }

    return value;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    normalized === "validated" ||
    normalized === "closed" ||
    normalized === "current"
  ) {
    return normalized;
  }

  if (/^[1-9][0-9]*$/.test(normalized)) {
    const numeric =
      Number(normalized);

    if (
      Number.isSafeInteger(numeric)
    ) {
      return numeric;
    }
  }

  throw new Error(
    "ledger_index must be a positive integer or validated, closed, or current."
  );
}

function parseHolder(
  value: unknown
): string | undefined {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return undefined;
  }

  const holder =
    String(value).trim();

  if (!CLASSIC_ADDRESS.test(holder)) {
    throw new Error(
      "holder must be a valid-looking XRPL classic address."
    );
  }

  return holder;
}

function parseOfferLimit(
  value: unknown
): number | undefined {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return undefined;
  }

  const limit = Number(value);

  if (
    !Number.isInteger(limit) ||
    limit < 50 ||
    limit > 500
  ) {
    throw new Error(
      "offer_limit must be an integer between 50 and 500."
    );
  }

  return limit;
}

function formatAnalysis(
  data: XRPLAssetData
): XRPLAssetAnalysisV3Result["analysis"] {
  if (data.kind === "XRP") {
    return {
      type: "NATIVE_XRP",
      native: true
    };
  }

  if (
    data.kind ===
    "ISSUED_CURRENCY"
  ) {
    return {
      type: "ISSUED_CURRENCY",
      issuer: data.issuer
    };
  }

  if (data.kind === "MPT") {
    return {
      type: "MPT",
      issuance: data.issuance,
      dynamic_capabilities:
        data.capabilities,
      holder: data.holder
    };
  }

  return {
    type: "NFT",
    nft: data.nft,
    buy_offers:
      data.buyOffers,
    sell_offers:
      data.sellOffers,
    market: {
      buy_offer_count:
        data.buyOffers.length,
      sell_offer_count:
        data.sellOffers.length
    }
  };
}

export async function analyzeXRPLAssetV3(
  client: XRPLRequestClient,
  input: XRPLAssetAnalysisV3Input
): Promise<XRPLAssetAnalysisV3Result> {
  const asset =
    resolveXRPLAsset(input);

  const ledgerIndex =
    parseLedgerIndex(
      input.ledger_index
    );

  const holder =
    parseHolder(input.holder);

  if (
    holder &&
    asset.kind !== "MPT"
  ) {
    throw new Error(
      "holder is currently supported only for MPT analysis."
    );
  }

  const offerLimit =
    parseOfferLimit(
      input.offer_limit
    );

  if (
    offerLimit !== undefined &&
    asset.kind !== "NFT"
  ) {
    throw new Error(
      "offer_limit is supported only for NFT analysis."
    );
  }

  const data =
    await collectXRPLAssetData(
      client,
      asset,
      {
        ledgerIndex,
        holder,
        offerLimit
      }
    );

  return {
    success: true,
    service:
      "cloudpayx_asset_analysis_v3",
    version: "3.0",
    network: "xrpl:0",
    asset,
    ledger_index_requested:
      ledgerIndex,
    analysis:
      formatAnalysis(data)
  };
}
