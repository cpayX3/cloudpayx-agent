import type {
  ResolvedXRPLAsset
} from "./cloudpayx_xrpl_asset_resolver";

export type XRPLRequestClient = {
  request(
    request: Record<string, unknown>
  ): Promise<{
    result: Record<string, any>;
  }>;
};

export type XRPLCollectionOptions = {
  ledgerIndex?:
    | number
    | "validated"
    | "current"
    | "closed";
  holder?: string;
  offerLimit?: number;
};

export type MPTCapabilities = {
  locked: boolean;
  canLock: boolean;
  requireAuthorization: boolean;
  canEscrow: boolean;
  canTrade: boolean;
  canTransfer: boolean;
  canClawback: boolean;
  confidentialBalances: boolean;
};

export type XRPLAssetData =
  | {
      kind: "XRP";
      asset: ResolvedXRPLAsset;
      ledgerIndex:
        XRPLCollectionOptions["ledgerIndex"];
    }
  | {
      kind: "ISSUED_CURRENCY";
      asset: ResolvedXRPLAsset;
      ledgerIndex:
        XRPLCollectionOptions["ledgerIndex"];
      issuer: Record<string, any>;
      issuerFlags:
        Record<string, boolean>;
    }
  | {
      kind: "MPT";
      asset: ResolvedXRPLAsset;
      ledgerIndex:
        XRPLCollectionOptions["ledgerIndex"];
      issuance: Record<string, any>;
      capabilities: MPTCapabilities;
      holder: Record<string, any> | null;
    }
  | {
      kind: "NFT";
      asset: ResolvedXRPLAsset;
      ledgerIndex:
        XRPLCollectionOptions["ledgerIndex"];
      nft: Record<string, any>;
      buyOffers: Record<string, any>[];
      sellOffers: Record<string, any>[];
    };

const MPT_FLAGS = {
  locked: 0x00000001,
  canLock: 0x00000002,
  requireAuthorization: 0x00000004,
  canEscrow: 0x00000008,
  canTrade: 0x00000010,
  canTransfer: 0x00000020,
  canClawback: 0x00000040,
  confidentialBalances: 0x00000080
} as const;

function hasFlag(
  flags: number,
  flag: number
): boolean {
  return (flags & flag) === flag;
}

export function decodeMPTCapabilities(
  flags: unknown
): MPTCapabilities {
  const value =
    typeof flags === "number" &&
    Number.isFinite(flags)
      ? flags
      : 0;

  return {
    locked:
      hasFlag(value, MPT_FLAGS.locked),
    canLock:
      hasFlag(value, MPT_FLAGS.canLock),
    requireAuthorization:
      hasFlag(
        value,
        MPT_FLAGS.requireAuthorization
      ),
    canEscrow:
      hasFlag(value, MPT_FLAGS.canEscrow),
    canTrade:
      hasFlag(value, MPT_FLAGS.canTrade),
    canTransfer:
      hasFlag(value, MPT_FLAGS.canTransfer),
    canClawback:
      hasFlag(value, MPT_FLAGS.canClawback),
    confidentialBalances:
      hasFlag(
        value,
        MPT_FLAGS.confidentialBalances
      )
  };
}

function ledgerFields(
  options: XRPLCollectionOptions
): Record<string, unknown> {
  return {
    ledger_index:
      options.ledgerIndex ?? "validated"
  };
}

function validateOfferLimit(
  value: number | undefined
): number {
  if (value === undefined) {
    return 250;
  }

  if (
    !Number.isInteger(value) ||
    value < 50 ||
    value > 500
  ) {
    throw new Error(
      "NFT offer limit must be an integer between 50 and 500."
    );
  }

  return value;
}

function errorCode(
  error: unknown
): string {
  if (
    typeof error === "object" &&
    error !== null
  ) {
    const record =
      error as Record<string, any>;

    return String(
      record.data?.error ??
      record.error ??
      record.code ??
      ""
    );
  }

  return "";
}

async function collectNFTOffers(
  client: XRPLRequestClient,
  command:
    | "nft_buy_offers"
    | "nft_sell_offers",
  nftokenId: string,
  options: XRPLCollectionOptions
): Promise<Record<string, any>[]> {
  try {
    const response =
      await client.request({
        command,
        nft_id: nftokenId,
        limit:
          validateOfferLimit(
            options.offerLimit
          ),
        ...ledgerFields(options)
      });

    return Array.isArray(
      response.result.offers
    )
      ? response.result.offers
      : [];
  } catch (error) {
    /*
     * XRPL servers may report
     * objectNotFound when no offer directory
     * exists for this NFToken.
     */
    if (
      errorCode(error) ===
      "objectNotFound"
    ) {
      return [];
    }

    throw error;
  }
}

export async function collectXRPLAssetData(
  client: XRPLRequestClient,
  asset: ResolvedXRPLAsset,
  options: XRPLCollectionOptions = {}
): Promise<XRPLAssetData> {
  const ledgerIndex =
    options.ledgerIndex ?? "validated";

  if (asset.kind === "XRP") {
    return {
      kind: "XRP",
      asset,
      ledgerIndex
    };
  }

  if (
    asset.kind ===
    "ISSUED_CURRENCY"
  ) {
    const response =
      await client.request({
        command: "account_info",
        account: asset.issuer,
        strict: true,
        ...ledgerFields(options)
      });

    return {
      kind: "ISSUED_CURRENCY",
      asset,
      ledgerIndex,
      issuer:
        response.result.account_data,
      issuerFlags:
        response.result.account_flags ??
        {}
    };
  }

  if (asset.kind === "MPT") {
    const issuanceResponse =
      await client.request({
        command: "ledger_entry",
        mpt_issuance:
          asset.issuanceId,
        binary: false,
        ...ledgerFields(options)
      });

    const issuance =
      issuanceResponse.result.node;

    if (
      !issuance ||
      issuance.LedgerEntryType !==
        "MPTokenIssuance"
    ) {
      throw new Error(
        "XRPL returned an invalid MPT issuance ledger object."
      );
    }

    let holder:
      | Record<string, any>
      | null = null;

    if (options.holder) {
      const holderResponse =
        await client.request({
          command: "ledger_entry",
          mptoken: {
            mpt_issuance_id:
              asset.issuanceId,
            account: options.holder
          },
          binary: false,
          ...ledgerFields(options)
        });

      const holderNode =
        holderResponse.result.node;

      if (
        !holderNode ||
        holderNode.LedgerEntryType !==
          "MPToken"
      ) {
        throw new Error(
          "XRPL returned an invalid MPT holder ledger object."
        );
      }

      holder = holderNode;
    }

    return {
      kind: "MPT",
      asset,
      ledgerIndex,
      issuance,
      capabilities:
        decodeMPTCapabilities(
          issuance.Flags
        ),
      holder
    };
  }

  const nftResponse =
    await client.request({
      command: "nft_info",
      nft_id: asset.nftokenId,
      ...ledgerFields(options)
    });

  const nft = nftResponse.result;

  if (
    !nft ||
    nft.nft_id !== asset.nftokenId
  ) {
    throw new Error(
      "XRPL returned invalid NFToken information."
    );
  }

  const buyOffers =
    await collectNFTOffers(
      client,
      "nft_buy_offers",
      asset.nftokenId,
      options
    );

  const sellOffers =
    await collectNFTOffers(
      client,
      "nft_sell_offers",
      asset.nftokenId,
      options
    );

  return {
    kind: "NFT",
    asset,
    ledgerIndex,
    nft,
    buyOffers,
    sellOffers
  };
}
