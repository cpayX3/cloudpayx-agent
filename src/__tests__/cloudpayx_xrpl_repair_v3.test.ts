import {
  describe,
  expect,
  test
} from "bun:test";

import {
  repairXRPLTransactionV3
} from "../cloudpayx_xrpl_repair_v3";

describe(
  "cloudpayX XRPL repair V3",
  () => {
    test(
      "requires an engine result",
      () => {
        expect(
          () =>
            repairXRPLTransactionV3({})
        ).toThrow(
          "engine_result is required."
        );
      }
    );

    test(
      "allows validated success",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "tesSUCCESS",
            transaction_type:
              "Payment",
            validated: true
          });

        expect(
          result.decision.signal
        ).toBe("ALLOW");

        expect(
          result.input
            .transaction_family
        ).toBe("PAYMENT");
      }
    );

    test(
      "does not allow provisional success",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "tesSUCCESS",
            transaction_type:
              "OfferCreate"
          });

        expect(
          result.decision.signal
        ).toBe("REVIEW");

        expect(
          result.decision.flags
        ).toContain(
          "RESULT_FINALITY_UNCONFIRMED"
        );
      }
    );

    test(
      "requires a trust line for tecNO_LINE",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "tecNO_LINE",
            transaction_type:
              "Payment",
            validated: true
          });

        expect(
          result.classification.category
        ).toBe(
          "TRUST_LINE_REQUIRED"
        );

        expect(
          result.repair
            .retry_unchanged
        ).toBe(false);
      }
    );

    test(
      "classifies AMM funding failure",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "tecAMM_UNFUNDED",
            transaction_type:
              "AMMCreate",
            validated: true
          });

        expect(
          result.input
            .transaction_family
        ).toBe("AMM");

        expect(
          result.decision.signal
        ).toBe("ABORT");
      }
    );

    test(
      "classifies NFT transfer restrictions",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "tefNFTOKEN_IS_NOT_TRANSFERABLE",
            transaction_type:
              "NFTokenAcceptOffer",
            validated: true
          });

        expect(
          result.classification.category
        ).toBe(
          "NFT_NOT_TRANSFERABLE"
        );

        expect(
          result.input
            .transaction_family
        ).toBe("NFT");
      }
    );

    test(
      "classifies malformed issued currency",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "temBAD_ISSUER",
            transaction_type:
              "TrustSet",
            validated: true
          });

        expect(
          result.repair
            .requires_resign
        ).toBe(true);

        expect(
          result.input
            .transaction_family
        ).toBe("TRUST_LINE");
      }
    );

    test(
      "classifies confidential MPT proof failure",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "tecBAD_PROOF",
            transaction_type:
              "MPTokenIssuanceSet",
            validated: true
          });

        expect(
          result.classification.category
        ).toBe(
          "INVALID_CONFIDENTIAL_MPT_PROOF"
        );

        expect(
          result.input
            .transaction_family
        ).toBe("MPT");
      }
    );

    test(
      "treats unknown tec result according to finality",
      () => {
        const provisional =
          repairXRPLTransactionV3({
            engine_result:
              "tecSOME_FUTURE_CODE",
            transaction_type:
              "Payment"
          });

        const validated =
          repairXRPLTransactionV3({
            engine_result:
              "tecSOME_FUTURE_CODE",
            transaction_type:
              "Payment",
            validated: true
          });

        expect(
          provisional.repair
            .requires_rebuild
        ).toBe(false);

        expect(
          validated.repair
            .requires_rebuild
        ).toBe(true);
      }
    );

    test(
      "recognizes local server failures",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "telCAN_NOT_QUEUE",
            transaction_type:
              "OfferCreate"
          });

        expect(
          result.classification.category
        ).toBe(
          "LOCAL_SERVER_REJECTION"
        );

        expect(
          result.repair
            .safe_to_retry
        ).toBe(true);
      }
    );

    test(
      "classifies every supported transaction family",
      () => {
        const cases = [
          ["CheckCash", "CHECK"],
          ["EscrowFinish", "ESCROW"],
          [
            "PaymentChannelClaim",
            "PAYMENT_CHANNEL"
          ],
          [
            "DepositPreauth",
            "DEPOSIT_PREAUTH"
          ],
          [
            "SignerListSet",
            "SIGNER_LIST"
          ],
          ["TicketCreate", "TICKET"],
          ["Clawback", "CLAWBACK"],
          [
            "AccountSet",
            "ACCOUNT_CONFIGURATION"
          ],
          ["Batch", "OTHER"]
        ];

        for (
          const [
            transactionType,
            expectedFamily
          ] of cases
        ) {
          const result =
            repairXRPLTransactionV3({
              engine_result:
                "tesSUCCESS",
              transaction_type:
                transactionType,
              validated: true
            });

          expect(
            result.input
              .transaction_family
          ).toBe(expectedFamily);
        }

        const unknown =
          repairXRPLTransactionV3({
            engine_result:
              "tesSUCCESS",
            validated: true
          });

        expect(
          unknown.input
            .transaction_family
        ).toBe("UNKNOWN");

        expect(
          unknown.decision.flags
        ).not.toContain(
          "UNKNOWN_TRANSACTION"
        );
      }
    );

    test(
      "covers generic XRPL result families",
      () => {
        const cases = [
          {
            code: "tesFUTURE_RESULT",
            category: "SUCCESS",
            signal: "ALLOW"
          },
          {
            code: "tefFUTURE_RESULT",
            category:
              "FINAL_TRANSACTION_FAILURE",
            signal: "ABORT"
          },
          {
            code: "temFUTURE_RESULT",
            category:
              "MALFORMED_TRANSACTION",
            signal: "ABORT"
          },
          {
            code: "terFUTURE_RESULT",
            category:
              "RETRYABLE_PROVISIONAL_RESULT",
            signal: "REVIEW"
          },
          {
            code: "telFUTURE_RESULT",
            category:
              "LOCAL_SERVER_REJECTION",
            signal: "REVIEW"
          },
          {
            code: "xyzFUTURE_RESULT",
            category:
              "UNCLASSIFIED_XRPL_RESULT",
            signal: "REVIEW"
          }
        ] as const;

        for (const item of cases) {
          const result =
            repairXRPLTransactionV3({
              engine_result:
                item.code,
              transaction_type:
                "Payment",
              validated: true
            });

          expect(
            result.classification.category
          ).toBe(item.category);

          expect(
            result.decision.signal
          ).toBe(item.signal);

          expect(
            result.classification
              .specialized_rule
          ).toBe(false);
        }
      }
    );

    test(
      "covers provisional generic tes result",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "tesFUTURE_RESULT",
            transaction_type:
              "Payment"
          });

        expect(
          result.decision.signal
        ).toBe("REVIEW");

        expect(
          result.classification.finality
        ).toBe("UNCONFIRMED");
      }
    );

    test(
      "adds rebuild resign and retry flags",
      () => {
        const malformed =
          repairXRPLTransactionV3({
            engine_result:
              "temFUTURE_RESULT",
            transaction_type:
              "Payment",
            validated: true
          });

        expect(
          malformed.decision.flags
        ).toContain(
          "TRANSACTION_REBUILD_REQUIRED"
        );

        expect(
          malformed.decision.flags
        ).toContain(
          "RESIGN_REQUIRED"
        );

        const retryable =
          repairXRPLTransactionV3({
            engine_result:
              "terFUTURE_RESULT",
            transaction_type:
              "Payment"
          });

        expect(
          retryable.decision.flags
        ).toContain(
          "UNCHANGED_RETRY_POSSIBLE"
        );
      }
    );

    test(
      "classifies every supported transaction family",
      () => {
        const cases = [
          ["CheckCash", "CHECK"],
          ["EscrowFinish", "ESCROW"],
          [
            "PaymentChannelClaim",
            "PAYMENT_CHANNEL"
          ],
          [
            "DepositPreauth",
            "DEPOSIT_PREAUTH"
          ],
          [
            "SignerListSet",
            "SIGNER_LIST"
          ],
          ["TicketCreate", "TICKET"],
          ["Clawback", "CLAWBACK"],
          [
            "AccountSet",
            "ACCOUNT_CONFIGURATION"
          ],
          ["Batch", "OTHER"]
        ];

        for (
          const [
            transactionType,
            expectedFamily
          ] of cases
        ) {
          const result =
            repairXRPLTransactionV3({
              engine_result:
                "tesSUCCESS",
              transaction_type:
                transactionType,
              validated: true
            });

          expect(
            result.input
              .transaction_family
          ).toBe(expectedFamily);
        }

        const unknown =
          repairXRPLTransactionV3({
            engine_result:
              "tesSUCCESS",
            validated: true
          });

        expect(
          unknown.input
            .transaction_family
        ).toBe("UNKNOWN");

        expect(
          unknown.decision.flags
        ).not.toContain(
          "UNKNOWN_TRANSACTION"
        );
      }
    );

    test(
      "covers generic XRPL result families",
      () => {
        const cases = [
          {
            code: "tesFUTURE_RESULT",
            category: "SUCCESS",
            signal: "ALLOW"
          },
          {
            code: "tefFUTURE_RESULT",
            category:
              "FINAL_TRANSACTION_FAILURE",
            signal: "ABORT"
          },
          {
            code: "temFUTURE_RESULT",
            category:
              "MALFORMED_TRANSACTION",
            signal: "ABORT"
          },
          {
            code: "terFUTURE_RESULT",
            category:
              "RETRYABLE_PROVISIONAL_RESULT",
            signal: "REVIEW"
          },
          {
            code: "telFUTURE_RESULT",
            category:
              "LOCAL_SERVER_REJECTION",
            signal: "REVIEW"
          },
          {
            code: "xyzFUTURE_RESULT",
            category:
              "UNCLASSIFIED_XRPL_RESULT",
            signal: "REVIEW"
          }
        ] as const;

        for (const item of cases) {
          const result =
            repairXRPLTransactionV3({
              engine_result:
                item.code,
              transaction_type:
                "Payment",
              validated: true
            });

          expect(
            result.classification.category
          ).toBe(item.category);

          expect(
            result.decision.signal
          ).toBe(item.signal);

          expect(
            result.classification
              .specialized_rule
          ).toBe(false);
        }
      }
    );

    test(
      "covers provisional generic tes result",
      () => {
        const result =
          repairXRPLTransactionV3({
            engine_result:
              "tesFUTURE_RESULT",
            transaction_type:
              "Payment"
          });

        expect(
          result.decision.signal
        ).toBe("REVIEW");

        expect(
          result.classification.finality
        ).toBe("UNCONFIRMED");
      }
    );

    test(
      "adds rebuild resign and retry flags",
      () => {
        const malformed =
          repairXRPLTransactionV3({
            engine_result:
              "temFUTURE_RESULT",
            transaction_type:
              "Payment",
            validated: true
          });

        expect(
          malformed.decision.flags
        ).toContain(
          "TRANSACTION_REBUILD_REQUIRED"
        );

        expect(
          malformed.decision.flags
        ).toContain(
          "RESIGN_REQUIRED"
        );

        const retryable =
          repairXRPLTransactionV3({
            engine_result:
              "terFUTURE_RESULT",
            transaction_type:
              "Payment"
          });

        expect(
          retryable.decision.flags
        ).toContain(
          "UNCHANGED_RETRY_POSSIBLE"
        );
      }
    );
  }
);
