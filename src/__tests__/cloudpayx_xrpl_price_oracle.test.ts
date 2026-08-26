import {
  describe,
  expect,
  test
} from "bun:test";

import {
  createXRPLXRPPriceOracle,
  usdToXrpDrops,
  XRPLPriceOracleError
} from "../cloudpayx_xrpl_price_oracle";

const NOW =
  Date.UTC(
    2026,
    7,
    26,
    18,
    0,
    0
  );

const CLOSE_TIME =
  Math.floor(
    NOW / 1000
  ) -
  946_684_800 -
  2;

function makeClient(
  overrides:
    Record<string, any> = {}
) {
  const calls:
    string[] = [];

  const client = {
    async request(
      request: any
    ) {
      calls.push(
        request.command
      );

      if (
        overrides[
          request.command
        ] instanceof Error
      ) {
        throw overrides[
          request.command
        ];
      }

      if (
        overrides[
          request.command
        ]
      ) {
        return overrides[
          request.command
        ];
      }

      if (
        request.command ===
        "ledger"
      ) {
        return {
          result: {
            ledger: {
              ledger_index:
                100,
              close_time:
                CLOSE_TIME
            }
          }
        };
      }

      if (
        request.command ===
        "book_offers"
      ) {
        const asks =
          request.taker_gets
            .currency === "XRP";

        return {
          result: {
            offers: asks
              ? [
                  {
                    TakerGets:
                      "10000000",
                    TakerPays: {
                      value:
                        "13.9"
                    }
                  }
                ]
              : [
                  {
                    TakerGets: {
                      value:
                        "13.87"
                    },
                    TakerPays:
                      "10000000"
                  }
                ]
          }
        };
      }

      if (
        request.command ===
        "amm_info"
      ) {
        return {
          result: {
            amm: {
              amount:
                "1000000000",
              amount2: {
                value:
                  "1389"
              }
            }
          }
        };
      }

      throw new Error(
        "Unexpected command"
      );
    }
  };

  return {
    client,
    calls
  };
}

