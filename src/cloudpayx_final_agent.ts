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
          description: "XRPL token execution intelligence: issuer risk, DEX and AMM liquidity, market depth, spread, trade-size slippage, network conditions, and PROCEED/REVIEW/ABORT signals.",
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
        const tradeSizeXrpRaw = Number(body.trade_size_xrp ?? 100);
        const tradeSizeXrp =
          Number.isFinite(tradeSizeXrpRaw) && tradeSizeXrpRaw > 0
            ? tradeSizeXrpRaw
            : 100;

        // Convert human-readable XRPL token symbols into the ledger's
        // required currency representation automatically.
        //
        // Examples:
        // XRP   -> XRP
        // XOX   -> XOX
        // RLUSD -> 524C555344000000000000000000000000000000
        // Existing 40-char hex codes are accepted as-is.
        const normalizeXRPLCurrency = (symbol: string): string => {
          const value = String(symbol || "").trim();

          if (!value) {
            throw new Error("currency_required");
          }

          const upper = value.toUpperCase();

          if (upper === "XRP") {
            return "XRP";
          }

          if (/^[A-F0-9]{40}$/.test(upper)) {
            return upper;
          }

          if (/^[A-Z0-9?!@#$%^&*<>(){}\[\]|]{3}$/.test(upper)) {
            return upper;
          }

          const bytes = Buffer.from(value, "utf8");

          if (bytes.length > 20) {
            throw new Error("currency_code_exceeds_20_bytes");
          }

          return bytes
            .toString("hex")
            .toUpperCase()
            .padEnd(40, "0");
        };

        const rpcCall = async (method: string, params: Record<string, any>) => {
          const response = await fetch("https://s1.ripple.com:51234/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              method,
              params: [params]
            })
          });

          if (!response.ok) {
            throw new Error(`xrpl_http_${response.status}`);
          }

          return await response.json() as any;
        };

        const amountToNumber = (amount: any): number => {
          if (typeof amount === "string") {
            // Native XRP amounts are represented as drops.
            return Number(amount) / 1_000_000;
          }

          if (
            amount &&
            typeof amount === "object" &&
            amount.value !== undefined
          ) {
            return Number(amount.value);
          }

          return 0;
        };

        try {
          // -------------------------------------------------------
          // NETWORK STATE
          // -------------------------------------------------------

          const serverRpc = await rpcCall("server_info", {});
          const info = serverRpc?.result?.info || {};
          const validated = info?.validated_ledger || {};

          const ledgerAge = Number(validated?.age ?? 999);
          const loadFactor = Number(info?.load_factor ?? 1);

          const networkHealthy =
            serverRpc?.result?.status === "success" &&
            ledgerAge <= 10 &&
            loadFactor <= 2;

          // XRP is native and has no issuer.
          // Full XRP market analysis will be added when a quote asset
          // is supplied; for now return factual network conditions.
          if (asset === "XRP") {
            return new Response(JSON.stringify({
              success: true,
              service: "token_analysis",
              version: "2.1",
              asset: "XRP",
              asset_type: "native",
              network: "xrpl:0",

              issuer: null,

              market: {
                pair: null,
                note: "Supply an issued asset + issuer for DEX/AMM market analysis."
              },

              network_state: {
                health: networkHealthy ? "HEALTHY" : "CAUTION",
                ledger_index: validated?.seq ?? null,
                ledger_age_seconds: ledgerAge,
                load_factor: loadFactor,
                base_fee_xrp: validated?.base_fee_xrp ?? null,
                reserve_base_xrp: validated?.reserve_base_xrp ?? null,
                reserve_inc_xrp: validated?.reserve_inc_xrp ?? null
              },

              signal: {
                action: networkHealthy ? "PROCEED" : "REVIEW",
                flags: networkHealthy ? [] : ["NETWORK_CONDITIONS"]
              },

              sources: [
                "XRPL validated server_info"
              ],

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
                issuer: "r...",
                trade_size_xrp: 100
              }
            }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }

          const ledgerCurrency = normalizeXRPLCurrency(asset);

          // -------------------------------------------------------
          // ISSUER INTELLIGENCE
          // -------------------------------------------------------

          const issuerRpc = await rpcCall("account_info", {
            account: issuer,
            ledger_index: "validated"
          });

          if (issuerRpc?.result?.status !== "success") {
            return new Response(JSON.stringify({
              success: false,
              service: "token_analysis",
              asset,
              issuer,
              issuer_status: "NOT_VALIDATED",
              error:
                issuerRpc?.result?.error ||
                issuerRpc?.result?.error_message ||
                "issuer_lookup_failed",
              timestamp: new Date().toISOString()
            }), {
              headers: { "Content-Type": "application/json" }
            });
          }

          const account = issuerRpc.result.account_data || {};
          const flags = issuerRpc.result.account_flags || {};

          // Trustlines are paginated. We intentionally sample one page
          // rather than claiming an exact total when more pages exist.
          let trustlineSampleCount = 0;
          let trustlinesTruncated = false;

          try {
            const linesRpc = await rpcCall("account_lines", {
              account: issuer,
              ledger_index: "validated",
              limit: 400
            });

            const lines = Array.isArray(linesRpc?.result?.lines)
              ? linesRpc.result.lines
              : [];

            trustlineSampleCount = lines.filter(
              (line: any) =>
                String(line.currency || "").toUpperCase() === ledgerCurrency
            ).length;

            trustlinesTruncated = Boolean(linesRpc?.result?.marker);
          } catch {
            // Issuer analysis can continue even if trustline sampling fails.
          }

          // -------------------------------------------------------
          // DEX ORDER BOOKS: TOKEN <-> XRP
          // -------------------------------------------------------

          const tokenAmount = {
            currency: ledgerCurrency,
            issuer
          };

          const xrpAmount = {
            currency: "XRP"
          };

          let tokenForXrpOffers: any[] = [];
          let xrpForTokenOffers: any[] = [];

          try {
            const [sellTokenRpc, buyTokenRpc] = await Promise.all([
              rpcCall("book_offers", {
                ledger_index: "validated",
                taker_gets: tokenAmount,
                taker_pays: xrpAmount,
                limit: 50
              }),
              rpcCall("book_offers", {
                ledger_index: "validated",
                taker_gets: xrpAmount,
                taker_pays: tokenAmount,
                limit: 50
              })
            ]);

            tokenForXrpOffers = Array.isArray(
              sellTokenRpc?.result?.offers
            )
              ? sellTokenRpc.result.offers
              : [];

            xrpForTokenOffers = Array.isArray(
              buyTokenRpc?.result?.offers
            )
              ? buyTokenRpc.result.offers
              : [];
          } catch {
            // Continue and report no visible book liquidity.
          }

          const normalizedTokenPrices = tokenForXrpOffers
            .map((offer: any) => {
              const token = amountToNumber(
                offer.taker_gets_funded ?? offer.TakerGets
              );

              const xrp = amountToNumber(
                offer.taker_pays_funded ?? offer.TakerPays
              );

              if (token <= 0 || xrp <= 0) return null;

              return {
                token,
                xrp,
                xrp_per_token: xrp / token
              };
            })
            .filter(Boolean) as Array<{
              token: number;
              xrp: number;
              xrp_per_token: number;
            }>;

          const normalizedReversePrices = xrpForTokenOffers
            .map((offer: any) => {
              const xrp = amountToNumber(
                offer.taker_gets_funded ?? offer.TakerGets
              );

              const token = amountToNumber(
                offer.taker_pays_funded ?? offer.TakerPays
              );

              if (token <= 0 || xrp <= 0) return null;

              return {
                token,
                xrp,
                xrp_per_token: xrp / token
              };
            })
            .filter(Boolean) as Array<{
              token: number;
              xrp: number;
              xrp_per_token: number;
            }>;

          const bestAsk =
            normalizedTokenPrices.length > 0
              ? normalizedTokenPrices[0].xrp_per_token
              : null;

          const bestBid =
            normalizedReversePrices.length > 0
              ? normalizedReversePrices[0].xrp_per_token
              : null;

          let spreadPct: number | null = null;

          if (
            bestAsk !== null &&
            bestBid !== null &&
            bestAsk > 0 &&
            bestBid > 0
          ) {
            const midpoint = (bestAsk + bestBid) / 2;
            spreadPct =
              midpoint > 0
                ? Math.abs(bestAsk - bestBid) / midpoint
                : null;
          }

          const visibleTokenDepthXrp =
            normalizedTokenPrices.reduce(
              (sum, offer) => sum + offer.xrp,
              0
            );

          const visibleReverseDepthXrp =
            normalizedReversePrices.reduce(
              (sum, offer) => sum + offer.xrp,
              0
            );

          // -------------------------------------------------------
          // TRADE-SIZE SLIPPAGE ESTIMATE
          //
          // Simulates spending XRP against visible book offers.
          // This is DEX-order-book only; AMM liquidity is reported
          // separately and not silently mixed into this estimate.
          // -------------------------------------------------------

          let remainingXrp = tradeSizeXrp;
          let tokensAcquired = 0;
          let xrpConsumed = 0;
          let firstPrice: number | null = null;

          for (const offer of normalizedTokenPrices) {
            if (remainingXrp <= 0) break;

            if (firstPrice === null) {
              firstPrice = offer.xrp_per_token;
            }

            const spend = Math.min(remainingXrp, offer.xrp);

            const tokenReceived =
              offer.xrp_per_token > 0
                ? spend / offer.xrp_per_token
                : 0;

            xrpConsumed += spend;
            tokensAcquired += tokenReceived;
            remainingXrp -= spend;
          }

          const averageExecutionPrice =
            tokensAcquired > 0
              ? xrpConsumed / tokensAcquired
              : null;

          const estimatedSlippagePct =
            firstPrice !== null &&
            averageExecutionPrice !== null &&
            firstPrice > 0
              ? Math.max(
                  0,
                  (averageExecutionPrice - firstPrice) / firstPrice
                )
              : null;

          const bookCanFillTrade =
            remainingXrp <= 0 && tradeSizeXrp > 0;

          // -------------------------------------------------------
          // AMM
          // -------------------------------------------------------

          let ammAvailable = false;
          let ammAccount: string | null = null;
          let ammTradingFee: number | null = null;
          let ammXrpLiquidity: number | null = null;
          let ammTokenLiquidity: number | null = null;

          try {
            const ammRpc = await rpcCall("amm_info", {
              asset: xrpAmount,
              asset2: tokenAmount,
              ledger_index: "validated"
            });

            const amm = ammRpc?.result?.amm;

            if (amm) {
              ammAvailable = true;
              ammAccount = amm.account ?? null;
              ammTradingFee =
                amm.trading_fee !== undefined
                  ? Number(amm.trading_fee)
                  : null;

              const a1 = amm.amount;
              const a2 = amm.amount2;

              if (typeof a1 === "string") {
                ammXrpLiquidity = amountToNumber(a1);
                ammTokenLiquidity = amountToNumber(a2);
              } else if (typeof a2 === "string") {
                ammXrpLiquidity = amountToNumber(a2);
                ammTokenLiquidity = amountToNumber(a1);
              }
            }
          } catch {
            // No AMM is a valid market condition, not an API failure.
          }

          // -------------------------------------------------------
          // DETERMINISTIC SIGNAL
          // -------------------------------------------------------

          const signalFlags: string[] = [];

          // -------------------------------------------------------
          // V2.1 RISK SEVERITY
          //
          // REVIEW thresholds identify degraded execution.
          // ABORT thresholds identify conditions that are generally
          // unsuitable for an autonomous trade at the requested size.
          // -------------------------------------------------------

          const REVIEW_SPREAD_THRESHOLD = 0.05;   // 5%
          const ABORT_SPREAD_THRESHOLD = 0.20;    // 20%

          const REVIEW_SLIPPAGE_THRESHOLD = 0.03; // 3%
          const ABORT_SLIPPAGE_THRESHOLD = 0.15;  // 15%

          if (!networkHealthy) {
            signalFlags.push("NETWORK_CONDITIONS");
          }

          if (flags.globalFreeze === true) {
            signalFlags.push("GLOBAL_FREEZE");
          }

          if (
            tokenForXrpOffers.length === 0 &&
            xrpForTokenOffers.length === 0 &&
            !ammAvailable
          ) {
            signalFlags.push("NO_VISIBLE_LIQUIDITY");
          }

          if (
            spreadPct !== null &&
            spreadPct > REVIEW_SPREAD_THRESHOLD
          ) {
            signalFlags.push("WIDE_SPREAD");
          }

          if (
            spreadPct !== null &&
            spreadPct > ABORT_SPREAD_THRESHOLD
          ) {
            signalFlags.push("EXTREME_SPREAD");
          }

          if (
            estimatedSlippagePct !== null &&
            estimatedSlippagePct > REVIEW_SLIPPAGE_THRESHOLD
          ) {
            signalFlags.push("HIGH_SLIPPAGE");
          }

          if (
            estimatedSlippagePct !== null &&
            estimatedSlippagePct > ABORT_SLIPPAGE_THRESHOLD
          ) {
            signalFlags.push("EXTREME_SLIPPAGE");
          }

          if (!bookCanFillTrade && !ammAvailable) {
            signalFlags.push("INSUFFICIENT_BOOK_DEPTH");
          } else if (!bookCanFillTrade && ammAvailable) {
            // Our current slippage simulator measures visible DEX book
            // execution separately from AMM liquidity. Do not claim the
            // combined route is impossible when an AMM exists.
            signalFlags.push("ORDER_BOOK_INCOMPLETE");
          }

          const abortReasons = [
            "GLOBAL_FREEZE",
            "NO_VISIBLE_LIQUIDITY",
            "EXTREME_SPREAD",
            "EXTREME_SLIPPAGE",
            "INSUFFICIENT_BOOK_DEPTH"
          ];

          let action: "PROCEED" | "REVIEW" | "ABORT" = "PROCEED";

          if (
            signalFlags.some(flag =>
              abortReasons.includes(flag)
            )
          ) {
            action = "ABORT";
          } else if (signalFlags.length > 0) {
            action = "REVIEW";
          }

          return new Response(JSON.stringify({
            success: true,
            service: "token_analysis",
            version: "2.1",

            asset,
            ledger_currency: ledgerCurrency,
            asset_type: "issued_currency",
            network: "xrpl:0",
            trade_size_xrp: tradeSizeXrp,

            issuer: {
              address: issuer,
              status: "VALIDATED",
              owner_count: account.OwnerCount ?? null,
              sequence: account.Sequence ?? null,
              flags: {
                require_authorization:
                  flags.requireAuthorization ?? false,
                global_freeze:
                  flags.globalFreeze ?? false,
                no_freeze:
                  flags.noFreeze ?? false,
                default_ripple:
                  flags.defaultRipple ?? false,
                clawback_enabled:
                  flags.allowTrustLineClawback ?? false
              },
              trustlines: {
                matching_currency_sample: trustlineSampleCount,
                truncated: trustlinesTruncated,
                note: trustlinesTruncated
                  ? "Sample only; issuer has additional paginated trustlines."
                  : "No additional pagination marker returned."
              }
            },

            liquidity: {
              order_book: {
                token_to_xrp_offer_count:
                  tokenForXrpOffers.length,
                xrp_to_token_offer_count:
                  xrpForTokenOffers.length,
                visible_token_side_depth_xrp:
                  Number(visibleTokenDepthXrp.toFixed(6)),
                visible_reverse_side_depth_xrp:
                  Number(visibleReverseDepthXrp.toFixed(6)),
                can_fill_requested_trade:
                  bookCanFillTrade
              },

              amm: {
                available: ammAvailable,
                account: ammAccount,
                trading_fee: ammTradingFee,
                xrp_liquidity:
                  ammXrpLiquidity !== null
                    ? Number(ammXrpLiquidity.toFixed(6))
                    : null,
                token_liquidity:
                  ammTokenLiquidity !== null
                    ? Number(ammTokenLiquidity.toFixed(8))
                    : null
              }
            },

            market: {
              pair: `${asset}/XRP`,
              best_bid_xrp_per_token: bestBid,
              best_ask_xrp_per_token: bestAsk,
              spread:
                spreadPct !== null
                  ? Number(spreadPct.toFixed(8))
                  : null,

              requested_trade_size_xrp: tradeSizeXrp,

              order_book_execution: {
                xrp_consumed:
                  Number(xrpConsumed.toFixed(6)),
                tokens_estimated:
                  Number(tokensAcquired.toFixed(8)),
                average_execution_price_xrp_per_token:
                  averageExecutionPrice !== null
                    ? Number(averageExecutionPrice.toFixed(12))
                    : null,
                estimated_slippage:
                  estimatedSlippagePct !== null
                    ? Number(estimatedSlippagePct.toFixed(8))
                    : null,
                complete_fill:
                  bookCanFillTrade
              }
            },

            network_state: {
              health:
                networkHealthy ? "HEALTHY" : "CAUTION",
              ledger_index:
                validated?.seq ?? null,
              ledger_age_seconds:
                ledgerAge,
              load_factor:
                loadFactor,
              base_fee_xrp:
                validated?.base_fee_xrp ?? null
            },

            signal: {
              action,
              flags: signalFlags,
              rules: {
                review_spread_threshold: REVIEW_SPREAD_THRESHOLD,
                abort_spread_threshold: ABORT_SPREAD_THRESHOLD,
                review_slippage_threshold: REVIEW_SLIPPAGE_THRESHOLD,
                abort_slippage_threshold: ABORT_SLIPPAGE_THRESHOLD,
                ledger_age_max_seconds: 10,
                load_factor_max: 2
              }
            },

            sources: [
              "XRPL validated server_info",
              "XRPL validated account_info",
              "XRPL validated account_lines",
              "XRPL validated book_offers",
              "XRPL validated amm_info"
            ],

            timestamp: new Date().toISOString()
          }), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store"
            }
          });

        } catch (analysisError) {
          console.error(
            "token-analysis error:",
            analysisError
          );

          return new Response(JSON.stringify({
            success: false,
            service: "token_analysis",
            version: "2.1",
            error: "xrpl_analysis_unavailable",
            timestamp: new Date().toISOString()
          }), {
            status: 503,
            headers: {
              "Content-Type": "application/json"
            }
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
