import {
  describe,
  expect,
  test
} from "bun:test";

import {
  combineRiskDimensions,
  riskLevel,
  scoreExecutionRisk,
  scoreIssuerRisk,
  scoreLiquidityRisk,
  scoreNetworkRisk
} from "../cloudpayx_xrpl_risk_math";

const simulation = (
  overrides: Record<string, any> = {}
) => ({
  output: 100,
  consumedInput: 50,
  executableOffers: 10,
  completeFill: true,
  bestRate: 2,
  averageExecutionRate: 2,
  slippagePct: 0,
  ...overrides
});

describe(
  "cloudpayX XRPL risk math",
  () => {
    test(
      "preserves risk levels",
      () => {
        expect(riskLevel(0)).toBe(
          "LOW"
        );
        expect(riskLevel(25)).toBe(
          "MODERATE"
        );
        expect(riskLevel(50)).toBe(
          "HIGH"
        );
        expect(riskLevel(80)).toBe(
          "CRITICAL"
        );
      }
    );

    test(
      "scores healthy network",
      () => {
        expect(
          scoreNetworkRisk(5, 1)
        ).toEqual({
          score: 0,
          flags: []
        });
      }
    );

    test(
      "scores delayed loaded network",
      () => {
        expect(
          scoreNetworkRisk(15, 3)
        ).toEqual({
          score: 35,
          flags: [
            "LEDGER_DELAY",
            "ELEVATED_NETWORK_LOAD"
          ]
        });
      }
    );

    test(
      "scores stale high-load network",
      () => {
        expect(
          scoreNetworkRisk(21, 5)
        ).toEqual({
          score: 75,
          flags: [
            "STALE_LEDGER",
            "HIGH_NETWORK_LOAD"
          ]
        });
      }
    );

    test(
      "scores issuer controls",
      () => {
        expect(
          scoreIssuerRisk({
            globalFreeze: true,
            requireAuthorization: true,
            clawbackEnabled: true,
            noFreeze: false
          })
        ).toEqual({
          score: 95,
          flags: [
            "GLOBAL_FREEZE_ENABLED",
            "AUTHORIZATION_REQUIRED",
            "CLAWBACK_ENABLED"
          ]
        });
      }
    );

    test(
      "scores liquidity conditions",
      () => {
        expect(
          scoreLiquidityRisk(
            simulation(),
            0
          ).score
        ).toBe(100);

        expect(
          scoreLiquidityRisk(
            simulation({
              completeFill: false
            }),
            10
          ).score
        ).toBe(90);

        expect(
          scoreLiquidityRisk(
            simulation({
              executableOffers: 2
            }),
            10
          ).score
        ).toBe(25);

        expect(
          scoreLiquidityRisk(
            simulation({
              executableOffers: 5
            }),
            10
          ).score
        ).toBe(10);

        expect(
          scoreLiquidityRisk(
            simulation(),
            10
          ).score
        ).toBe(0);
      }
    );

    test(
      "scores execution thresholds",
      () => {
        expect(
          scoreExecutionRisk(
            simulation({
              completeFill: false
            })
          ).score
        ).toBe(100);

        expect(
          scoreExecutionRisk(
            simulation({
              slippagePct: 11
            })
          ).score
        ).toBe(100);

        expect(
          scoreExecutionRisk(
            simulation({
              slippagePct: 4
            })
          ).score
        ).toBe(80);

        expect(
          scoreExecutionRisk(
            simulation({
              slippagePct: 2
            })
          ).score
        ).toBe(45);

        expect(
          scoreExecutionRisk(
            simulation({
              slippagePct: 0.5
            })
          ).score
        ).toBe(20);

        expect(
          scoreExecutionRisk(
            simulation()
          ).score
        ).toBe(0);
      }
    );

    test(
      "allows low composite risk",
      () => {
        const result =
          combineRiskDimensions({
            network: {
              score: 0,
              flags: []
            },
            asset: {
              score: 0,
              flags: []
            },
            liquidity: {
              score: 0,
              flags: []
            },
            execution: {
              score: 0,
              flags: []
            }
          });

        expect(result.score).toBe(0);
        expect(result.signal).toBe(
          "ALLOW"
        );
      }
    );

    test(
      "reviews moderate composite risk",
      () => {
        const result =
          combineRiskDimensions({
            network: {
              score: 35,
              flags: ["NETWORK"]
            },
            asset: {
              score: 20,
              flags: ["ASSET"]
            },
            liquidity: {
              score: 25,
              flags: ["LIQUIDITY"]
            },
            execution: {
              score: 45,
              flags: ["EXECUTION"]
            }
          });

        expect(result.score).toBe(33);
        expect(result.signal).toBe(
          "REVIEW"
        );
        expect(result.flags).toEqual([
          "NETWORK",
          "ASSET",
          "LIQUIDITY",
          "EXECUTION"
        ]);
      }
    );

    test(
      "critical conditions force abort",
      () => {
        const result =
          combineRiskDimensions({
            network: {
              score: 0,
              flags: []
            },
            asset: {
              score: 70,
              flags: [
                "GLOBAL_FREEZE"
              ]
            },
            liquidity: {
              score: 0,
              flags: []
            },
            execution: {
              score: 0,
              flags: []
            }
          });

        expect(result.score).toBe(80);
        expect(result.signal).toBe(
          "ABORT"
        );
      }
    );
  }
);
