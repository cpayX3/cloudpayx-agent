import {
  describe,
  expect,
  test
} from "bun:test";

import {
  assessXRPLRiskV3,
  observeXRPLAssetRisk
} from "../cloudpayx_xrpl_risk_service_v3";

import {
  resolveXRPLAsset
} from "../cloudpayx_xrpl_asset_resolver";

import type {
  XRPLRequestClient,
  XRPLAssetData
} from "../cloudpayx_xrpl_data_collector";

const ISSUER =
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

const MPT_ID =
  "A".repeat(48);

const NFT_ID =
  "B".repeat(64);

function mockClient(
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

const healthyNetwork = {
  info: {
    validated_ledger: {
      seq: 100,
      age: 2
    },
    load_factor: 1
  }
};

describe(
  "cloudpayX XRPL risk service V3",
  () => {
    test(
      "assesses arbitrary issued-currency trade risk",
      async () => {
        const { client, requests } =
          mockClient([
            healthyNetwork,
            {
              account_data: {
                Account: ISSUER
              },
              account_flags: {
                requireAuthorization:
                  true,
                globalFreeze: false,
                noFreeze: true,
                allowTrustLineClawback:
                  false
              }
            },
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
            }
          ]);

        const result =
          await assessXRPLRiskV3(
            client,
            {
              intent: "TRADE",
              from: "XRP",
              to: {
                asset: "TOK",
                issuer: ISSUER
              },
              amount: 100
            }
          );

        expect(result.success)
          .toBe(true);
        expect(result.service)
          .toBe(
            "cloudpayx_risk_check_v3"
          );
        expect(
          result.market_observation
            ?.simulation.completeFill
        ).toBe(true);
        expect(
          result.asset_observations[1]
        ).toMatchObject({
          score: 15,
          flags: [
            "AUTHORIZATION_REQUIRED"
          ]
        });
        expect(
          requests.at(-1)
        ).toMatchObject({
          command: "book_offers",
          ledger_index:
            "validated",
          limit: 200
        });
      }
    );

    test(
      "aborts an MPT transfer when transfers are disabled",
      async () => {
        const { client, requests } =
          mockClient([
            healthyNetwork,
            {
              node: {
                LedgerEntryType:
                  "MPTokenIssuance",
                Issuer: ISSUER,
                Flags: 0,
                OutstandingAmount:
                  "100"
              }
            }
          ]);

        const result =
          await assessXRPLRiskV3(
            client,
            {
              intent: "TRANSFER",
              from: {
                mpt_issuance_id:
                  MPT_ID
              },
              amount: 10
            }
          );

        expect(
          result.decision.signal
        ).toBe("ABORT");
        expect(
          result.decision.flags
        ).toContain(
          `MPT:${MPT_ID}:` +
          "MPT_TRANSFER_DISABLED"
        );
        expect(
          result.market_observation
        ).toBeNull();
        expect(
          requests.some(
            request =>
              request.command ===
              "book_offers"
          )
        ).toBe(false);
      }
    );

    test(
      "reports NFT trade risk as not applicable",
      async () => {
        const { client } =
          mockClient([
            healthyNetwork,
            {
              nft_id: NFT_ID,
              is_burned: false
            },
            {
              offers: []
            },
            {
              offers: []
            }
          ]);

        const result =
          await assessXRPLRiskV3(
            client,
            {
              intent: "TRADE",
              from: {
                nftoken_id: NFT_ID
              },
              to: "XRP",
              amount: 1
            }
          );

        expect(
          result.decision.signal
        ).toBe(
          "NOT_APPLICABLE"
        );
        expect(
          result.dimensions.liquidity
            .status
        ).toBe(
          "NOT_APPLICABLE"
        );
      }
    );

    test(
      "scores a burned NFToken as critical ownership risk",
      () => {
        const asset =
          resolveXRPLAsset({
            nftoken_id: NFT_ID
          });

        const data: XRPLAssetData = {
          kind: "NFT",
          asset,
          ledgerIndex:
            "validated",
          nft: {
            nft_id: NFT_ID,
            is_burned: true
          },
          buyOffers: [],
          sellOffers: []
        };

        expect(
          observeXRPLAssetRisk(
            data,
            "OWNERSHIP"
          )
        ).toEqual({
          assetKey:
            `NFT:${NFT_ID}`,
          score: 100,
          flags: [
            "NFTOKEN_BURNED"
          ]
        });
      }
    );

    test(
      "rejects invalid request semantics",
      async () => {
        const { client } =
          mockClient([]);

        await expect(
          assessXRPLRiskV3(
            client,
            {
              intent: "TRANSFER",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "from asset"
        );

        await expect(
          assessXRPLRiskV3(
            client,
            {
              intent: "UNKNOWN",
              from: "XRP",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "intent"
        );

        await expect(
          assessXRPLRiskV3(
            client,
            {
              intent: "TRADE",
              from: "XRP",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "to asset"
        );

        await expect(
          assessXRPLRiskV3(
            client,
            {
              intent: "TRANSFER",
              from: "XRP",
              amount: 0
            }
          )
        ).rejects.toThrow(
          "amount"
        );

        await expect(
          assessXRPLRiskV3(
            client,
            {
              intent: "TRADE",
              from: "XRP",
              to: "XRP",
              amount: 1
            }
          )
        ).rejects.toThrow(
          "must differ"
        );
      }
    );

    test(
      "uses conservative network defaults when telemetry is malformed",
      async () => {
        const { client } =
          mockClient([
            {
              info: {
                validated_ledger: {
                  seq: "unknown",
                  age: "unknown"
                },
                load_factor:
                  "unknown"
              }
            }
          ]);

        const result =
          await assessXRPLRiskV3(
            client,
            {
              intent: "TRANSFER",
              from: "XRP",
              amount: 1
            }
          );

        expect(result.ledger)
          .toEqual({
            index: null,
            age_seconds: 999,
            load_factor: 999
          });
        expect(
          result.decision.signal
        ).toBe("REVIEW");
      }
    );

    test(
      "observes a locked and clawback-enabled MPT",
      () => {
        const asset =
          resolveXRPLAsset({
            mpt_issuance_id:
              MPT_ID
          });

        const data:
          XRPLAssetData = {
            kind: "MPT",
            asset,
            ledgerIndex:
              "validated",
            issuance: {},
            capabilities: {
              locked: true,
              canLock: true,
              requireAuthorization:
                true,
              canEscrow: false,
              canTrade: false,
              canTransfer: true,
              canClawback: true,
              confidentialBalances:
                false
            },
            holder: null
          };

        const result =
          observeXRPLAssetRisk(
            data,
            "TRADE"
          );

        expect(result.score)
          .toBe(100);
        expect(result.flags)
          .toContain("MPT_LOCKED");
        expect(result.flags)
          .toContain(
            "MPT_TRADING_DISABLED"
          );
      }
    );
  }
);
