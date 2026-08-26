import {
  describe,
  expect,
  test
} from "bun:test";

import {
  simulateXRPLBook,
  xrplAmountToNumber
} from "../cloudpayx_xrpl_market_math";

describe(
  "cloudpayX XRPL market math",
  () => {
    test(
      "converts XRP drops",
      () => {
        expect(
          xrplAmountToNumber(
            "50000000"
          )
        ).toBe(50);
      }
    );

    test(
      "converts issued amounts",
      () => {
        expect(
          xrplAmountToNumber({
            currency: "USD",
            issuer: "rIssuer",
            value: "125.5"
          })
        ).toBe(125.5);
      }
    );

    test(
      "simulates a complete fill",
      () => {
        const result =
          simulateXRPLBook(
            [
              {
                TakerGets: {
                  value: "100"
                },
                TakerPays:
                  "50000000"
              }
            ],
            50
          );

        expect(
          result.completeFill
        ).toBe(true);

        expect(result.output).toBe(
          100
        );

        expect(
          result.slippagePct
        ).toBe(0);
      }
    );

    test(
      "detects incomplete depth",
      () => {
        const result =
          simulateXRPLBook(
            [
              {
                TakerGets: {
                  value: "20"
                },
                TakerPays:
                  "10000000"
              }
            ],
            50
          );

        expect(
          result.completeFill
        ).toBe(false);

        expect(
          result.consumedInput
        ).toBe(10);

        expect(
          result.slippagePct
        ).toBe(100);
      }
    );

    test(
      "calculates multi-level slippage",
      () => {
        const result =
          simulateXRPLBook(
            [
              {
                TakerGets: {
                  value: "50"
                },
                TakerPays:
                  "25000000"
              },
              {
                TakerGets: {
                  value: "25"
                },
                TakerPays:
                  "25000000"
              }
            ],
            50
          );

        expect(result.output).toBe(
          75
        );

        expect(
          result.bestRate
        ).toBe(2);

        expect(
          result.averageExecutionRate
        ).toBe(1.5);

        expect(
          result.slippagePct
        ).toBe(25);
      }
    );

    test(
      "uses funded amounts first",
      () => {
        const result =
          simulateXRPLBook(
            [
              {
                TakerGets: {
                  value: "1000"
                },
                TakerPays:
                  "500000000",
                taker_gets_funded: {
                  value: "20"
                },
                taker_pays_funded:
                  "10000000"
              }
            ],
            10
          );

        expect(result.output).toBe(
          20
        );

        expect(
          result.consumedInput
        ).toBe(10);
      }
    );

    test(
      "returns zero for malformed amounts",
      () => {
        expect(
          xrplAmountToNumber(
            "not-a-number"
          )
        ).toBe(0);

        expect(
          xrplAmountToNumber({
            value: "invalid"
          })
        ).toBe(0);

        expect(
          xrplAmountToNumber(null)
        ).toBe(0);
      }
    );

    test(
      "skips malformed offers",
      () => {
        const result =
          simulateXRPLBook(
            [
              {
                TakerGets: {
                  value: "invalid"
                },
                TakerPays:
                  "10000000"
              },
              {
                TakerGets: {
                  value: "20"
                },
                TakerPays:
                  "10000000"
              }
            ],
            10
          );

        expect(
          result.executableOffers
        ).toBe(1);

        expect(result.output).toBe(
          20
        );
      }
    );

    test(
      "rejects invalid requested input",
      () => {
        expect(() =>
          simulateXRPLBook([], 0)
        ).toThrow(
          "requestedInput must be positive"
        );
      }
    );
  }
);
