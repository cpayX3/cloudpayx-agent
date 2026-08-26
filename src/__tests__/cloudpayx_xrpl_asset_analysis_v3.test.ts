import {
  describe,
  expect,
  test
} from "bun:test";

import {
  analyzeXRPLAssetV3
} from "../cloudpayx_xrpl_asset_analysis_v3";

import type {
  XRPLRequestClient
} from "../cloudpayx_xrpl_data_collector";

const ISSUER =
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

const HOLDER =
  "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn";

const MPT_ID =
  "A".repeat(48);

const NFT_ID =
  "B".repeat(64);

function clientWith(
  results: Record<string, any>[]
): XRPLRequestClient {
  return {
    async request() {
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
  };
}

describe(
  "cloudpayX XRPL asset analysis V3",
  () => {
    test(
      "analyzes native XRP without RPC data",
      async () => {
        const result =
          await analyzeXRPLAssetV3(
            clientWith([]),
            {
              asset: "XRP"
            }
          );

        expect(result).toMatchObject({
          success: true,
          service:
            "cloudpayx_asset_analysis_v3",
          version: "3.0",
          network: "xrpl:0",
          ledger_index_requested:
            "validated",
          analysis: {
            type: "NATIVE_XRP",
            native: true
          }
        });
      }
    );

    test(
      "analyzes an arbitrary issued currency",
      async () => {
        const result =
          await analyzeXRPLAssetV3(
            clientWith([
              {
                account_data: {
                  Account: ISSUER,
                  Flags: 0
                }
              }
            ]),
            {
              asset: "TOKEN",
              issuer: ISSUER,
              ledger_index: "123"
            }
          );

        expect(
          result.ledger_index_requested
        ).toBe(123);

        expect(result.analysis)
          .toEqual({
            type:
              "ISSUED_CURRENCY",
            issuer: {
              Account: ISSUER,
              Flags: 0
            }
          });
      }
    );

    test(
      "analyzes an MPT and holder",
      async () => {
        const result =
          await analyzeXRPLAssetV3(
            clientWith([
              {
                node: {
                  LedgerEntryType:
                    "MPTokenIssuance",
                  Issuer: ISSUER,
                  Flags: 0x30,
                  OutstandingAmount:
                    "1000"
                }
              },
              {
                node: {
                  LedgerEntryType:
                    "MPToken",
                  MPTokenIssuanceID:
                    MPT_ID,
                  MPTAmount: "50",
                  Flags: 0
                }
              }
            ]),
            {
              asset_type: "MPT",
              mpt_issuance_id:
                MPT_ID,
              holder: HOLDER,
              ledger_index:
                "closed"
            }
          );

        expect(result.analysis)
          .toMatchObject({
            type: "MPT",
            dynamic_capabilities: {
              canTrade: true,
              canTransfer: true
            },
            holder: {
              MPTAmount: "50"
            }
          });
      }
    );

    test(
      "analyzes an NFT and its offers",
      async () => {
        const result =
          await analyzeXRPLAssetV3(
            clientWith([
              {
                nft_id: NFT_ID,
                owner: HOLDER,
                issuer: ISSUER
              },
              {
                offers: [
                  {
                    amount: "10"
                  }
                ]
              },
              {
                offers: [
                  {
                    amount: "20"
                  },
                  {
                    amount: "30"
                  }
                ]
              }
            ]),
            {
              nftoken_id: NFT_ID,
              offer_limit: 50
            }
          );

        expect(result.analysis)
          .toMatchObject({
            type: "NFT",
            market: {
              buy_offer_count: 1,
              sell_offer_count: 2
            }
          });
      }
    );

    test(
      "accepts a positive numeric ledger index",
      async () => {
        const result =
          await analyzeXRPLAssetV3(
            clientWith([]),
            {
              asset: "XRP",
              ledger_index: 456
            }
          );

        expect(
          result.ledger_index_requested
        ).toBe(456);
      }
    );

    test(
      "rejects malformed ledger indexes",
      async () => {
        await expect(
          analyzeXRPLAssetV3(
            clientWith([]),
            {
              asset: "XRP",
              ledger_index: -1
            }
          )
        ).rejects.toThrow(
          "ledger_index"
        );

        await expect(
          analyzeXRPLAssetV3(
            clientWith([]),
            {
              asset: "XRP",
              ledger_index:
                "future"
            }
          )
        ).rejects.toThrow(
          "ledger_index"
        );
      }
    );

    test(
      "rejects malformed holder addresses",
      async () => {
        await expect(
          analyzeXRPLAssetV3(
            clientWith([]),
            {
              mpt_issuance_id:
                MPT_ID,
              holder: "invalid"
            }
          )
        ).rejects.toThrow(
          "holder"
        );
      }
    );

    test(
      "rejects holder on non-MPT assets",
      async () => {
        await expect(
          analyzeXRPLAssetV3(
            clientWith([]),
            {
              asset: "XRP",
              holder: HOLDER
            }
          )
        ).rejects.toThrow(
          "only for MPT"
        );
      }
    );

    test(
      "rejects malformed NFT offer limits",
      async () => {
        await expect(
          analyzeXRPLAssetV3(
            clientWith([]),
            {
              nftoken_id: NFT_ID,
              offer_limit: 20
            }
          )
        ).rejects.toThrow(
          "offer_limit"
        );
      }
    );

    test(
      "rejects offer limits on non-NFT assets",
      async () => {
        await expect(
          analyzeXRPLAssetV3(
            clientWith([]),
            {
              asset: "XRP",
              offer_limit: 50
            }
          )
        ).rejects.toThrow(
          "only for NFT"
        );
      }
    );
  }
);
