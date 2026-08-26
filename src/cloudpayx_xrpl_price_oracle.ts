import type {
  XRPLRequestClient
} from "./cloudpayx_xrpl_data_collector";

const RIPPLE_EPOCH_OFFSET =
  946_684_800;

export type XRPLXRPPriceQuote = {
  source:
    "XRPL_VALIDATED_XRP_RLUSD";
  ledgerIndex: number;
  ledgerAgeSeconds: number;
  bestBid: number;
  bestAsk: number;
  midpoint: number;
  ammPrice: number;
  spreadPct: number;
  ammDeviationPct: number;
  observedAt: string;
};

export type XRPLXRPPriceOracleOptions = {
  cacheMs?: number;
  maxLedgerAgeSeconds?: number;
  maxSpreadPct?: number;
  maxAmmDeviationPct?: number;
  now?: () => number;
};

export class XRPLPriceOracleError
  extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);

    this.name =
      "XRPLPriceOracleError";
  }
}

const RLUSD = {
  currency:
    "524C555344000000000000000000000000000000",
  issuer:
    "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"
};

function amountToNumber(
  value: any
): number {
  if (typeof value === "string") {
    const amount =
      Number(value) /
      1_000_000;

    return Number.isFinite(amount)
      ? amount
      : 0;
  }

  const amount =
    Number(value?.value);

  return Number.isFinite(amount)
    ? amount
    : 0;
}

function fundedGets(
  offer: any
): number {
  return amountToNumber(
    offer?.taker_gets_funded ??
    offer?.TakerGets
  );
}

function fundedPays(
  offer: any
): number {
  return amountToNumber(
    offer?.taker_pays_funded ??
    offer?.TakerPays
  );
}

function requirePositive(
  value: unknown,
  code: string,
  message: string
): number {
  const parsed = Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed <= 0
  ) {
    throw new XRPLPriceOracleError(
      code,
      message
    );
  }

  return parsed;
}

function ledgerCloseUnixMs(
  closeTime: unknown
): number {
  const rippleSeconds =
    Number(closeTime);

  if (
    !Number.isFinite(
      rippleSeconds
    )
  ) {
    throw new XRPLPriceOracleError(
      "LEDGER_CLOSE_TIME_MISSING",
      "Validated ledger close time is unavailable."
    );
  }

  return (
    rippleSeconds +
    RIPPLE_EPOCH_OFFSET
  ) * 1000;
}

export function usdToXrpDrops(
  usdAmount: number,
  xrpUsdPrice: number
): string {
  if (
    !Number.isFinite(usdAmount) ||
    usdAmount <= 0
  ) {
    throw new XRPLPriceOracleError(
      "INVALID_USD_AMOUNT",
      "USD amount must be positive."
    );
  }

  if (
    !Number.isFinite(
      xrpUsdPrice
    ) ||
    xrpUsdPrice <= 0
  ) {
    throw new XRPLPriceOracleError(
      "INVALID_XRP_PRICE",
      "XRP price must be positive."
    );
  }

  const drops = Math.round(
    (
      usdAmount /
      xrpUsdPrice
    ) *
    1_000_000
  );

  if (drops < 1) {
    throw new XRPLPriceOracleError(
      "PAYMENT_BELOW_ONE_DROP",
      "Calculated payment is below one drop."
    );
  }

  return drops.toString();
}

