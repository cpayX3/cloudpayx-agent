import {
  describe,
  expect,
  test
} from "bun:test";

import {
  analyzeXRPLArbitrageV3
} from "../cloudpayx_xrpl_arbitrage_v3";

import type {
  XRPLRequestClient
} from "../cloudpayx_xrpl_data_collector";

const ISSUER =
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

const NFT_ID =
  "B".repeat(64);

function clientWith(
  results: Record<string, any>[]
): {
  client: XRPLRequestClient;
  requests: Record<string, unknown>[];
} {
  const requests:
    Record<string, unknown>[] = [];

  return {
    requests,
    client: {
      async request(request) {
        requests.push(request);

        const result =
          results.shift();

        if (!result) {
          throw new Error(
            "Unexpected request."
          );
        }

        return {
          result
        };
      }
    }
  };
}

describe(
  "cloudpayX universal XRPL arbitrage V3",
  () => {
    test(
      "detects an executable positive round trip",
      async () => {
        const { client, requests } =
          clientWith([
            {
              ledger_index: 100,
              offers: [
                {
                  TakerPays:
                    "100000000",
                  TakerGets: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "200"
                  }
                }
              ]
            },
            {
              ledger_index: 100,
              offers: [
                {
                  TakerPays: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "200"
                  },
                  TakerGets:
                    "101000000"
                }
              ]
            }
          ]);

        const result =
          await analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              quote: {
                asset: "TOK",
                issuer: ISSUER
              },
              amount: 100
            }
          );

        expect(result.applicable)
          .toBe(true);
        expect(result.cycle.complete)
          .toBe(true);
        expect(
          result.opportunity.exists
        ).toBe(true);
        expect(result.decision.signal)
          .toBe("ALLOW");
        expect(
          result.opportunity
            .gross_return_pct
        ).toBeCloseTo(1);
        expect(result.ledger_index)
          .toBe(100);
        expect(requests)
          .toHaveLength(2);
      }
    );

    test(
      "aborts when the forward book cannot fill",
      async () => {
        const { client } =
          clientWith([
            {
              offers: []
            },
            {
              offers: []
            }
          ]);

        const result =
          await analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              quote: {
                asset: "TOK",
                issuer: ISSUER
              },
              amount: 100
            }
          );

        expect(result.cycle.complete)
          .toBe(false);
        expect(result.decision.signal)
          .toBe("ABORT");
        expect(result.decision.flags)
          .toContain(
            "FORWARD_LEG_INSUFFICIENT_DEPTH"
          );
        expect(
          result.opportunity
            .gross_return_pct
        ).toBeNull();
      }
    );

    test(
      "flags insufficient reverse-book depth",
      async () => {
        const { client } =
          clientWith([
            {
              offers: [
                {
                  TakerPays:
                    "100000000",
                  TakerGets: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "200"
                  }
                }
              ]
            },
            {
              offers: [
                {
                  TakerPays: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "100"
                  },
                  TakerGets:
                    "50000000"
                }
              ]
            }
          ]);

        const result =
          await analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              quote: {
                asset: "TOK",
                issuer: ISSUER
              },
              amount: 100
            }
          );

        expect(result.decision.signal)
          .toBe("ABORT");
        expect(result.decision.flags)
          .toContain(
            "REVERSE_LEG_INSUFFICIENT_DEPTH"
          );
      }
    );

    test(
      "flags a complete round trip with no positive edge",
      async () => {
        const { client } =
          clientWith([
            {
              offers: [
                {
                  TakerPays:
                    "100000000",
                  TakerGets: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "200"
                  }
                }
              ]
            },
            {
              offers: [
                {
                  TakerPays: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "200"
                  },
                  TakerGets:
                    "99000000"
                }
              ]
            }
          ]);

        const result =
          await analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              quote: {
                asset: "TOK",
                issuer: ISSUER
              },
              amount: 100
            }
          );

        expect(result.decision.signal)
          .toBe("ABORT");
        expect(result.decision.flags)
          .toContain(
            "NO_POSITIVE_EDGE"
          );
      }
    );

    test(
      "flags a positive edge below the threshold",
      async () => {
        const { client } =
          clientWith([
            {
              offers: [
                {
                  TakerPays:
                    "100000000",
                  TakerGets: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "200"
                  }
                }
              ]
            },
            {
              offers: [
                {
                  TakerPays: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "200"
                  },
                  TakerGets:
                    "100040000"
                }
              ]
            }
          ]);

        const result =
          await analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              quote: {
                asset: "TOK",
                issuer: ISSUER
              },
              amount: 100
            }
          );

        expect(result.decision.signal)
          .toBe("REVIEW");
        expect(result.decision.flags)
          .toContain(
            "EDGE_BELOW_THRESHOLD"
          );
      }
    );

    test(
      "reviews a positive edge with elevated slippage",
      async () => {
        const { client } =
          clientWith([
            {
              offers: [
                {
                  TakerPays:
                    "100000000",
                  TakerGets: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "200"
                  }
                }
              ]
            },
            {
              offers: [
                {
                  TakerPays: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "100"
                  },
                  TakerGets:
                    "60000000"
                },
                {
                  TakerPays: {
                    currency: "TOK",
                    issuer: ISSUER,
                    value: "100"
                  },
                  TakerGets:
                    "41000000"
                }
              ]
            }
          ]);

        const result =
          await analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              quote: {
                asset: "TOK",
                issuer: ISSUER
              },
              amount: 100
            }
          );

        expect(
          result.opportunity.exists
        ).toBe(true);
        expect(result.decision.signal)
          .toBe("REVIEW");
        expect(result.decision.flags)
          .toContain(
            "ELEVATED_ROUND_TRIP_SLIPPAGE"
          );
        expect(
          result.opportunity
            .combined_slippage_pct
        ).toBeGreaterThan(1);
      }
    );

    test(
      "returns not applicable for NFT arbitrage",
      async () => {
        const { client, requests } =
          clientWith([]);

        const result =
          await analyzeXRPLArbitrageV3(
            client,
            {
              base: {
                nftoken_id: NFT_ID
              },
              quote: "XRP",
              amount: 1
            }
          );

        expect(result.applicable)
          .toBe(false);
        expect(result.decision.signal)
          .toBe(
            "NOT_APPLICABLE"
          );
        expect(requests)
          .toHaveLength(0);
      }
    );

    test(
      "rejects invalid pair requests",
      async () => {
        const { client } =
          clientWith([]);

        await expect(
          analyzeXRPLArbitrageV3(
            client,
            {
              quote: "XRP",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "base asset"
        );

        await expect(
          analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "quote asset"
        );

        await expect(
          analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              quote: "XRP",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "must differ"
        );

        await expect(
          analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              quote: {
                asset: "TOK",
                issuer: ISSUER
              },
              amount: 0
            }
          )
        ).rejects.toThrow(
          "positive"
        );
      }
    );

    test(
      "normalizes malformed offer arrays",
      async () => {
        const { client } =
          clientWith([
            {
              ledger_current_index:
                200,
              offers: null
            },
            {
              offers: "invalid"
            }
          ]);

        const result =
          await analyzeXRPLArbitrageV3(
            client,
            {
              base: "XRP",
              quote: {
                asset: "TOK",
                issuer: ISSUER
              },
              amount: 1
            }
          );

        expect(result.ledger_index)
          .toBe(200);
        expect(
          result.legs.forward
            ?.executableOffers
        ).toBe(0);
      }
    );
  }
);
