import {
  describe,
  expect,
  test
} from "bun:test";

import {
  resolveXRPLAsset
} from "../cloudpayx_xrpl_asset_resolver";

import {
  collectXRPLAssetData,
  decodeMPTCapabilities,
  type XRPLRequestClient
} from "../cloudpayx_xrpl_data_collector";

const ISSUER =
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

const HOLDER =
  "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn";

const MPT_ID =
  "A".repeat(48);

const NFT_ID =
  "B".repeat(64);

type MockStep =
  | {
      result: Record<string, any>;
    }
  | Error
  | string;

function createMockClient(
  steps: MockStep[]
): {
  client: XRPLRequestClient;
  requests: Record<string, unknown>[];
} {
  const requests:
    Record<string, unknown>[] = [];

  const client: XRPLRequestClient = {
    async request(request) {
      requests.push(request);

      const step = steps.shift();

      if (step === undefined) {
        throw new Error(
          "Unexpected XRPL request."
        );
      }

      if (
        step instanceof Error ||
        typeof step === "string"
      ) {
        throw step;
      }

      return step;
    }
  };

  return {
    client,
    requests
  };
}

describe(
  "cloudpayX universal XRPL data collector",
  () => {
    test(
      "returns native XRP without an RPC request",
      async () => {
        const { client, requests } =
          createMockClient([]);

        const asset =
          resolveXRPLAsset({
            asset: "XRP"
          });

        const result =
          await collectXRPLAssetData(
            client,
            asset
          );

        expect(result.kind).toBe("XRP");
        expect(result.ledgerIndex)
          .toBe("validated");
        expect(requests).toHaveLength(0);
      }
    );

    test(
      "collects an arbitrary issued-currency issuer",
      async () => {
        const accountData = {
          Account: ISSUER,
          Balance: "50000000",
          Flags: 0
        };

        const { client, requests } =
          createMockClient([
            {
              result: {
                account_data: accountData
              }
            }
          ]);

        const asset =
          resolveXRPLAsset({
            asset: "TOKEN",
            issuer: ISSUER
          });

        const result =
          await collectXRPLAssetData(
            client,
            asset,
            {
              ledgerIndex: 100
            }
          );

        expect(result.kind)
          .toBe("ISSUED_CURRENCY");

        if (
          result.kind !==
          "ISSUED_CURRENCY"
        ) {
          throw new Error(
            "Unexpected result kind."
          );
        }

        expect(result.issuer)
          .toEqual(accountData);

        expect(requests).toEqual([
          {
            command: "account_info",
            account: ISSUER,
            strict: true,
            ledger_index: 100
          }
        ]);
      }
    );

    test(
      "decodes all supported MPT flags",
      () => {
        expect(
          decodeMPTCapabilities(0xff)
        ).toEqual({
          locked: true,
          canLock: true,
          requireAuthorization: true,
          canEscrow: true,
          canTrade: true,
          canTransfer: true,
          canClawback: true,
          confidentialBalances: true
        });

        expect(
          decodeMPTCapabilities(
            Number.NaN
          )
        ).toEqual({
          locked: false,
          canLock: false,
          requireAuthorization: false,
          canEscrow: false,
          canTrade: false,
          canTransfer: false,
          canClawback: false,
          confidentialBalances: false
        });
      }
    );

    test(
      "collects an MPT issuance and holder",
      async () => {
        const issuance = {
          LedgerEntryType:
            "MPTokenIssuance",
          Issuer: ISSUER,
          Flags: 0x34,
          OutstandingAmount: "5000",
          AssetScale: 2
        };

        const holder = {
          LedgerEntryType: "MPToken",
          MPTokenIssuanceID: MPT_ID,
          MPTAmount: "1250",
          Flags: 0
        };

        const { client, requests } =
          createMockClient([
            {
              result: {
                node: issuance
              }
            },
            {
              result: {
                node: holder
              }
            }
          ]);

        const asset =
          resolveXRPLAsset({
            asset_type: "MPT",
            mpt_issuance_id: MPT_ID
          });

        const result =
          await collectXRPLAssetData(
            client,
            asset,
            {
              holder: HOLDER,
              ledgerIndex: "closed"
            }
          );

        expect(result.kind).toBe("MPT");

        if (result.kind !== "MPT") {
          throw new Error(
            "Unexpected result kind."
          );
        }

        expect(result.issuance)
          .toEqual(issuance);
        expect(result.holder)
          .toEqual(holder);
        expect(result.capabilities)
          .toEqual({
            locked: false,
            canLock: false,
            requireAuthorization: true,
            canEscrow: false,
            canTrade: true,
            canTransfer: true,
            canClawback: false,
            confidentialBalances: false
          });

        expect(requests).toEqual([
          {
            command: "ledger_entry",
            mpt_issuance: MPT_ID,
            binary: false,
            ledger_index: "closed"
          },
          {
            command: "ledger_entry",
            mptoken: {
              mpt_issuance_id: MPT_ID,
              account: HOLDER
            },
            binary: false,
            ledger_index: "closed"
          }
        ]);
      }
    );

    test(
      "does not request an MPT holder when omitted",
      async () => {
        const { client, requests } =
          createMockClient([
            {
              result: {
                node: {
                  LedgerEntryType:
                    "MPTokenIssuance",
                  Flags: 0,
                  Issuer: ISSUER,
                  OutstandingAmount: "0"
                }
              }
            }
          ]);

        const asset =
          resolveXRPLAsset({
            mpt_issuance_id: MPT_ID
          });

        const result =
          await collectXRPLAssetData(
            client,
            asset
          );

        expect(result.kind).toBe("MPT");

        if (result.kind === "MPT") {
          expect(result.holder).toBeNull();
        }

        expect(requests).toHaveLength(1);
      }
    );

    test(
      "rejects an invalid MPT issuance response",
      async () => {
        const { client } =
          createMockClient([
            {
              result: {
                node: {
                  LedgerEntryType:
                    "AccountRoot"
                }
              }
            }
          ]);

        const asset =
          resolveXRPLAsset({
            mpt_issuance_id: MPT_ID
          });

        expect(
          collectXRPLAssetData(
            client,
            asset
          )
        ).rejects.toThrow(
          "invalid MPT issuance"
        );
      }
    );

    test(
      "rejects an invalid MPT holder response",
      async () => {
        const { client } =
          createMockClient([
            {
              result: {
                node: {
                  LedgerEntryType:
                    "MPTokenIssuance",
                  Flags: 0
                }
              }
            },
            {
              result: {
                node: null
              }
            }
          ]);

        const asset =
          resolveXRPLAsset({
            mpt_issuance_id: MPT_ID
          });

        expect(
          collectXRPLAssetData(
            client,
            asset,
            {
              holder: HOLDER
            }
          )
        ).rejects.toThrow(
          "invalid MPT holder"
        );
      }
    );

    test(
      "collects NFToken information and offers",
      async () => {
        const nft = {
          nft_id: NFT_ID,
          ledger_index: 200,
          owner: HOLDER,
          is_burned: false,
          flags: 0,
          transfer_fee: 500,
          issuer: ISSUER,
          nft_taxon: 1,
          nft_serial: 2,
          uri: "68747470733A2F2F6578616D706C652E636F6D"
        };

        const buyOffer = {
          amount: "1000000",
          flags: 0,
          nft_offer_index:
            "C".repeat(64),
          owner: ISSUER
        };

        const sellOffer = {
          amount: "2000000",
          flags: 1,
          nft_offer_index:
            "D".repeat(64),
          owner: HOLDER
        };

        const { client, requests } =
          createMockClient([
            {
              result: nft
            },
            {
              result: {
                offers: [buyOffer]
              }
            },
            {
              result: {
                offers: [sellOffer]
              }
            }
          ]);

        const asset =
          resolveXRPLAsset({
            nftoken_id: NFT_ID
          });

        const result =
          await collectXRPLAssetData(
            client,
            asset,
            {
              offerLimit: 50
            }
          );

        expect(result.kind).toBe("NFT");

        if (result.kind !== "NFT") {
          throw new Error(
            "Unexpected result kind."
          );
        }

        expect(result.nft).toEqual(nft);
        expect(result.buyOffers)
          .toEqual([buyOffer]);
        expect(result.sellOffers)
          .toEqual([sellOffer]);

        expect(requests).toEqual([
          {
            command: "nft_info",
            nft_id: NFT_ID,
            ledger_index: "validated"
          },
          {
            command: "nft_buy_offers",
            nft_id: NFT_ID,
            limit: 50,
            ledger_index: "validated"
          },
          {
            command: "nft_sell_offers",
            nft_id: NFT_ID,
            limit: 50,
            ledger_index: "validated"
          }
        ]);
      }
    );

    test(
      "treats missing NFT offer directories as empty",
      async () => {
        const missingOffers =
          Object.assign(
            new Error("No offers"),
            {
              data: {
                error: "objectNotFound"
              }
            }
          );

        const { client } =
          createMockClient([
            {
              result: {
                nft_id: NFT_ID
              }
            },
            missingOffers,
            missingOffers
          ]);

        const asset =
          resolveXRPLAsset({
            nftoken_id: NFT_ID
          });

        const result =
          await collectXRPLAssetData(
            client,
            asset
          );

        expect(result.kind).toBe("NFT");

        if (result.kind === "NFT") {
          expect(result.buyOffers)
            .toEqual([]);
          expect(result.sellOffers)
            .toEqual([]);
        }
      }
    );

    test(
      "normalizes malformed NFT offer arrays to empty",
      async () => {
        const { client } =
          createMockClient([
            {
              result: {
                nft_id: NFT_ID
              }
            },
            {
              result: {
                offers: null
              }
            },
            {
              result: {}
            }
          ]);

        const asset =
          resolveXRPLAsset({
            nftoken_id: NFT_ID
          });

        const result =
          await collectXRPLAssetData(
            client,
            asset
          );

        if (result.kind !== "NFT") {
          throw new Error(
            "Unexpected result kind."
          );
        }

        expect(result.buyOffers)
          .toEqual([]);
        expect(result.sellOffers)
          .toEqual([]);
      }
    );

    test(
      "rejects an invalid NFT response",
      async () => {
        const { client } =
          createMockClient([
            {
              result: {
                nft_id: "WRONG"
              }
            }
          ]);

        const asset =
          resolveXRPLAsset({
            nftoken_id: NFT_ID
          });

        expect(
          collectXRPLAssetData(
            client,
            asset
          )
        ).rejects.toThrow(
          "invalid NFToken"
        );
      }
    );

    test(
      "rejects an invalid NFT offer limit",
      async () => {
        const { client } =
          createMockClient([
            {
              result: {
                nft_id: NFT_ID
              }
            }
          ]);

        const asset =
          resolveXRPLAsset({
            nftoken_id: NFT_ID
          });

        expect(
          collectXRPLAssetData(
            client,
            asset,
            {
              offerLimit: 10
            }
          )
        ).rejects.toThrow(
          "between 50 and 500"
        );
      }
    );

    test(
      "does not hide unexpected NFT RPC failures",
      async () => {
        const failure =
          Object.assign(
            new Error("XRPL unavailable"),
            {
              code: "networkError"
            }
          );

        const { client } =
          createMockClient([
            {
              result: {
                nft_id: NFT_ID
              }
            },
            failure
          ]);

        const asset =
          resolveXRPLAsset({
            nftoken_id: NFT_ID
          });

        expect(
          collectXRPLAssetData(
            client,
            asset
          )
        ).rejects.toThrow(
          "XRPL unavailable"
        );
      }
    );

    test(
      "propagates primitive RPC failures",
      async () => {
        const { client } =
          createMockClient([
            {
              result: {
                nft_id: NFT_ID
              }
            },
            "offline"
          ]);

        const asset =
          resolveXRPLAsset({
            nftoken_id: NFT_ID
          });

        try {
          await collectXRPLAssetData(
            client,
            asset
          );

          throw new Error(
            "Expected collection to fail."
          );
        } catch (error) {
          expect(error).toBe("offline");
        }
      }
    );
  }
);
