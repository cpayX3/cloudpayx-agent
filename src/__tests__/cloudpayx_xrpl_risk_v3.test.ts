import {
  describe,
  expect,
  test
} from "bun:test";

import {
  resolveXRPLAsset
} from "../cloudpayx_xrpl_asset_resolver";

import {
  assessUniversalRisk
} from "../cloudpayx_xrpl_risk_v3";

const ISSUER =
  "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";

const XRP =
  resolveXRPLAsset({
    asset: "XRP"
  });

const TOKEN =
  resolveXRPLAsset({
    asset: "FUZZY",
    issuer: ISSUER
  });

const simulation = {
  output: 100,
  consumedInput: 50,
  executableOffers: 10,
  completeFill: true,
  bestRate: 2,
  averageExecutionRate: 2,
  slippagePct: 0
};

describe(
  "cloudpayX universal risk V3",
  () => {
    test(
      "allows an arbitrary issued-token trade",
      () => {
        const result =
          assessUniversalRisk({
            intent: "TRADE",
            from: XRP,
            to: TOKEN,
            amount: 50,
            network: {
              ledgerAgeSeconds: 5,
              loadFactor: 1
            },
            assetRisks: [],
            market: {
              simulation,
              visibleOfferCount: 20
            }
          });

        expect(
          result.decision.signal
        ).toBe("ALLOW");

        expect(result.risk.score).toBe(
          0
        );
      }
    );

    test(
      "preserves composite V2 scoring",
      () => {
        const result =
          assessUniversalRisk({
            intent: "TRADE",
            from: XRP,
            to: TOKEN,
            amount: 50,
            network: {
              ledgerAgeSeconds: 15,
              loadFactor: 3
            },
            assetRisks: [{
              assetKey: TOKEN.key,
              score: 20,
              flags: ["ASSET"]
            }],
            market: {
              simulation: {
                ...simulation,
                executableOffers: 2,
                slippagePct: 2
              },
              visibleOfferCount: 10
            }
          });

        expect(result.risk.score).toBe(
          33
        );

        expect(
          result.decision.signal
        ).toBe("REVIEW");
      }
    );

    test(
      "aborts when market data is missing",
      () => {
        const result =
          assessUniversalRisk({
            intent: "TRADE",
            from: XRP,
            to: TOKEN,
            amount: 50,
            network: {
              ledgerAgeSeconds: 5,
              loadFactor: 1
            },
            assetRisks: []
          });

        expect(
          result.decision.signal
        ).toBe("ABORT");

        expect(result.risk.score).toBe(
          80
        );
      }
    );

    test(
      "returns not applicable for NFT trading",
      () => {
        const nft =
          resolveXRPLAsset({
            asset_type: "NFT",
            nftoken_id:
              "A".repeat(64)
          });

        const result =
          assessUniversalRisk({
            intent: "TRADE",
            from: XRP,
            to: nft,
            amount: 10,
            network: {
              ledgerAgeSeconds: 5,
              loadFactor: 1
            },
            assetRisks: []
          });

        expect(
          result.decision.signal
        ).toBe(
          "NOT_APPLICABLE"
        );

        expect(
          result.dimensions
            .liquidity.status
        ).toBe(
          "NOT_APPLICABLE"
        );
      }
    );

    test(
      "assesses NFT ownership risk",
      () => {
        const nft =
          resolveXRPLAsset({
            asset_type: "NFT",
            nftoken_id:
              "B".repeat(64)
          });

        const result =
          assessUniversalRisk({
            intent: "OWNERSHIP",
            from: nft,
            amount: 1,
            network: {
              ledgerAgeSeconds: 5,
              loadFactor: 1
            },
            assetRisks: [{
              assetKey: nft.key,
              score: 30,
              flags: [
                "TRANSFER_FEE"
              ]
            }]
          });

        expect(
          result.decision.signal
        ).toBe("REVIEW");

        expect(result.risk.score).toBe(
          30
        );
      }
    );

    test(
      "assesses MPT transfer risk",
      () => {
        const mpt =
          resolveXRPLAsset({
            asset_type: "MPT",
            mpt_issuance_id:
              "C".repeat(48)
          });

        const result =
          assessUniversalRisk({
            intent: "TRANSFER",
            from: mpt,
            amount: 100,
            network: {
              ledgerAgeSeconds: 5,
              loadFactor: 1
            },
            assetRisks: []
          });

        expect(
          result.decision.signal
        ).toBe("ALLOW");

        expect(
          result.dimensions
            .execution.status
        ).toBe(
          "NOT_APPLICABLE"
        );
      }
    );

    test(
      "rejects invalid amounts",
      () => {
        expect(() =>
          assessUniversalRisk({
            intent: "TRANSFER",
            from: XRP,
            amount: 0,
            network: {
              ledgerAgeSeconds: 5,
              loadFactor: 1
            },
            assetRisks: []
          })
        ).toThrow(
          "Risk amount must be positive."
        );
      }
    );

    test(
      "critical asset risk aborts transfer",
      () => {
        const result =
          assessUniversalRisk({
            intent: "TRANSFER",
            from: TOKEN,
            amount: 50,
            network: {
              ledgerAgeSeconds: 5,
              loadFactor: 1
            },
            assetRisks: [{
              assetKey: TOKEN.key,
              score: 95,
              flags: [
                "GLOBAL_FREEZE"
              ]
            }]
          });

        expect(
          result.decision.signal
        ).toBe("ABORT");

        expect(result.risk.level).toBe(
          "CRITICAL"
        );
      }
    );
  }
);
