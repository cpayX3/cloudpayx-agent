import {
  describe,
  expect,
  test
} from "bun:test";

import {
  analyzeXRPLRouteV3
} from "../cloudpayx_xrpl_route_v3";

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

const fromAsset = {
  asset: "USD",
  issuer: ISSUER
};

const toAsset = {
  asset: "EUR",
  issuer: ISSUER
};

function issuedAmount(
  currency: string,
  value: string
) {
  return {
    currency,
    issuer: ISSUER,
    value
  };
}

describe(
  "cloudpayX universal XRPL route V3",
  () => {
    test(
      "recommends the better direct route",
      async () => {
        const { client } =
          clientWith([
            {
              ledger_index: 100,
              offers: [
                {
                  TakerPays:
                    issuedAmount(
                      "USD",
                      "100"
                    ),
                  TakerGets:
                    issuedAmount(
                      "EUR",
                      "100"
                    )
                }
              ]
            },
            {
              offers: [
                {
                  TakerPays:
                    issuedAmount(
                      "USD",
                      "100"
                    ),
                  TakerGets:
                    "50000000"
                }
              ]
            },
            {
              offers: [
                {
                  TakerPays:
                    "50000000",
                  TakerGets:
                    issuedAmount(
                      "EUR",
                      "90"
                    )
                }
              ]
            }
          ]);

        const result =
          await analyzeXRPLRouteV3(
            client,
            {
              from: fromAsset,
              to: toAsset,
              amount: 100
            }
          );

        expect(
          result.recommended_route
            ?.type
        ).toBe("DIRECT");
        expect(result.decision.signal)
          .toBe("ALLOW");
        expect(
          result.routes_evaluated
        ).toHaveLength(2);
      }
    );

    test(
      "recommends a better XRP-bridged route",
      async () => {
        const { client } =
          clientWith([
            {
              offers: [
                {
                  TakerPays:
                    issuedAmount(
                      "USD",
                      "100"
                    ),
                  TakerGets:
                    issuedAmount(
                      "EUR",
                      "90"
                    )
                }
              ]
            },
            {
              offers: [
                {
                  TakerPays:
                    issuedAmount(
                      "USD",
                      "100"
                    ),
                  TakerGets:
                    "50000000"
                }
              ]
            },
            {
              offers: [
                {
                  TakerPays:
                    "50000000",
                  TakerGets:
                    issuedAmount(
                      "EUR",
                      "100"
                    )
                }
              ]
            }
          ]);

        const result =
          await analyzeXRPLRouteV3(
            client,
            {
              from: fromAsset,
              to: toAsset,
              amount: 100,
              objective:
                "best_execution"
            }
          );

        expect(
          result.recommended_route
            ?.type
        ).toBe(
          "XRP_BRIDGED"
        );
        expect(
          result.recommended_route
            ?.expected_output
        ).toBe(100);
      }
    );

    test(
      "evaluates only direct routing when XRP is one side",
      async () => {
        const { client, requests } =
          clientWith([
            {
              ledger_current_index:
                200,
              offers: [
                {
                  TakerPays:
                    "10000000",
                  TakerGets:
                    issuedAmount(
                      "EUR",
                      "10"
                    )
                }
              ]
            }
          ]);

        const result =
          await analyzeXRPLRouteV3(
            client,
            {
              from: "XRP",
              to: toAsset,
              amount: 10
            }
          );

        expect(
          result.routes_evaluated
        ).toHaveLength(1);
        expect(requests)
          .toHaveLength(1);
        expect(
          result.recommended_route
            ?.legs[0].ledger_index
        ).toBe(200);
      }
    );

    test(
      "reviews a complete route with elevated slippage",
      async () => {
        const { client } =
          clientWith([
            {
              offers: [
                {
                  TakerPays:
                    "50000000",
                  TakerGets:
                    issuedAmount(
                      "EUR",
                      "100"
                    )
                },
                {
                  TakerPays:
                    "50000000",
                  TakerGets:
                    issuedAmount(
                      "EUR",
                      "50"
                    )
                }
              ]
            }
          ]);

        const result =
          await analyzeXRPLRouteV3(
            client,
            {
              from: "XRP",
              to: toAsset,
              amount: 100
            }
          );

        expect(result.decision.signal)
          .toBe("REVIEW");
        expect(result.decision.flags)
          .toContain(
            "ELEVATED_ROUTE_SLIPPAGE"
          );
        expect(
          result.recommended_route
            ?.estimated_slippage_pct
        ).toBeGreaterThan(3);
      }
    );

    test(
      "returns not applicable for NFT routing",
      async () => {
        const { client, requests } =
          clientWith([]);

        const result =
          await analyzeXRPLRouteV3(
            client,
            {
              from: {
                nftoken_id: NFT_ID
              },
              to: "XRP",
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
      "aborts when no route can fill",
      async () => {
        const { client } =
          clientWith([
            {
              offers: null
            },
            {
              offers: []
            }
          ]);

        const result =
          await analyzeXRPLRouteV3(
            client,
            {
              from: fromAsset,
              to: toAsset,
              amount: 100
            }
          );

        expect(
          result.recommended_route
        ).toBeNull();
        expect(result.decision.signal)
          .toBe("ABORT");
        expect(result.decision.flags)
          .toContain(
            "DIRECT_ROUTE_INSUFFICIENT_DEPTH"
          );
        expect(result.decision.flags)
          .toContain(
            "XRP_BRIDGED_ROUTE_INSUFFICIENT_DEPTH"
          );
      }
    );

    test(
      "rejects invalid route requests",
      async () => {
        const { client } =
          clientWith([]);

        await expect(
          analyzeXRPLRouteV3(
            client,
            {
              to: "XRP",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "from asset"
        );

        await expect(
          analyzeXRPLRouteV3(
            client,
            {
              from: "XRP",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "to asset"
        );

        await expect(
          analyzeXRPLRouteV3(
            client,
            {
              from: "XRP",
              to: "XRP",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "must differ"
        );

        await expect(
          analyzeXRPLRouteV3(
            client,
            {
              from: "XRP",
              to: toAsset,
              amount: 0
            }
          )
        ).rejects.toThrow(
          "positive"
        );

        await expect(
          analyzeXRPLRouteV3(
            client,
            {
              from: "XRP",
              to: toAsset,
              amount: 1,
              objective: "cheapest"
            }
          )
        ).rejects.toThrow(
          "BEST_EXECUTION"
        );
      }
    );
  }
);
