import {
  describe,
  expect,
  test
} from "bun:test";

import {
  createXRPLHTTPClient,
  XRPLRPCError
} from "../cloudpayx_xrpl_rpc_client";

function response(
  body: unknown,
  status = 200
): Response {
  return new Response(
    typeof body === "string"
      ? body
      : JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}

describe(
  "cloudpayX XRPL HTTP RPC client",
  () => {
    test(
      "converts collector requests to XRPL JSON-RPC",
      async () => {
        const calls: Array<{
          input: RequestInfo | URL;
          init?: RequestInit;
        }> = [];

        const fakeFetch =
          async (
            input: RequestInfo | URL,
            init?: RequestInit
          ) => {
            calls.push({
              input,
              init
            });

            return response({
              result: {
                status: "success",
                ledger_index: 123,
                node: {
                  LedgerEntryType:
                    "MPTokenIssuance"
                }
              }
            });
          };

        const client =
          createXRPLHTTPClient(
            "https://example.test/",
            fakeFetch as typeof fetch
          );

        const result =
          await client.request({
            command: "ledger_entry",
            mpt_issuance:
              "A".repeat(48),
            ledger_index:
              "validated",
            binary: false
          });

        expect(
          result.result.ledger_index
        ).toBe(123);

        expect(calls).toHaveLength(1);
        expect(calls[0].input)
          .toBe("https://example.test/");
        expect(calls[0].init?.method)
          .toBe("POST");
        expect(calls[0].init?.headers)
          .toEqual({
            "Content-Type":
              "application/json"
          });

        expect(
          JSON.parse(
            String(
              calls[0].init?.body
            )
          )
        ).toEqual({
          method: "ledger_entry",
          params: [
            {
              mpt_issuance:
                "A".repeat(48),
              ledger_index:
                "validated",
              binary: false
            }
          ]
        });
      }
    );

    test(
      "rejects a missing endpoint",
      () => {
        expect(
          () =>
            createXRPLHTTPClient("")
        ).toThrow(
          "endpoint is required"
        );
      }
    );

    test(
      "reports non-successful HTTP responses",
      async () => {
        const client =
          createXRPLHTTPClient(
            "https://example.test/",
            (async () =>
              response(
                {
                  error: "unavailable"
                },
                503
              )) as typeof fetch
          );

        try {
          await client.request({
            command: "server_info"
          });

          throw new Error(
            "Expected request to fail."
          );
        } catch (error) {
          expect(error)
            .toBeInstanceOf(
              XRPLRPCError
            );

          const rpcError =
            error as XRPLRPCError;

          expect(rpcError.code)
            .toBe("HTTP_ERROR");
          expect(rpcError.data)
            .toEqual({
              status: 503
            });
        }
      }
    );

    test(
      "rejects invalid JSON",
      async () => {
        const client =
          createXRPLHTTPClient(
            "https://example.test/",
            (async () =>
              response(
                "not-json"
              )) as typeof fetch
          );

        await expect(
          client.request({
            command: "server_info"
          })
        ).rejects.toThrow(
          "invalid JSON"
        );
      }
    );

    test(
      "rejects a missing result object",
      async () => {
        const client =
          createXRPLHTTPClient(
            "https://example.test/",
            (async () =>
              response({
                jsonrpc: "2.0"
              })) as typeof fetch
          );

        await expect(
          client.request({
            command: "server_info"
          })
        ).rejects.toThrow(
          "missing its result"
        );
      }
    );

    test(
      "preserves XRPL error codes for the collector",
      async () => {
        const client =
          createXRPLHTTPClient(
            "https://example.test/",
            (async () =>
              response({
                result: {
                  status: "error",
                  error:
                    "objectNotFound",
                  error_message:
                    "The requested object was not found."
                }
              })) as typeof fetch
          );

        try {
          await client.request({
            command:
              "nft_buy_offers",
            nft_id:
              "B".repeat(64)
          });

          throw new Error(
            "Expected request to fail."
          );
        } catch (error) {
          const rpcError =
            error as XRPLRPCError;

          expect(rpcError.code)
            .toBe(
              "objectNotFound"
            );
          expect(rpcError.data?.error)
            .toBe(
              "objectNotFound"
            );
        }
      }
    );

    test(
      "uses the XRPL exception when no message exists",
      async () => {
        const client =
          createXRPLHTTPClient(
            "https://example.test/",
            (async () =>
              response({
                result: {
                  status: "error",
                  error_exception:
                    "backend unavailable"
                }
              })) as typeof fetch
          );

        await expect(
          client.request({
            command: "server_info"
          })
        ).rejects.toThrow(
          "backend unavailable"
        );
      }
    );
  }
);
