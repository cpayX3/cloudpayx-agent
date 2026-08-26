import {
  describe,
  expect,
  test
} from "bun:test";

import {
  XRPLAssetResolutionError,
  normalizeXRPLCurrency,
  resolveXRPLAsset,
  toXRPLAssetObject
} from "../cloudpayx_xrpl_asset_resolver";

const ISSUER =
  "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";

describe(
  "cloudpayX universal XRPL asset resolver",
  () => {
    test("resolves native XRP", () => {
      const asset =
        resolveXRPLAsset({
          asset: "XRP"
        });

      expect(asset.kind).toBe("XRP");
      expect(asset.key).toBe("XRP");
      expect(
        toXRPLAssetObject(asset)
      ).toEqual({
        currency: "XRP"
      });
    });

    test(
      "resolves arbitrary issued currency",
      () => {
        const asset =
          resolveXRPLAsset({
            asset: "FUZZY",
            issuer: ISSUER
          });

        expect(asset.kind).toBe(
          "ISSUED_CURRENCY"
        );

        if (
          asset.kind !==
          "ISSUED_CURRENCY"
        ) {
          throw new Error(
            "Unexpected asset kind"
          );
        }

        expect(asset.displayCode).toBe(
          "FUZZY"
        );

        expect(
          asset.ledgerCurrency
        ).toBe(
          "46555A5A59000000000000000000000000000000"
        );

        expect(asset.issuer).toBe(
          ISSUER
        );
      }
    );

    test(
      "preserves three-character codes",
      () => {
        const normalized =
          normalizeXRPLCurrency("USD");

        expect(
          normalized.ledgerCurrency
        ).toBe("USD");
      }
    );

    test(
      "normalizes longer token symbols",
      () => {
        const normalized =
          normalizeXRPLCurrency("RLUSD");

        expect(
          normalized.ledgerCurrency
        ).toBe(
          "524C555344000000000000000000000000000000"
        );
      }
    );

    test("resolves an MPT", () => {
      const issuanceId =
        "A".repeat(48);

      const asset =
        resolveXRPLAsset({
          asset_type: "MPT",
          mpt_issuance_id:
            issuanceId
        });

      expect(asset.kind).toBe("MPT");
      expect(asset.key).toBe(
        `MPT:${issuanceId}`
      );

      expect(
        toXRPLAssetObject(asset)
      ).toEqual({
        mpt_issuance_id:
          issuanceId
      });
    });

    test("resolves an NFToken", () => {
      const nftokenId =
        "B".repeat(64);

      const asset =
        resolveXRPLAsset({
          asset_type: "NFT",
          nftoken_id:
            nftokenId
        });

      expect(asset.kind).toBe("NFT");
      expect(asset.key).toBe(
        `NFT:${nftokenId}`
      );

      expect(
        toXRPLAssetObject(asset)
      ).toEqual({
        nftoken_id:
          nftokenId
      });
    });

    test(
      "rejects issued currency without issuer",
      () => {
        expect(() =>
          resolveXRPLAsset({
            asset: "FUZZY"
          })
        ).toThrow(
          XRPLAssetResolutionError
        );

        try {
          resolveXRPLAsset({
            asset: "FUZZY"
          });
        } catch (error) {
          expect(
            (
              error as
                XRPLAssetResolutionError
            ).code
          ).toBe("ISSUER_REQUIRED");
        }
      }
    );

    test(
      "rejects an issuer on native XRP",
      () => {
        expect(() =>
          resolveXRPLAsset({
            asset: "XRP",
            issuer: ISSUER
          })
        ).toThrow(
          "Native XRP does not have an issuer."
        );
      }
    );

    test(
      "rejects malformed MPT IDs",
      () => {
        expect(() =>
          resolveXRPLAsset({
            asset_type: "MPT",
            mpt_issuance_id: "ABC"
          })
        ).toThrow(
          "48 hexadecimal characters"
        );
      }
    );
  }
);