describe(
  "cloudpayX XRPL price oracle",
  () => {
    test(
      "converts USD directly to drops",
      () => {
        expect(
          usdToXrpDrops(
            0.01,
            1.388175
          )
        ).toBe("7204");
      }
    );

    test(
      "rejects invalid conversion inputs",
      () => {
        expect(
          () =>
            usdToXrpDrops(
              0,
              1.39
            )
        ).toThrow(
          XRPLPriceOracleError
        );

        expect(
          () =>
            usdToXrpDrops(
              0.01,
              0
            )
        ).toThrow(
          "XRP price must be positive."
        );

        expect(
          () =>
            usdToXrpDrops(
              0.00000001,
              100
            )
        ).toThrow(
          "below one drop"
        );
      }
    );

    test(
      "uses one validated ledger for every market request",
      async () => {
        const {
          client,
          calls
        } = makeClient();

        const oracle =
          createXRPLXRPPriceOracle(
            client,
            {
              now: () => NOW
            }
          );

        const quote =
          await oracle.getQuote();

        expect(
          quote.ledgerIndex
        ).toBe(100);

        expect(
          quote.midpoint
        ).toBeCloseTo(
          1.3885,
          6
        );

        expect(
          quote.ammPrice
        ).toBeCloseTo(
          1.389,
          6
        );

        expect(calls).toEqual([
          "ledger",
          "book_offers",
          "book_offers",
          "amm_info"
        ]);
      }
    );

    test(
      "returns precise drops and quote",
      async () => {
        const {
          client
        } = makeClient();

        const oracle =
          createXRPLXRPPriceOracle(
            client,
            {
              now: () => NOW
            }
          );

        const result =
          await oracle.dropsForUSD(
            0.10
          );

        expect(
          result.amountDrops
        ).toBe("72020");

        expect(
          result.quote.source
        ).toBe(
          "XRPL_VALIDATED_XRP_RLUSD"
        );
      }
    );

    test(
      "caches a healthy quote",
      async () => {
        const {
          client,
          calls
        } = makeClient();

        let currentTime = NOW;

        const oracle =
          createXRPLXRPPriceOracle(
            client,
            {
              now:
                () =>
                  currentTime,
              cacheMs: 30_000
            }
          );

        const first =
          await oracle.getQuote();

        currentTime += 10_000;

        const second =
          await oracle.getQuote();

        expect(second).toBe(first);

        expect(
          calls.filter(
            call =>
              call === "ledger"
          ).length
        ).toBe(1);
      }
    );

    test(
      "never caches beyond validated-ledger freshness",
      async () => {
        const {
          client,
          calls
        } = makeClient();

        let currentTime = NOW;

        const oracle =
          createXRPLXRPPriceOracle(
            client,
            {
              now:
                () =>
                  currentTime,
              cacheMs: 60_000,
              maxLedgerAgeSeconds:
                30
            }
          );

        await oracle.getQuote();

        currentTime += 29_000;

        await expect(
          oracle.getQuote()
        ).rejects.toThrow(
          "Validated ledger is"
        );

        expect(
          calls.filter(
            call =>
              call === "ledger"
          ).length
        ).toBe(2);
      }
    );

    test(
      "rejects a stale validated ledger",
      async () => {
        const {
          client
        } = makeClient({
          ledger: {
            result: {
              ledger: {
                ledger_index:
                  100,
                close_time:
                  CLOSE_TIME -
                  60
              }
            }
          }
        });

        const oracle =
          createXRPLXRPPriceOracle(
            client,
            {
              now: () => NOW
            }
          );

        await expect(
          oracle.getQuote()
        ).rejects.toThrow(
          "Validated ledger is"
        );
      }
    );

    test(
      "rejects missing book liquidity",
      async () => {
        const {
          client
        } = makeClient({
          book_offers: {
            result: {
              offers: []
            }
          }
        });

        const oracle =
          createXRPLXRPPriceOracle(
            client,
            {
              now: () => NOW
            }
          );

        await expect(
          oracle.getQuote()
        ).rejects.toThrow(
          "missing a funded side"
        );
      }
    );

    test(
      "rejects excessive spread",
      async () => {
        const {
          client
        } = makeClient();

        let bookCall = 0;

        const wrapped = {
          async request(
            request: any
          ) {
            if (
              request.command ===
              "book_offers"
            ) {
              bookCall += 1;

              return bookCall === 1
                ? {
                    result: {
                      offers: [{
                        TakerGets:
                          "10000000",
                        TakerPays: {
                          value:
                            "15"
                        }
                      }]
                    }
                  }
                : {
                    result: {
                      offers: [{
                        TakerGets: {
                          value:
                            "13"
                        },
                        TakerPays:
                          "10000000"
                      }]
                    }
                  };
            }

            return client.request(
              request
            );
          }
        };

        const oracle =
          createXRPLXRPPriceOracle(
            wrapped,
            {
              now: () => NOW
            }
          );

        await expect(
          oracle.getQuote()
        ).rejects.toThrow(
          "spread is"
        );
      }
    );

    test(
      "rejects AMM divergence",
      async () => {
        const {
          client
        } = makeClient({
          amm_info: {
            result: {
              amm: {
                amount:
                  "1000000000",
                amount2: {
                  value: "1000"
                }
              }
            }
          }
        });

        const oracle =
          createXRPLXRPPriceOracle(
            client,
            {
              now: () => NOW
            }
          );

        await expect(
          oracle.getQuote()
        ).rejects.toThrow(
          "AMM price differ"
        );
      }
    );

    test(
      "deduplicates simultaneous refreshes",
      async () => {
        const {
          client,
          calls
        } = makeClient();

        const oracle =
          createXRPLXRPPriceOracle(
            client,
            {
              now: () => NOW
            }
          );

        const [
          first,
          second
        ] = await Promise.all([
          oracle.getQuote(),
          oracle.getQuote()
        ]);

        expect(second).toBe(first);

        expect(
          calls.filter(
            call =>
              call === "ledger"
          ).length
        ).toBe(1);
      }
    );
  }
);
