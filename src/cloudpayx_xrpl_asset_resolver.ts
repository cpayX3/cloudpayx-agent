export type XRPLAssetKind =
  | "XRP"
  | "ISSUED_CURRENCY"
  | "MPT"
  | "NFT";

export type XRPLAssetInput = {
  asset?: unknown;
  currency?: unknown;
  issuer?: unknown;

  asset_type?: unknown;

  mpt_issuance_id?: unknown;
  issuance_id?: unknown;

  nftoken_id?: unknown;
  token_id?: unknown;
};

export type XRPLAssetCapabilities = {
  fungible: boolean;
  issuerAnalysis: boolean;
  trustLines: boolean;
  orderBook: boolean;
  amm: boolean;
  arbitrage: boolean;
  ownership: boolean;
  offers: boolean;
};

export type ResolvedXRPLAsset =
  | {
      kind: "XRP";
      key: "XRP";
      displayCode: "XRP";
      ledgerCurrency: "XRP";
      issuer: null;
      capabilities:
        XRPLAssetCapabilities;
    }
  | {
      kind: "ISSUED_CURRENCY";
      key: string;
      displayCode: string;
      ledgerCurrency: string;
      issuer: string;
      capabilities:
        XRPLAssetCapabilities;
    }
  | {
      kind: "MPT";
      key: string;
      issuanceId: string;
      issuer: null;
      capabilities:
        XRPLAssetCapabilities;
    }
  | {
      kind: "NFT";
      key: string;
      nftokenId: string;
      issuer: null;
      capabilities:
        XRPLAssetCapabilities;
    };

export class XRPLAssetResolutionError
  extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name =
      "XRPLAssetResolutionError";
  }
}

const CLASSIC_ADDRESS =
  /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

const HEX_40 = /^[A-F0-9]{40}$/;
const HEX_48 = /^[A-F0-9]{48}$/;
const HEX_64 = /^[A-F0-9]{64}$/;

const XRP_CAPABILITIES:
  XRPLAssetCapabilities = {
    fungible: true,
    issuerAnalysis: false,
    trustLines: false,
    orderBook: true,
    amm: true,
    arbitrage: true,
    ownership: false,
    offers: false
  };

const ISSUED_CAPABILITIES:
  XRPLAssetCapabilities = {
    fungible: true,
    issuerAnalysis: true,
    trustLines: true,
    orderBook: true,
    amm: true,
    arbitrage: true,
    ownership: false,
    offers: false
  };

const MPT_CAPABILITIES:
  XRPLAssetCapabilities = {
    fungible: true,
    issuerAnalysis: true,
    trustLines: false,
    orderBook: false,
    amm: false,
    arbitrage: false,
    ownership: true,
    offers: false
  };

const NFT_CAPABILITIES:
  XRPLAssetCapabilities = {
    fungible: false,
    issuerAnalysis: true,
    trustLines: false,
    orderBook: false,
    amm: false,
    arbitrage: false,
    ownership: true,
    offers: true
  };

function text(
  value: unknown
): string {
  return String(value ?? "").trim();
}

export function normalizeXRPLCurrency(
  value: unknown
): {
  displayCode: string;
  ledgerCurrency: string;
} {
  const raw = text(value);

  if (!raw) {
    throw new XRPLAssetResolutionError(
      "CURRENCY_REQUIRED",
      "An issued currency code is required."
    );
  }

  const upper = raw.toUpperCase();

  if (upper === "XRP") {
    return {
      displayCode: "XRP",
      ledgerCurrency: "XRP"
    };
  }

  if (HEX_40.test(upper)) {
    return {
      displayCode: upper,
      ledgerCurrency: upper
    };
  }

  if (
    /^[A-Z0-9?!@#$%^&*<>(){}\[\]|]{3}$/.test(
      upper
    )
  ) {
    return {
      displayCode: upper,
      ledgerCurrency: upper
    };
  }

  const bytes =
    Buffer.from(raw, "utf8");

  if (bytes.length > 20) {
    throw new XRPLAssetResolutionError(
      "CURRENCY_TOO_LONG",
      "XRPL issued currency codes cannot exceed 20 bytes."
    );
  }

  return {
    displayCode: raw,
    ledgerCurrency:
      bytes
        .toString("hex")
        .toUpperCase()
        .padEnd(40, "0")
  };
}

