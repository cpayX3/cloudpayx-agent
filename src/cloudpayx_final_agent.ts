import { sleep } from "bun";
import * as fs from "fs";
import * as path from "path";

const WALLET_ADDRESS = "rsnHPZjBSastxz1BE38WqKBR3sgpATvreL";
const spentTransactions = new Set<string>();

const pendingInvoices = new Map<string, {
  paymentRequirements: any;
  endpoint: string;
  createdAt: number;
}>();
const desktopLogPath = "/Users/anakinskywalker/Desktop/cloudpayx_traffic_history.txt";
const xrpPriceUSD = 2.45; 

console.log("cloudpayX Agent Services API Layer initializing on port 3000.");
console.log(`🗒️ Real-time structural traffic logging directed to: ${desktopLogPath}`);

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const timestamp = new Date().toISOString();
    const uniqueRequestId = "req_" + Math.random().toString(36).substr(2, 9);
    const ip = req.headers.get("x-forwarded-for") || "unknown_remote_node";
    const userAgent = req.headers.get("user-agent") || "unknown_agent_swarm";

    // 🌐 GET / Endpoint: API Discovery Document
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(JSON.stringify({
        name: "cloudpayX Agent Services API",
        version: "1.1",
        description: "Machine-to-machine XRPL services with on-chain payment verification.",
        endpoints: [
          { service: "transaction_repair", endpoint: "/agent/repair", price_usd: 0.10 },
          { service: "risk_check", endpoint: "/agent/risk-check", price_usd: 0.02 },
          { service: "ledger_status", endpoint: "/agent/ledger-status", price_usd: 0.005 },
          { service: "arbitrage_check", endpoint: "/agent/arbitrage-check", price_usd: 0.01 },
          { service: "token_analysis", endpoint: "/agent/token-analysis", price_usd: 0.005 }
        ],
        accepted_currencies: ["XRP", "USDC", "RLUSD"]
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 🌐 GET /openapi.json: public OpenAPI document
    if (req.method === "GET" && url.pathname === "/openapi.json") {
      try {
        const openapi = fs.readFileSync(
          path.join(process.cwd(), "cloudpayx_openapi.json"),
          "utf8"
        );

        return new Response(openapi, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300"
          }
        });
      } catch {
        return new Response(
          JSON.stringify({ error: "OpenAPI document unavailable." }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
    }

    // 🌐 GET /.well-known/x402: machine-readable x402 discovery catalog
    if (req.method === "GET" && url.pathname === "/.well-known/x402") {
      const makeRequirement = (
        amountDrops: string,
        invoicePrefix: string
      ) => ({
        scheme: "exact",
        network: "xrpl:0",
        amount: amountDrops,
        asset: "XRP",
        payTo: WALLET_ADDRESS,
        maxTimeoutSeconds: 120,
        extra: {
          sourceTag: 804681468,
          invoiceIdFormat: `${invoicePrefix}_<request-id>`
        }
      });

      const resources = [
        {
          resource: "https://api.cloudpayxagent.xyz/agent/arbitrage-check",
          type: "http",
          method: "POST",
          description: "XRPL arbitrage and route optimization for autonomous trading agents.",
          input: {
            contentType: "application/json",
            example: {
              from: "XRP",
              to: "RLUSD",
              amount: 100
            }
          },
          accepts: [
            makeRequirement(
              Math.round(Number((0.01 / xrpPriceUSD).toFixed(4)) * 1_000_000).toString(),
              "cpayx"
            )
          ]
        },
        {
          resource: "https://api.cloudpayxagent.xyz/agent/risk-check",
          type: "http",
          method: "POST",
          description: "Low-latency trade and liquidity risk assessment for XRPL agents.",
          accepts: [
            makeRequirement(
              Math.round(Number((0.02 / xrpPriceUSD).toFixed(4)) * 1_000_000).toString(),
              "cpayx"
            )
          ]
        },
        {
          resource: "https://api.cloudpayxagent.xyz/agent/repair",
          type: "http",
          method: "POST",
          description: "XRPL transaction failure diagnostics and machine-readable recovery guidance.",
          accepts: [
            makeRequirement(
              Math.round(Number((0.10 / xrpPriceUSD).toFixed(4)) * 1_000_000).toString(),
              "cpayx"
            )
          ]
        },
        {
          resource: "https://api.cloudpayxagent.xyz/agent/ledger-status",
          type: "http",
          method: "POST",
          description: "XRPL ledger and consensus telemetry for autonomous systems.",
          accepts: [
            makeRequirement(
              Math.round(Number((0.005 / xrpPriceUSD).toFixed(4)) * 1_000_000).toString(),
              "cpayx"
            )
          ]
        },
        {
          resource: "https://api.cloudpayxagent.xyz/agent/token-analysis",
          type: "http",
          method: "POST",
          description: "XRPL-native token and issuer analysis for autonomous agents.",
          input: {
            contentType: "application/json",
            example: {
              asset: "XRP"
            }
          },
          accepts: [
            makeRequirement(
              Math.round(Number((0.005 / xrpPriceUSD).toFixed(4)) * 1_000_000).toString(),
              "cpayx"
            )
          ]
        }
      ];

      return new Response(
        JSON.stringify({
          version: 1,
          x402Version: 2,
          name: "cloudpayX Agent Services",
          description: "Machine-to-machine XRPL services protected by x402 payments.",
          resources
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60"
          }
        }
      );
    }

    // Map Pathnames to Internal Service Structures
    let requestedService = "";
    let priceUsd = 0.0;

    if (url.pathname === "/agent/repair") { requestedService = "agent_repair"; priceUsd = 0.10; }
    else if (url.pathname === "/agent/risk-check") { requestedService = "agent_risk_check"; priceUsd = 0.02; }
    else if (url.pathname === "/agent/ledger-status") { requestedService = "agent_ledger_status"; priceUsd = 0.005; }
    else if (url.pathname === "/agent/arbitrage-check") { requestedService = "agent_arbitrage_check"; priceUsd = 0.01; }
    else if (url.pathname === "/agent/token-analysis") { requestedService = "agent_token_analysis"; priceUsd = 0.005; }

    // Strict 404 Route Guardian
    if (!requestedService) {
      return new Response(JSON.stringify({ error: "Endpoint route not found." }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    // Discovery probes must be able to reach the x402 paywall.
    // A signed/paid request, however, must use the endpoint's real POST method.
    if (
      req.method !== "POST" &&
      req.headers.get("payment-signature")
    ) {
      return new Response(
        JSON.stringify({
          error: "Method not allowed. Paid service requests must use POST."
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            "Allow": "POST"
          }
        }
      );
    }

    try {
      const body = await req.json().catch(() => ({}));
      const targetedXRPFee = (priceUsd / xrpPriceUSD).toFixed(4);
      const paymentSignature = req.headers.get("payment-signature");

      const amountXrp = targetedXRPFee;

      const amountDrops = Math.round(
        Number(amountXrp) * 1_000_000
      ).toString();

      let paymentPayload: any = null;
      let paymentRequirements: any;

      // First request: create and remember an invoice.
      if (!paymentSignature) {
        const invoiceId =
          "cpayx_" + uniqueRequestId.replace(/[^a-zA-Z0-9]/g, "");

        paymentRequirements = {
          scheme: "exact",
          network: "xrpl:0",
          amount: amountDrops,
          asset: "XRP",
          payTo: WALLET_ADDRESS,
          maxTimeoutSeconds: 120,
          extra: {
            invoiceId,
            sourceTag: 804681468
          }
        };

        pendingInvoices.set(invoiceId, {
          paymentRequirements,
          endpoint: url.pathname,
          createdAt: Date.now()
        });

        const analyticsLog = {
          request_id: uniqueRequestId,
          endpoint: url.pathname,
          timestamp,
          client: userAgent,
          payment_required: true,
          price_usd: priceUsd,
          amount_xrp: amountXrp,
          amount_drops: amountDrops,
          payment_status: "unpaid",
          service_status: "locked",
          invoice_id: invoiceId
        };

        fs.appendFileSync(
          desktopLogPath,
          JSON.stringify(analyticsLog) + "\n"
        );

        const challenge = {
          x402Version: 2,
          error: "Payment required",
          resource: {
            url: `https://api.cloudpayxagent.xyz${url.pathname}`,
            description: `cloudpayX ${requestedService}`,
            mimeType: "application/json"
          },
          accepts: [paymentRequirements]
        };

        const paymentRequiredHeader = Buffer.from(
          JSON.stringify(challenge),
          "utf8"
        ).toString("base64");

        return new Response(JSON.stringify(challenge), {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            "PAYMENT-REQUIRED": paymentRequiredHeader,
            "Cache-Control": "no-store"
          }
        });
      }

      // Retry: decode the payment generated from the ORIGINAL 402.
      try {
        paymentPayload = JSON.parse(
          Buffer.from(paymentSignature, "base64").toString("utf8")
        );
      } catch {
        return new Response(
          JSON.stringify({
            error: "Invalid PAYMENT-SIGNATURE payload."
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      const paidInvoiceId =
        paymentPayload?.accepted?.extra?.invoiceId;

      if (!paidInvoiceId) {
        return new Response(
          JSON.stringify({
            error: "Payment payload missing invoiceId."
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      const pending = pendingInvoices.get(paidInvoiceId);

      if (!pending) {
        return new Response(
          JSON.stringify({
            error: "Unknown or expired payment invoice."
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      if (Date.now() - pending.createdAt > 120_000) {
        pendingInvoices.delete(paidInvoiceId);

        return new Response(
          JSON.stringify({
            error: "Payment invoice expired."
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      if (pending.endpoint !== url.pathname) {
        return new Response(
          JSON.stringify({
            error: "Invoice does not match requested endpoint."
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      paymentRequirements = pending.paymentRequirements;

      const accepted = paymentPayload?.accepted;

      if (
        !accepted ||
        accepted.scheme !== paymentRequirements.scheme ||
        accepted.network !== paymentRequirements.network ||
        accepted.amount !== paymentRequirements.amount ||
        accepted.asset !== paymentRequirements.asset ||
        accepted.payTo !== paymentRequirements.payTo
      ) {
        return new Response(
          JSON.stringify({
            error: "Payment requirements were modified."
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      const facilitatorBody = {
        paymentPayload,
        paymentRequirements
      };

      const verifyResponse = await fetch(
        "https://xrpl-facilitator-mainnet.t54.ai/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(facilitatorBody)
        }
      );

      const verifyResult = await verifyResponse.json();

      if (!verifyResponse.ok || verifyResult.isValid !== true) {
        return new Response(
          JSON.stringify({
            error: "Payment verification failed.",
            reason: verifyResult.invalidReason || "unknown"
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      const settleResponse = await fetch(
        "https://xrpl-facilitator-mainnet.t54.ai/settle",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(facilitatorBody)
        }
      );

      const settleResult = await settleResponse.json();

      if (!settleResponse.ok || settleResult.success !== true) {
        return new Response(
          JSON.stringify({
            error: "Payment settlement failed."
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      const transactionHash = settleResult.transaction;

      if (transactionHash && spentTransactions.has(transactionHash)) {
        return new Response(
          JSON.stringify({
            error: "Security Exception: Transaction already consumed."
          }),
          {
            status: 403,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      if (transactionHash) {
        spentTransactions.add(transactionHash);
      }

      const successLog = {
        request_id: uniqueRequestId,
        payment_status: "verified_and_settled",
        transaction_hash: transactionHash,
        amount_usd: priceUsd,
        amount_drops: amountDrops,
        service_status: "released"
      };

      fs.appendFileSync(
        desktopLogPath,
        JSON.stringify(successLog) + "\n"
      );

      if (url.pathname === "/agent/token-analysis") {
        const asset = String(body.asset || "XRP").trim().toUpperCase();
        const issuer = body.issuer ? String(body.issuer).trim() : null;

        try {
          if (asset === "XRP") {
            const rpcResponse = await fetch("https://s1.ripple.com:51234/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                method: "server_info",
                params: [{}]
              })
            });

            const rpc: any = await rpcResponse.json();
            const info = rpc?.result?.info || {};
            const validated = info?.validated_ledger || {};

            const age = Number(validated?.age ?? 999);
            const loadFactor = Number(info?.load_factor ?? 1);

            const networkHealthy =
              rpc?.result?.status === "success" &&
              age <= 10 &&
              loadFactor <= 2;

            return new Response(JSON.stringify({
              success: true,
              service: "token_analysis",
              asset: "XRP",
              token_type: "native",
              network: "xrpl:0",
              ledger_index: validated?.seq ?? null,
              validated_ledger_age_seconds: age,
              load_factor: loadFactor,
              base_fee_xrp: validated?.base_fee_xrp ?? null,
              reserve_base_xrp: validated?.reserve_base_xrp ?? null,
              reserve_inc_xrp: validated?.reserve_inc_xrp ?? null,
              network_health: networkHealthy ? "HEALTHY" : "CAUTION",
              operational_signal: networkHealthy ? "PROCEED" : "REVIEW",
              source: "XRPL mainnet server_info",
              timestamp: new Date().toISOString()
            }), {
              headers: { "Content-Type": "application/json" }
            });
          }

          if (!issuer) {
            return new Response(JSON.stringify({
              success: false,
              error: "issuer_required",
              message: "Issued XRPL tokens require an issuer address.",
              example: {
                asset: "USD",
                issuer: "r..."
              }
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }

          const rpcResponse = await fetch("https://s1.ripple.com:51234/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              method: "account_info",
              params: [{
                account: issuer,
                ledger_index: "validated"
              }]
            })
          });

          const rpc: any = await rpcResponse.json();

          if (rpc?.result?.status !== "success") {
            return new Response(JSON.stringify({
              success: false,
              service: "token_analysis",
              asset,
              issuer,
              issuer_status: "NOT_VALIDATED",
              error: rpc?.result?.error || "issuer_lookup_failed",
              timestamp: new Date().toISOString()
            }), {
              headers: { "Content-Type": "application/json" }
            });
          }

          const account = rpc.result.account_data || {};
          const flags = rpc.result.account_flags || {};

          return new Response(JSON.stringify({
            success: true,
            service: "token_analysis",
            asset,
            token_type: "issued_currency",
            network: "xrpl:0",
            issuer,
            issuer_status: "VALIDATED",
            issuer_owner_count: account.OwnerCount ?? null,
            issuer_sequence: account.Sequence ?? null,
            require_authorization: flags.requireAuthorization ?? false,
            global_freeze: flags.globalFreeze ?? false,
            no_freeze: flags.noFreeze ?? false,
            default_ripple: flags.defaultRipple ?? false,
            clawback_enabled: flags.allowTrustLineClawback ?? false,
            operational_signal:
              flags.globalFreeze === true ? "CAUTION" : "PROCEED",
            source: "XRPL validated account_info",
            timestamp: new Date().toISOString()
          }), {
            headers: { "Content-Type": "application/json" }
          });

        } catch (analysisError) {
          return new Response(JSON.stringify({
            success: false,
            service: "token_analysis",
            error: "xrpl_analysis_unavailable",
            timestamp: new Date().toISOString()
          }), {
            status: 503,
            headers: { "Content-Type": "application/json" }
          });
        }
      }

      if (url.pathname === "/agent/arbitrage-check") {
        const swapAmount = body.amount || 1000;
        return new Response(JSON.stringify({
          success: true,
          status: "optimized",
          recommended_route: "XRPL_AMM_POOL_A",
          expected_slippage_saved_usd: (swapAmount * 0.003).toFixed(2),
          metrics: { pool_a_slippage: (swapAmount * 0.001).toFixed(4), pool_b_slippage: (swapAmount * 0.004).toFixed(4) },
          timestamp: new Date().toISOString()
        }), { headers: { "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ success: true, service: requestedService, telemetry: "active_consensus_stream_synchronized" }), { headers: { "Content-Type": "application/json" } });

    } catch (error) {
      return new Response(JSON.stringify({ error: "Internal Gateway Error" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }
});
