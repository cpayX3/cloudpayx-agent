import type {
  XRPLRequestClient
} from "./cloudpayx_xrpl_data_collector";

export type XRPLFetch =
  typeof globalThis.fetch;

export class XRPLRPCError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly data:
      Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "XRPLRPCError";
  }
}

export function createXRPLHTTPClient(
  endpoint: string,
  fetchImplementation:
    XRPLFetch = globalThis.fetch
): XRPLRequestClient {
  const rpcEndpoint =
    String(endpoint || "").trim();

  if (!rpcEndpoint) {
    throw new Error(
      "XRPL RPC endpoint is required."
    );
  }

  return {
    async request(request) {
      const response =
        await fetchImplementation(
          rpcEndpoint,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              method: request.command,
              params: [
                Object.fromEntries(
                  Object.entries(
                    request
                  ).filter(
                    ([key]) =>
                      key !== "command"
                  )
                )
              ]
            })
          }
        );

      if (!response.ok) {
        throw new XRPLRPCError(
          "HTTP_ERROR",
          `XRPL RPC returned HTTP ${response.status}.`,
          {
            status: response.status
          }
        );
      }

      let payload: any;

      try {
        payload =
          await response.json();
      } catch {
        throw new XRPLRPCError(
          "INVALID_JSON",
          "XRPL RPC returned invalid JSON."
        );
      }

      const result =
        payload?.result;

      if (
        !result ||
        typeof result !== "object"
      ) {
        throw new XRPLRPCError(
          "INVALID_RESPONSE",
          "XRPL RPC response is missing its result object."
        );
      }

      if (
        result.status === "error" ||
        result.error
      ) {
        const code =
          String(
            result.error ||
            "XRPL_RPC_ERROR"
          );

        throw new XRPLRPCError(
          code,
          String(
            result.error_message ||
            result.error_exception ||
            code
          ),
          result
        );
      }

      return {
        result
      };
    }
  };
}