export function createXRPLXRPPriceOracle(
  client: XRPLRequestClient,
  options:
    XRPLXRPPriceOracleOptions = {}
) {
  const cacheMs =
    options.cacheMs ?? 30_000;

  const maxLedgerAgeSeconds =
    options.maxLedgerAgeSeconds ??
    30;

  const maxSpreadPct =
    options.maxSpreadPct ?? 1;

  const maxAmmDeviationPct =
    options.maxAmmDeviationPct ??
    2;

  const now =
    options.now ?? Date.now;

  let cached:
    | {
        quote:
          XRPLXRPPriceQuote;
        expiresAt: number;
      }
    | null = null;

  let pending:
    Promise<XRPLXRPPriceQuote>
    | null = null;

  async function fetchQuote():
    Promise<XRPLXRPPriceQuote> {
    const ledgerResponse =
      await client.request({
        command: "ledger",
        ledger_index:
          "validated",
        transactions: false,
        expand: false
      });

    const ledger =
      ledgerResponse.result
        ?.ledger;

    const ledgerIndex =
      Number(
        ledger?.ledger_index ??
        ledger?.seqNum ??
        ledgerResponse.result
          ?.ledger_index
      );

    if (
      !Number.isInteger(
        ledgerIndex
      ) ||
      ledgerIndex <= 0
    ) {
      throw new XRPLPriceOracleError(
        "LEDGER_INDEX_MISSING",
        "Validated ledger index is unavailable."
      );
    }

    const observedAtMs = now();

    const ledgerAgeSeconds =
      Math.max(
        0,
        (
          observedAtMs -
          ledgerCloseUnixMs(
            ledger?.close_time
          )
        ) /
        1000
      );

    if (
      ledgerAgeSeconds >
      maxLedgerAgeSeconds
    ) {
      throw new XRPLPriceOracleError(
        "STALE_VALIDATED_LEDGER",
        `Validated ledger is ${ledgerAgeSeconds.toFixed(3)} seconds old.`
      );
    }

    const [
      asksResponse,
      bidsResponse,
      ammResponse
    ] = await Promise.all([
      client.request({
        command:
          "book_offers",
        taker_gets: {
          currency: "XRP"
        },
        taker_pays:
          RLUSD,
        ledger_index:
          ledgerIndex,
        limit: 50
      }),

      client.request({
        command:
          "book_offers",
        taker_gets:
          RLUSD,
        taker_pays: {
          currency: "XRP"
        },
        ledger_index:
          ledgerIndex,
        limit: 50
      }),

      client.request({
        command:
          "amm_info",
        asset: {
          currency: "XRP"
        },
        asset2:
          RLUSD,
        ledger_index:
          ledgerIndex
      })
    ]);

    const asks =
      Array.isArray(
        asksResponse.result
          ?.offers
      )
        ? asksResponse.result
            .offers
        : [];

    const bids =
      Array.isArray(
        bidsResponse.result
          ?.offers
      )
        ? bidsResponse.result
            .offers
        : [];

    const askPrices =
      asks
        .map((offer: any) => {
          const xrp =
            fundedGets(offer);

          const rlusd =
            fundedPays(offer);

          return (
            xrp > 0 &&
            rlusd > 0
          )
            ? rlusd / xrp
            : 0;
        })
        .filter(
          (price: number) =>
            Number.isFinite(
              price
            ) &&
            price > 0
        );

    const bidPrices =
      bids
        .map((offer: any) => {
          const rlusd =
            fundedGets(offer);

          const xrp =
            fundedPays(offer);

          return (
            xrp > 0 &&
            rlusd > 0
          )
            ? rlusd / xrp
            : 0;
        })
        .filter(
          (price: number) =>
            Number.isFinite(
              price
            ) &&
            price > 0
        );

    if (
      askPrices.length === 0 ||
      bidPrices.length === 0
    ) {
      throw new XRPLPriceOracleError(
        "INSUFFICIENT_PRICE_LIQUIDITY",
        "Validated XRP/RLUSD order book is missing a funded side."
      );
    }

    const bestAsk =
      requirePositive(
        Math.min(
          ...askPrices
        ),
        "INVALID_BEST_ASK",
        "Validated XRP/RLUSD best ask is invalid."
      );

    const bestBid =
      requirePositive(
        Math.max(
          ...bidPrices
        ),
        "INVALID_BEST_BID",
        "Validated XRP/RLUSD best bid is invalid."
      );

    if (bestAsk < bestBid) {
      throw new XRPLPriceOracleError(
        "CROSSED_ORDER_BOOK",
        "Validated XRP/RLUSD order book is crossed."
      );
    }

    const midpoint =
      (
        bestBid +
        bestAsk
      ) / 2;

    const spreadPct =
      (
        (
          bestAsk -
          bestBid
        ) /
        midpoint
      ) * 100;

    if (
      spreadPct >
      maxSpreadPct
    ) {
      throw new XRPLPriceOracleError(
        "PRICE_SPREAD_TOO_WIDE",
        `XRP/RLUSD spread is ${spreadPct.toFixed(4)}%.`
      );
    }

    const amm =
      ammResponse.result?.amm;

    const xrpReserve =
      requirePositive(
        amountToNumber(
          amm?.amount
        ),
        "INVALID_AMM_XRP_RESERVE",
        "XRP/RLUSD AMM XRP reserve is unavailable."
      );

    const rlusdReserve =
      requirePositive(
        amountToNumber(
          amm?.amount2
        ),
        "INVALID_AMM_RLUSD_RESERVE",
        "XRP/RLUSD AMM RLUSD reserve is unavailable."
      );

    const ammPrice =
      rlusdReserve /
      xrpReserve;

    const ammDeviationPct =
      Math.abs(
        (
          midpoint -
          ammPrice
        ) /
        ammPrice
      ) * 100;

    if (
      ammDeviationPct >
      maxAmmDeviationPct
    ) {
      throw new XRPLPriceOracleError(
        "AMM_PRICE_DIVERGENCE",
        `Order-book midpoint and AMM price differ by ${ammDeviationPct.toFixed(4)}%.`
      );
    }

    return {
      source:
        "XRPL_VALIDATED_XRP_RLUSD",
      ledgerIndex,
      ledgerAgeSeconds,
      bestBid,
      bestAsk,
      midpoint,
      ammPrice,
      spreadPct,
      ammDeviationPct,
      observedAt:
        new Date(
          observedAtMs
        ).toISOString()
    };
  }

  async function getQuote(
    forceRefresh = false
  ): Promise<XRPLXRPPriceQuote> {
    const currentTime = now();

    if (
      !forceRefresh &&
      cached &&
      currentTime <
        cached.expiresAt
    ) {
      return cached.quote;
    }

    if (pending) {
      return pending;
    }

    pending =
      fetchQuote()
        .then(quote => {
          const cacheExpiry =
            now() +
            cacheMs;

          const remainingLedgerFreshnessMs =
            Math.max(
              0,
              (
                maxLedgerAgeSeconds -
                quote.ledgerAgeSeconds
              ) *
              1000
            );

          const ledgerExpiry =
            Date.parse(
              quote.observedAt
            ) +
            remainingLedgerFreshnessMs;

          cached = {
            quote,
            expiresAt:
              Math.min(
                cacheExpiry,
                ledgerExpiry
              )
          };

          return quote;
        })
        .finally(() => {
          pending = null;
        });

    return pending;
  }

  async function dropsForUSD(
    usdAmount: number
  ): Promise<{
    amountDrops: string;
    quote: XRPLXRPPriceQuote;
  }> {
    const quote =
      await getQuote();

    return {
      amountDrops:
        usdToXrpDrops(
          usdAmount,
          quote.midpoint
        ),
      quote
    };
  }

  return {
    getQuote,
    dropsForUSD
  };
}