function requireIssuer(
  value: unknown
): string {
  const issuer = text(value);

  if (!issuer) {
    throw new XRPLAssetResolutionError(
      "ISSUER_REQUIRED",
      "Issued currencies require an issuer address."
    );
  }

  if (!CLASSIC_ADDRESS.test(issuer)) {
    throw new XRPLAssetResolutionError(
      "INVALID_ISSUER",
      "Issuer must be a valid-looking XRPL classic address."
    );
  }

  return issuer;
}

export function resolveXRPLAsset(
  input: XRPLAssetInput
): ResolvedXRPLAsset {
  const requestedType =
    text(input.asset_type)
      .toUpperCase();

  const mptId =
    text(
      input.mpt_issuance_id ??
      input.issuance_id
    ).toUpperCase();

  const nftokenId =
    text(
      input.nftoken_id ??
      input.token_id
    ).toUpperCase();

  if (
    requestedType === "MPT" ||
    mptId
  ) {
    if (!HEX_48.test(mptId)) {
      throw new XRPLAssetResolutionError(
        "INVALID_MPT_ISSUANCE_ID",
        "MPT issuance ID must contain 48 hexadecimal characters."
      );
    }

    return {
      kind: "MPT",
      key: `MPT:${mptId}`,
      issuanceId: mptId,
      issuer: null,
      capabilities: {
        ...MPT_CAPABILITIES
      }
    };
  }

  if (
    requestedType === "NFT" ||
    nftokenId
  ) {
    if (!HEX_64.test(nftokenId)) {
      throw new XRPLAssetResolutionError(
        "INVALID_NFTOKEN_ID",
        "NFToken ID must contain 64 hexadecimal characters."
      );
    }

    return {
      kind: "NFT",
      key: `NFT:${nftokenId}`,
      nftokenId,
      issuer: null,
      capabilities: {
        ...NFT_CAPABILITIES
      }
    };
  }

  const suppliedCurrency =
    input.asset ??
    input.currency ??
    "XRP";

  const normalized =
    normalizeXRPLCurrency(
      suppliedCurrency
    );

  if (
    normalized.ledgerCurrency === "XRP"
  ) {
    if (text(input.issuer)) {
      throw new XRPLAssetResolutionError(
        "XRP_CANNOT_HAVE_ISSUER",
        "Native XRP does not have an issuer."
      );
    }

    return {
      kind: "XRP",
      key: "XRP",
      displayCode: "XRP",
      ledgerCurrency: "XRP",
      issuer: null,
      capabilities: {
        ...XRP_CAPABILITIES
      }
    };
  }

  const issuer =
    requireIssuer(input.issuer);

  return {
    kind: "ISSUED_CURRENCY",
    key:
      `${normalized.ledgerCurrency}:` +
      issuer,
    displayCode:
      normalized.displayCode,
    ledgerCurrency:
      normalized.ledgerCurrency,
    issuer,
    capabilities: {
      ...ISSUED_CAPABILITIES
    }
  };
}

export function toXRPLAssetObject(
  asset: ResolvedXRPLAsset
): Record<string, string> {
  if (asset.kind === "XRP") {
    return {
      currency: "XRP"
    };
  }

  if (
    asset.kind ===
    "ISSUED_CURRENCY"
  ) {
    return {
      currency:
        asset.ledgerCurrency,
      issuer: asset.issuer
    };
  }

  if (asset.kind === "MPT") {
    return {
      mpt_issuance_id:
        asset.issuanceId
    };
  }

  return {
    nftoken_id:
      asset.nftokenId
  };
}
