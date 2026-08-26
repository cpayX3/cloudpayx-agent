import { sleep } from "bun";
import * as fs from "fs";
import * as path from "path";

import {
  XRPLAssetResolutionError
} from "./cloudpayx_xrpl_asset_resolver";

import {
  analyzeXRPLAssetV3
} from "./cloudpayx_xrpl_asset_analysis_v3";

import {
  assessXRPLRiskV3
} from "./cloudpayx_xrpl_risk_service_v3";

import {
  createXRPLHTTPClient,
  XRPLRPCError
} from "./cloudpayx_xrpl_rpc_client";

const WALLET_ADDRESS = "rsnHPZjBSastxz1BE38WqKBR3sgpATvreL";
const spentTransactions = new Set<string>();

const pendingInvoices = new Map<string, {
  paymentRequirements: any;
  endpoint: string;
  createdAt: number;
}>();
const desktopLogPath = "/Users/anakinskywalker/Desktop/cloudpayx_traffic_history.txt";
const readableLogPath = "/Users/anakinskywalker/Desktop/cloudpayx_traffic_readable.log";
const xrpPriceUSD = 2.45;

const RLUSD_ASSET =
  "524C555344000000000000000000000000000000";

const RLUSD_ISSUER =
  "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";

const USDC_ASSET =
  "5553444300000000000000000000000000000000";

const USDC_ISSUER =
  "rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE"; 

// ---------------------------------------------------------
// CLOUDPAYX HUMAN REPORT LAYER V1
// Persistent sanitized snapshots for shareable reports.
// ---------------------------------------------------------

const reportStorePath = path.join(
  process.cwd(),
  "data",
  "reports"
);

fs.mkdirSync(reportStorePath, {
  recursive: true
});

type CloudPayXReport = {
  report_id: string;
  service: string;
  service_version: string;
  network: string;
  created_at: string;
  visibility: "unlisted";
  shareable: boolean;
  data: any;
};

const createReportId = (): string => {
  return "cpx_rpt_" + crypto.randomUUID().replace(/-/g, "");
};

const sanitizeReportData = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map(sanitizeReportData);
  }

  if (
    value !== null &&
    typeof value === "object"
  ) {
    const sanitized: Record<string, any> = {};

    const blockedKeys = new Set([
      "seed",
      "private_key",
      "privateKey",
      "secret",
      "payment_signature",
      "paymentSignature",
      "source_fingerprint",
      "sourceFingerprint",
      "ip",
      "cf_connecting_ip",
      "forwarded_for"
    ]);

    for (const [key, child] of Object.entries(value)) {
      if (blockedKeys.has(key)) {
        continue;
      }

      sanitized[key] = sanitizeReportData(child);
    }

    return sanitized;
  }

  return value;
};

const createReport = (
  service: string,
  serviceVersion: string,
  network: string,
  result: any
) => {
  const reportId = createReportId();

  const report: CloudPayXReport = {
    report_id: reportId,
    service,
    service_version: serviceVersion,
    network,
    created_at: new Date().toISOString(),
    visibility: "unlisted",
    shareable: true,
    data: sanitizeReportData(result)
  };

  const reportPath = path.join(
    reportStorePath,
    `${reportId}.json`
  );

  fs.writeFileSync(
    reportPath,
    JSON.stringify(report, null, 2),
    {
      encoding: "utf8",
      flag: "wx"
    }
  );

  return {
    id: reportId,
    url:
      `https://api.cloudpayxagent.xyz/reports/${reportId}`,
    visibility: report.visibility
  };
};

const readReport = (
  reportId: string
): CloudPayXReport | null => {
  if (
    !/^cpx_rpt_[a-f0-9]{32}$/.test(reportId)
  ) {
    return null;
  }

  const reportPath = path.join(
    reportStorePath,
    `${reportId}.json`
  );

  try {
    return JSON.parse(
      fs.readFileSync(reportPath, "utf8")
    ) as CloudPayXReport;
  } catch {
    return null;
  }
};

console.log("cloudpayX Agent Services API Layer initializing.");
console.log(`🗒️ Real-time structural traffic logging directed to: ${desktopLogPath}`);

const cloudpayxPort =
  Number(
    process.env.CLOUDPAYX_PORT ??
    "3000"
  );

console.log(
  `cloudpayX listening port: ${cloudpayxPort}`
);

Bun.serve({
  port: cloudpayxPort,
  async fetch(req) {
    const url = new URL(req.url);
    const timestamp = new Date().toISOString();
    const uniqueRequestId = "req_" + Math.random().toString(36).substr(2, 9);
    const cfConnectingIp =
      req.headers.get("cf-connecting-ip") || null;

    const forwardedFor =
      req.headers.get("x-forwarded-for") || null;

    const ip =
      cfConnectingIp ||
      forwardedFor?.split(",")[0]?.trim() ||
      "unknown_remote_node";

    const userAgent =
      req.headers.get("user-agent") || "unknown_agent_swarm";

    const paymentSignaturePresent =
      Boolean(req.headers.get("payment-signature"));

    const sourceFingerprint =
      Buffer.from(`${ip}|${userAgent}`)
        .toString("base64url")
        .slice(0, 12);

    // 🌐 GET /reports/:id
    // Public read-only access to an unlisted CloudPayX report.
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/reports/")
    ) {
      const reportId =
        url.pathname.split("/")[2] || "";

      const report = readReport(reportId);

      if (!report) {
        return new Response(
          JSON.stringify({
            error: "Report not found."
          }),
          {
            status: 404,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }

      return new Response(
        JSON.stringify(report, null, 2),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
            "X-Robots-Tag": "noindex, nofollow",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    // 🌐 GET / Endpoint: API Discovery Document
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(JSON.stringify({
        name: "cloudpayX Agent Services API",
        version: "2.0",
        description: "Paid XRPL machine intelligence for autonomous agents, protected by x402 payments.",
        endpoints: [
          { service: "transaction_repair", endpoint: "/agent/repair", service_version: "2.0", price_usd: 0.10 },
          { service: "risk_check", endpoint: "/agent/risk-check", service_version: "2.0", price_usd: 0.02 },
          { service: "ledger_status", endpoint: "/agent/ledger-status", service_version: "2.0", price_usd: 0.005 },
          { service: "arbitrage_check", endpoint: "/agent/arbitrage-check", service_version: "2.0", price_usd: 0.01 },
          { service: "token_analysis", endpoint: "/agent/token-analysis", service_version: "2.1", price_usd: 0.005 },
          { service: "stablecoin_route", endpoint: "/agent/stablecoin-route", service_version: "1.0", price_usd: 0.01 }
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
          resource: "https://api.cloudpayxagent.xyz/agent/stablecoin-route",
          type: "http",
          method: "POST",
          description: "XRPL stablecoin execution routing that compares direct order-book execution with XRP-bridged routing and returns the best executable route.",
          input: {
            contentType: "application/json",
            example: {
              from: "RLUSD",
              to: "USDC",
              amount: 1000,
              objective: "best_execution"
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
          resource: "https://api.cloudpayxagent.xyz/agent/v3/risk-check",
          type: "http",
          method: "POST",
          description: "Capability-aware XRPL risk analysis for arbitrary issued currencies, MPTs, NFTokens and native XRP across trade, transfer and ownership intents.",
          input: {
            contentType: "application/json",
            example: {
              intent: "TRADE",
              from: {
                asset: "XRP"
              },
              to: {
                asset: "RLUSD",
                issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"
              },
              amount: 100
            }
          },
          accepts: [
            makeRequirement(
              Math.round(Number((0.02 / xrpPriceUSD).toFixed(4)) * 1_000_000).toString(),
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
          resource: "https://api.cloudpayxagent.xyz/agent/v3/asset-analysis",
          type: "http",
          method: "POST",
          description: "Universal XRPL asset intelligence for native XRP, arbitrary issued currencies, MPT issuances and NFTokens.",
          input: {
            contentType: "application/json",
            example: {
              asset: "RLUSD",
              issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"
            }
          },
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
    else if (url.pathname === "/agent/v3/risk-check") { requestedService = "agent_risk_check_v3"; priceUsd = 0.02; }
    else if (url.pathname === "/agent/risk-check") { requestedService = "agent_risk_check"; priceUsd = 0.02; }
    else if (url.pathname === "/agent/ledger-status") { requestedService = "agent_ledger_status"; priceUsd = 0.005; }
    else if (url.pathname === "/agent/arbitrage-check") { requestedService = "agent_arbitrage_check"; priceUsd = 0.01; }
    else if (url.pathname === "/agent/v3/asset-analysis") { requestedService = "agent_asset_analysis_v3"; priceUsd = 0.005; }
    else if (url.pathname === "/agent/token-analysis") { requestedService = "agent_token_analysis"; priceUsd = 0.005; }
    else if (url.pathname === "/agent/stablecoin-route") { requestedService = "agent_stablecoin_route"; priceUsd = 0.01; }
    else if (url.pathname === "/internal/token-analysis") { requestedService = "agent_token_analysis"; priceUsd = 0.005; }

    const isInternalTokenAnalysis =
      url.pathname === "/internal/token-analysis";

    const isStablecoinRoute =
      url.pathname === "/agent/stablecoin-route";

    // Private handoff for an already-paid XRPLFI request.
    if (isInternalTokenAnalysis) {
      const expectedSecret = process.env.CLOUDPAYX_INTERNAL_SECRET;
      const suppliedSecret = req.headers.get("x-cloudpayx-internal-secret");

      if (
        !expectedSecret ||
        !suppliedSecret ||
        suppliedSecret !== expectedSecret
      ) {
        return new Response(
          JSON.stringify({ error: "Endpoint route not found." }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
    }

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

      const paymentAmount = isStablecoinRoute
        ? priceUsd.toFixed(2)
        : amountDrops;

      const paymentAsset = isStablecoinRoute
        ? RLUSD_ASSET
        : "XRP";

      let paymentPayload: any = null;
      let paymentRequirements: any;

      // First request: create and remember an invoice.
      // XRPLFI has already collected and settled payment before
      // calling the authenticated internal route.
      // All normal public routes continue through the t54 payment flow.
      if (!isInternalTokenAnalysis) {

      if (!paymentSignature) {
        const invoiceId =
          "cpayx_" + uniqueRequestId.replace(/[^a-zA-Z0-9]/g, "");

        paymentRequirements = {
          scheme: "exact",
          network: "xrpl:0",
          amount: paymentAmount,
          asset: paymentAsset,
          payTo: WALLET_ADDRESS,
          maxTimeoutSeconds: 120,
          extra: {
            invoiceId,
            sourceTag: 804681468,
            ...(isStablecoinRoute ? { issuer: RLUSD_ISSUER } : {})
          }
        };

        pendingInvoices.set(invoiceId, {
          paymentRequirements,
          endpoint: url.pathname,
          createdAt: Date.now()
        });

        const analyticsLog = {
          timestamp,
          event_type: "DISCOVERY_PROBE",
          request_id: uniqueRequestId,
          source_fingerprint: sourceFingerprint,
          ip,
          cf_connecting_ip: cfConnectingIp,
          forwarded_for: forwardedFor,
          user_agent: userAgent,
          method: req.method,
          endpoint: url.pathname,
          requested_service: requestedService,
          payment_signature_present: paymentSignaturePresent,
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

        fs.appendFileSync(
          readableLogPath,
          [
            `[${timestamp}] DISCOVERY_PROBE`,
            `SOURCE: ${sourceFingerprint}`,
            `IP: ${ip}`,
            `AGENT: ${userAgent}`,
            `METHOD: ${req.method}`,
            `ENDPOINT: ${url.pathname}`,
            `PRICE: ${amountXrp} XRP (${amountDrops} drops)`,
            `INVOICE: ${invoiceId}`,
            `STATUS: 402 PAYMENT REQUIRED`,
            "-------------------------------------",
            ""
          ].join("\n")
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

      const facilitatorBaseUrl = isStablecoinRoute
        ? "http://127.0.0.1:3011"
        : "https://xrpl-facilitator-mainnet.t54.ai";

      const verifyResponse = await fetch(
        `${facilitatorBaseUrl}/verify`,
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
        `${facilitatorBaseUrl}/settle`,
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
        console.error(
          "x402 settlement failed:",
          JSON.stringify(settleResult, null, 2)
        );

        return new Response(
          JSON.stringify({
            error: "Payment settlement failed.",
            reason:
              settleResult?.errorReason ??
              settleResult?.error ??
              settleResult?.message ??
              settleResult?.reason ??
              "unknown"
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
        timestamp,
        event_type: "PAID_CALL",
        request_id: uniqueRequestId,
        source_fingerprint: sourceFingerprint,
        ip,
        cf_connecting_ip: cfConnectingIp,
        forwarded_for: forwardedFor,
        user_agent: userAgent,
        method: req.method,
        endpoint: url.pathname,
        requested_service: requestedService,
        payment_signature_present: paymentSignaturePresent,
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

      fs.appendFileSync(
        readableLogPath,
        [
          `[${timestamp}] PAID_CALL`,
          `SOURCE: ${sourceFingerprint}`,
          `IP: ${ip}`,
          `AGENT: ${userAgent}`,
          `METHOD: ${req.method}`,
          `ENDPOINT: ${url.pathname}`,
          `TX: ${transactionHash || "unknown"}`,
          `AMOUNT: ${amountDrops} drops`,
          `STATUS: VERIFIED + SETTLED + RELEASED`,
          "-------------------------------------",
          ""
        ].join("\n")
      );

      } // end normal t54 payment flow


      if (url.pathname === "/agent/stablecoin-route") {
        const from = String(body.from || "").trim().toUpperCase();
        const to = String(body.to || "").trim().toUpperCase();

        // `amount` is denominated in the FROM asset.
        // `amount_usd` is temporarily accepted for backwards compatibility.
        const inputAmountRaw = Number(
          body.amount ?? body.amount_usd ?? 1000
        );

        const inputAmount =
          Number.isFinite(inputAmountRaw) && inputAmountRaw > 0
            ? inputAmountRaw
            : 1000;

        const objective = String(
          body.objective || "best_execution"
        ).trim().toLowerCase();

        const normalizeCurrency = (symbol: string): string => {
          const upper = symbol.toUpperCase();

          if (upper === "XRP") return "XRP";

          if (upper === "RLUSD") {
            return RLUSD_ASSET;
          }

          if (upper === "USDC") {
            return USDC_ASSET;
          }

          if (/^[A-F0-9]{40}$/.test(upper)) {
            return upper;
          }

          if (/^[A-Z0-9]{3}$/.test(upper)) {
            return upper;
          }

          return Buffer.from(symbol, "utf8")
            .toString("hex")
            .toUpperCase()
            .padEnd(40, "0");
        };

        const getIssuer = (symbol: string): string | null => {
          if (symbol === "RLUSD") return RLUSD_ISSUER;
          if (symbol === "USDC") return USDC_ISSUER;
          return null;
        };

        const assetObject = (symbol: string) => {
          if (symbol === "XRP") {
            return { currency: "XRP" };
          }

          const issuer = getIssuer(symbol);

          if (!issuer) {
            throw new Error(`unsupported_stablecoin:${symbol}`);
          }

          return {
            currency: normalizeCurrency(symbol),
            issuer
          };
        };

        const xrplRpc = async (command: string, params: any) => {
          const response = await fetch(
            "https://xrplcluster.com/",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                method: command,
                params: [params]
              })
            }
          );

          if (!response.ok) {
            throw new Error(`xrpl_rpc_http_${response.status}`);
          }

          const json: any = await response.json();

          if (json?.result?.status !== "success") {
            throw new Error(
              json?.result?.error || "xrpl_rpc_failed"
            );
          }

          return json.result;
        };

        const amountToNumber = (value: any): number => {
          if (typeof value === "string") {
            return Number(value) / 1_000_000;
          }

          if (
            value &&
            typeof value === "object" &&
            value.value !== undefined
          ) {
            return Number(value.value);
          }

          return 0;
        };

        const simulateBookExecution = (
          offers: any[],
          requestedInput: number
        ) => {
          let remaining = requestedInput;
          let output = 0;
          let consumedInput = 0;

          for (const offer of offers || []) {
            if (remaining <= 0) break;

            const takerGets = amountToNumber(
              offer.taker_gets_funded ?? offer.TakerGets
            );

            const takerPays = amountToNumber(
              offer.taker_pays_funded ?? offer.TakerPays
            );

            if (
              !Number.isFinite(takerGets) ||
              !Number.isFinite(takerPays) ||
              takerGets <= 0 ||
              takerPays <= 0
            ) {
              continue;
            }

            const inputAvailable = takerPays;
            const outputAvailable = takerGets;

            const takeInput = Math.min(
              remaining,
              inputAvailable
            );

            const ratio =
              outputAvailable / inputAvailable;

            output += takeInput * ratio;
            consumedInput += takeInput;
            remaining -= takeInput;
          }

          return {
            output,
            consumedInput,
            completeFill: remaining <= 0.0000001
          };
        };


        const analyzeBookRoute = async (
          fromSymbol: string,
          toSymbol: string,
          requestedInput: number
        ) => {
          const fromAsset = assetObject(fromSymbol);
          const toAsset = assetObject(toSymbol);

          const book = await xrplRpc("book_offers", {
            taker_gets: toAsset,
            taker_pays: fromAsset,
            ledger_index: "validated",
            limit: 200
          });

          const offers = Array.isArray(book.offers)
            ? book.offers
            : [];

          const execution =
            simulateBookExecution(
              offers,
              requestedInput
            );

          const averageExecutionRate =
            execution.consumedInput > 0
              ? execution.output / execution.consumedInput
              : 0;

          const firstExecutableOffer =
            offers.find((offer: any) => {
              const gets = amountToNumber(
                offer.taker_gets_funded ??
                offer.TakerGets
              );

              const pays = amountToNumber(
                offer.taker_pays_funded ??
                offer.TakerPays
              );

              return (
                Number.isFinite(gets) &&
                Number.isFinite(pays) &&
                gets > 0 &&
                pays > 0
              );
            });

          const bestRate = firstExecutableOffer
            ? amountToNumber(
                firstExecutableOffer.taker_gets_funded ??
                firstExecutableOffer.TakerGets
              ) /
              amountToNumber(
                firstExecutableOffer.taker_pays_funded ??
                firstExecutableOffer.TakerPays
              )
            : 0;

          const slippagePct =
            execution.completeFill &&
            bestRate > 0 &&
            averageExecutionRate > 0
              ? Math.max(
                  0,
                  ((bestRate - averageExecutionRate) /
                    bestRate) * 100
                )
              : execution.completeFill
                ? 0
                : 100;

          return {
            from: fromSymbol,
            to: toSymbol,
            offers,
            execution,
            bestRate,
            averageExecutionRate,
            slippagePct,
            ledgerIndex:
              book.ledger_index ??
              book.ledger_current_index ??
              null
          };
        };

        try {
          if (!from || !to) {
            return new Response(
              JSON.stringify({
                error: "from and to are required."
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json"
                }
              }
            );
          }

          if (from === to) {
            return new Response(
              JSON.stringify({
                error: "from and to must be different assets."
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json"
                }
              }
            );
          }

          const supported =
            new Set(["RLUSD", "USDC", "XRP"]);

          if (
            !supported.has(from) ||
            !supported.has(to)
          ) {
            return new Response(
              JSON.stringify({
                error:
                  "stablecoin-route supports RLUSD, USDC, and XRP."
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json"
                }
              }
            );
          }

          const isStablecoinPair =
            ["RLUSD", "USDC"].includes(from) &&
            ["RLUSD", "USDC"].includes(to);

          const direct =
            await analyzeBookRoute(
              from,
              to,
              inputAmount
            );

          const evaluatedRoutes: any[] = [];

          evaluatedRoutes.push({
            type: "direct",
            path: [from, to],
            expected_output: direct.execution.output,
            complete_fill: direct.execution.completeFill,
            visible_offer_count: direct.offers.length,
            best_rate: direct.bestRate,
            average_execution_rate:
              direct.averageExecutionRate,
            estimated_slippage_pct:
              direct.slippagePct
          });

          let bridged: any = null;

          // For stablecoin-to-stablecoin transfers, also simulate
          // FROM -> XRP -> TO and compare actual execution output.
          if (isStablecoinPair) {
            const firstLeg =
              await analyzeBookRoute(
                from,
                "XRP",
                inputAmount
              );

            if (
              firstLeg.execution.completeFill &&
              firstLeg.execution.output > 0
            ) {
              const secondLeg =
                await analyzeBookRoute(
                  "XRP",
                  to,
                  firstLeg.execution.output
                );

              const bridgeComplete =
                firstLeg.execution.completeFill &&
                secondLeg.execution.completeFill;

              const bridgeOutput =
                bridgeComplete
                  ? secondLeg.execution.output
                  : 0;

              const combinedSlippagePct =
                1 -
                (
                  (1 - firstLeg.slippagePct / 100) *
                  (1 - secondLeg.slippagePct / 100)
                );

              bridged = {
                type: "xrp_bridge",
                path: [from, "XRP", to],
                expected_output: bridgeOutput,
                complete_fill: bridgeComplete,
                first_leg: {
                  expected_output:
                    firstLeg.execution.output,
                  slippage_pct:
                    firstLeg.slippagePct,
                  visible_offer_count:
                    firstLeg.offers.length
                },
                second_leg: {
                  expected_output:
                    secondLeg.execution.output,
                  slippage_pct:
                    secondLeg.slippagePct,
                  visible_offer_count:
                    secondLeg.offers.length
                },
                estimated_slippage_pct:
                  combinedSlippagePct * 100
              };

              evaluatedRoutes.push(bridged);
            }
          }

          // Only complete routes are eligible to win.
          const viableRoutes =
            evaluatedRoutes.filter(
              route =>
                route.complete_fill &&
                route.expected_output > 0
            );

          const recommended =
            viableRoutes.length
              ? viableRoutes.reduce(
                  (best, current) =>
                    current.expected_output >
                    best.expected_output
                      ? current
                      : best
                )
              : evaluatedRoutes[0];

          const expectedOutput =
            recommended?.expected_output ?? 0;

          const slippagePct =
            recommended?.estimated_slippage_pct ?? 100;

          // Stablecoin-to-stablecoin execution can also be compared
          // against nominal 1:1 parity. This is NOT slippage.
          const executionLossVsParityPct =
            isStablecoinPair &&
            inputAmount > 0 &&
            expectedOutput > 0
              ? Math.max(
                  0,
                  ((inputAmount - expectedOutput) /
                    inputAmount) * 100
                )
              : null;

          let signal:
            | "ALLOW"
            | "REVIEW"
            | "ABORT" = "ALLOW";

          const flags: string[] = [];

          if (
            !recommended ||
            !recommended.complete_fill ||
            expectedOutput <= 0
          ) {
            signal = "ABORT";
            flags.push("NO_COMPLETE_ROUTE");
          }

          if (
            recommended &&
            recommended.complete_fill &&
            slippagePct > 1
          ) {
            signal = "REVIEW";
            flags.push("ELEVATED_SLIPPAGE");
          }

          if (
            recommended &&
            recommended.complete_fill &&
            slippagePct > 3
          ) {
            signal = "ABORT";
            flags.push("HIGH_SLIPPAGE");
          }

          if (
            executionLossVsParityPct !== null &&
            executionLossVsParityPct > 0.5
          ) {
            if (signal === "ALLOW") {
              signal = "REVIEW";
            }

            flags.push("PARITY_EXECUTION_LOSS");
          }

          if (
            executionLossVsParityPct !== null &&
            executionLossVsParityPct > 2
          ) {
            signal = "ABORT";
            flags.push("SEVERE_PARITY_EXECUTION_LOSS");
          }

          const result = {
                service:
                  "cloudpayx_stablecoin_route_v1",
                network: "xrpl:0",
                payment_asset: "RLUSD",
                payment_price: "0.01",
                request: {
                  from,
                  to,
                  amount: inputAmount,
                  amount_asset: from,
                  objective
                },
                routes_evaluated:
                  evaluatedRoutes.map((route: any) => ({
                    type: route.type,
                    path: route.path,
                    expected_output:
                      Number(
                        Number(route.expected_output || 0).toFixed(6)
                      ),
                    complete_fill:
                      Boolean(route.complete_fill),
                    visible_offer_count:
                      route.visible_offer_count ?? null,
                    estimated_slippage_pct:
                      Number(
                        Number(
                          route.estimated_slippage_pct || 0
                        ).toFixed(4)
                      )
                  })),

                recommended_route: {
                  type:
                    recommended?.type ?? null,
                  path:
                    recommended?.path ?? [],
                  complete_fill:
                    Boolean(
                      recommended?.complete_fill
                    )
                },

                execution: {
                  requested_input:
                    inputAmount,
                  input_asset:
                    from,
                  expected_output:
                    Number(
                      expectedOutput.toFixed(6)
                    ),
                  output_asset:
                    to,
                  estimated_slippage_pct:
                    Number(
                      slippagePct.toFixed(4)
                    ),
                  execution_loss_vs_parity_pct:
                    executionLossVsParityPct === null
                      ? null
                      : Number(
                          executionLossVsParityPct.toFixed(4)
                        )
                },
                decision: {
                  signal,
                  flags
                },
                ledger_index:
                  direct?.ledgerIndex ??
                  null,
                generated_at:
                  new Date().toISOString()
              };

          const report = createReport(
            "cloudpayx_stablecoin_route_v1",
            "1.0",
            "xrpl:0",
            result
          );

          const responseBody = {
            ...result,
            report
          };

          return new Response(
            JSON.stringify(responseBody, null, 2),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
              }
            }
          );
        } catch (error: any) {
          console.error(
            "stablecoin-route error:",
            error
          );

          return new Response(
            JSON.stringify({
              error: "Stablecoin route analysis failed.",
              reason:
                error?.message || "unknown_error"
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );
        }
      }

      if (
        url.pathname === "/agent/v3/asset-analysis"
      ) {
        try {
          const xrplClient =
            createXRPLHTTPClient(
              "https://s1.ripple.com:51234/"
            );

          const result =
            await analyzeXRPLAssetV3(
              xrplClient,
              body
            );

          const report = createReport(
            "cloudpayx_asset_analysis_v3",
            "3.0",
            "xrpl:0",
            result
          );

          return new Response(
            JSON.stringify(
              {
                ...result,
                report
              },
              null,
              2
            ),
            {
              status: 200,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );
        } catch (error: any) {
          const inputError =
            error instanceof
              XRPLAssetResolutionError ||
            (
              error instanceof Error &&
              (
                error.message.includes(
                  "ledger_index"
                ) ||
                error.message.includes(
                  "holder"
                ) ||
                error.message.includes(
                  "offer_limit"
                )
              )
            );

          const rpcError =
            error instanceof
              XRPLRPCError;

          const status =
            inputError
              ? 400
              : rpcError
                ? 502
                : 500;

          console.error(
            "asset-analysis-v3 error:",
            error
          );

          return new Response(
            JSON.stringify({
              success: false,
              service:
                "cloudpayx_asset_analysis_v3",
              version: "3.0",
              error:
                inputError
                  ? "INVALID_REQUEST"
                  : rpcError
                    ? "XRPL_RPC_ERROR"
                    : "ANALYSIS_FAILED",
              reason:
                inputError
                  ? error.message
                  : rpcError
                    ? error.code
                    : "Asset analysis could not be completed."
            }),
            {
              status,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );
        }
      }

      if (
        url.pathname === "/agent/token-analysis" ||
        url.pathname === "/internal/token-analysis"
      ) {
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

          const result = {
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
          };

          const report = createReport(
            "token_analysis",
            "2.1",
            "xrpl:0",
            result
          );

          const responseBody = {
            ...result,
            report
          };

          return new Response(
            JSON.stringify(responseBody, null, 2),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
              }
            }
          );

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



      if (
        url.pathname === "/agent/v3/risk-check"
      ) {
        try {
          const xrplClient =
            createXRPLHTTPClient(
              "https://xrplcluster.com/"
            );

          const result =
            await assessXRPLRiskV3(
              xrplClient,
              body
            );

          const report = createReport(
            "cloudpayx_risk_check_v3",
            "3.0",
            "xrpl:0",
            result
          );

          return new Response(
            JSON.stringify(
              {
                ...result,
                report
              },
              null,
              2
            ),
            {
              status: 200,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );
        } catch (error: any) {
          const message =
            error instanceof Error
              ? error.message
              : "";

          const inputError =
            error instanceof
              XRPLAssetResolutionError ||
            [
              "intent must be",
              "amount must be",
              "asset is required",
              "to asset is required",
              "assets must differ"
            ].some(
              fragment =>
                message.includes(
                  fragment
                )
            );

          const rpcError =
            error instanceof
              XRPLRPCError;

          const status =
            inputError
              ? 400
              : rpcError
                ? 502
                : 500;

          console.error(
            "risk-check-v3 error:",
            error
          );

          return new Response(
            JSON.stringify({
              success: false,
              service:
                "cloudpayx_risk_check_v3",
              version: "3.0",
              error:
                inputError
                  ? "INVALID_REQUEST"
                  : rpcError
                    ? "XRPL_RPC_ERROR"
                    : "RISK_ANALYSIS_FAILED",
              reason:
                inputError
                  ? message
                  : rpcError
                    ? error.code
                    : "Risk analysis could not be completed."
            }),
            {
              status,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );
        }
      }

      if (url.pathname === "/agent/risk-check") {
        try {
          const from = String(body.from || "XRP")
            .trim()
            .toUpperCase();

          const to = String(body.to || "RLUSD")
            .trim()
            .toUpperCase();

          const amountRaw = Number(body.amount ?? 100);

          const amount =
            Number.isFinite(amountRaw) && amountRaw > 0
              ? amountRaw
              : 100;

          const supportedAssets =
            new Set(["XRP", "RLUSD", "USDC"]);

          if (
            !supportedAssets.has(from) ||
            !supportedAssets.has(to) ||
            from === to
          ) {
            return new Response(
              JSON.stringify({
                success: false,
                service: "cloudpayx_risk_check_v2",
                error: "unsupported_pair",
                message:
                  "Risk Check V2 currently supports XRP, RLUSD and USDC pairs."
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json"
                }
              }
            );
          }

          const normalizeRiskCurrency = (
            symbol: string
          ): string => {
            if (symbol === "XRP") return "XRP";
            if (symbol === "RLUSD") return RLUSD_ASSET;
            if (symbol === "USDC") return USDC_ASSET;

            throw new Error(
              `unsupported_risk_asset:${symbol}`
            );
          };

          const getRiskIssuer = (
            symbol: string
          ): string | null => {
            if (symbol === "RLUSD") return RLUSD_ISSUER;
            if (symbol === "USDC") return USDC_ISSUER;
            return null;
          };

          const riskAssetObject = (
            symbol: string
          ) => {
            if (symbol === "XRP") {
              return { currency: "XRP" };
            }

            const issuer = getRiskIssuer(symbol);

            if (!issuer) {
              throw new Error(
                `issuer_not_configured:${symbol}`
              );
            }

            return {
              currency: normalizeRiskCurrency(symbol),
              issuer
            };
          };

          const riskRpc = async (
            method: string,
            params: Record<string, any>
          ) => {
            const response = await fetch(
              "https://xrplcluster.com/",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  method,
                  params: [params]
                })
              }
            );

            if (!response.ok) {
              throw new Error(
                `xrpl_http_${response.status}`
              );
            }

            const json: any =
              await response.json();

            if (json?.result?.status !== "success") {
              throw new Error(
                json?.result?.error ||
                json?.result?.error_message ||
                "xrpl_rpc_failed"
              );
            }

            return json.result;
          };

          const riskAmountToNumber = (
            value: any
          ): number => {
            if (typeof value === "string") {
              return Number(value) / 1_000_000;
            }

            if (
              value &&
              typeof value === "object" &&
              value.value !== undefined
            ) {
              return Number(value.value);
            }

            return 0;
          };

          // -------------------------------------------------------
          // NETWORK RISK
          // -------------------------------------------------------

          const server = await riskRpc(
            "server_info",
            {}
          );

          const info = server?.info || {};
          const validated =
            info?.validated_ledger || {};

          const ledgerIndex =
            validated?.seq ?? null;

          const ledgerAge =
            Number.isFinite(Number(validated?.age))
              ? Number(validated.age)
              : 999;

          const loadFactor =
            Number.isFinite(Number(info?.load_factor))
              ? Number(info.load_factor)
              : 999;

          let networkRiskScore = 0;
          const networkFlags: string[] = [];

          if (ledgerAge > 20) {
            networkRiskScore += 40;
            networkFlags.push("STALE_LEDGER");
          } else if (ledgerAge > 10) {
            networkRiskScore += 20;
            networkFlags.push("LEDGER_DELAY");
          }

          if (loadFactor > 4) {
            networkRiskScore += 35;
            networkFlags.push("HIGH_NETWORK_LOAD");
          } else if (loadFactor > 2) {
            networkRiskScore += 15;
            networkFlags.push(
              "ELEVATED_NETWORK_LOAD"
            );
          }

          networkRiskScore =
            Math.min(networkRiskScore, 100);

          // -------------------------------------------------------
          // ISSUER RISK
          // -------------------------------------------------------

          const issuerResults: any[] = [];
          let assetRiskScore = 0;
          const assetFlags: string[] = [];

          for (const symbol of [from, to]) {
            if (symbol === "XRP") continue;

            const issuer =
              getRiskIssuer(symbol);

            if (!issuer) continue;

            const issuerInfo = await riskRpc(
              "account_info",
              {
                account: issuer,
                ledger_index: "validated"
              }
            );

            const account =
              issuerInfo?.account_data || {};

            const accountFlags =
              issuerInfo?.account_flags || {};

            const requireAuthorization =
              Boolean(
                accountFlags?.requireAuthorization
              );

            const globalFreeze =
              Boolean(
                accountFlags?.globalFreeze
              );

            const noFreeze =
              Boolean(
                accountFlags?.noFreeze
              );

            const clawbackEnabled =
              Boolean(
                accountFlags?.allowTrustLineClawback
              );

            let issuerScore = 0;
            const issuerFlags: string[] = [];

            if (globalFreeze) {
              issuerScore += 70;
              issuerFlags.push(
                "GLOBAL_FREEZE_ENABLED"
              );
            }

            if (requireAuthorization) {
              issuerScore += 15;
              issuerFlags.push(
                "AUTHORIZATION_REQUIRED"
              );
            }

            if (clawbackEnabled) {
              issuerScore += 10;
              issuerFlags.push(
                "CLAWBACK_ENABLED"
              );
            }

            issuerScore =
              Math.min(issuerScore, 100);

            assetRiskScore =
              Math.max(
                assetRiskScore,
                issuerScore
              );

            assetFlags.push(
              ...issuerFlags.map(
                flag => `${symbol}_${flag}`
              )
            );

            issuerResults.push({
              asset: symbol,
              address: issuer,
              validated: true,
              owner_count:
                account?.OwnerCount ?? null,
              flags: {
                require_authorization:
                  requireAuthorization,
                global_freeze:
                  globalFreeze,
                no_freeze:
                  noFreeze,
                clawback_enabled:
                  clawbackEnabled
              },
              risk_score: issuerScore
            });
          }

          // -------------------------------------------------------
          // EXECUTION + LIQUIDITY RISK
          // -------------------------------------------------------

          const fromAsset =
            riskAssetObject(from);

          const toAsset =
            riskAssetObject(to);

          const book = await riskRpc(
            "book_offers",
            {
              taker_gets: toAsset,
              taker_pays: fromAsset,
              ledger_index: "validated",
              limit: 200
            }
          );

          const offers =
            Array.isArray(book?.offers)
              ? book.offers
              : [];

          let remaining = amount;
          let output = 0;
          let consumedInput = 0;
          let executableOffers = 0;
          let bestRate = 0;

          for (const offer of offers) {
            if (remaining <= 0) break;

            const gets =
              riskAmountToNumber(
                offer.taker_gets_funded ??
                offer.TakerGets
              );

            const pays =
              riskAmountToNumber(
                offer.taker_pays_funded ??
                offer.TakerPays
              );

            if (
              !Number.isFinite(gets) ||
              !Number.isFinite(pays) ||
              gets <= 0 ||
              pays <= 0
            ) {
              continue;
            }

            const rate = gets / pays;

            if (
              bestRate === 0 ||
              rate > bestRate
            ) {
              bestRate = rate;
            }

            executableOffers += 1;

            const takeInput =
              Math.min(
                remaining,
                pays
              );

            output +=
              takeInput * rate;

            consumedInput +=
              takeInput;

            remaining -=
              takeInput;
          }

          const completeFill =
            remaining <= 0.0000001;

          const averageExecutionRate =
            consumedInput > 0
              ? output / consumedInput
              : 0;

          const slippagePct =
            completeFill &&
            bestRate > 0 &&
            averageExecutionRate > 0
              ? Math.max(
                  0,
                  (
                    (
                      bestRate -
                      averageExecutionRate
                    ) /
                    bestRate
                  ) * 100
                )
              : completeFill
                ? 0
                : 100;

          let liquidityRiskScore = 0;
          const liquidityFlags: string[] = [];

          if (offers.length === 0) {
            liquidityRiskScore = 100;
            liquidityFlags.push(
              "NO_VISIBLE_LIQUIDITY"
            );
          } else if (!completeFill) {
            liquidityRiskScore = 90;
            liquidityFlags.push(
              "INSUFFICIENT_DEPTH"
            );
          } else {
            if (executableOffers <= 2) {
              liquidityRiskScore += 25;
              liquidityFlags.push(
                "THIN_VISIBLE_BOOK"
              );
            } else if (executableOffers <= 5) {
              liquidityRiskScore += 10;
              liquidityFlags.push(
                "LIMITED_VISIBLE_BOOK"
              );
            }
          }

          let executionRiskScore = 0;
          const executionFlags: string[] = [];

          if (!completeFill) {
            executionRiskScore = 100;
            executionFlags.push(
              "INCOMPLETE_FILL"
            );
          } else if (slippagePct > 10) {
            executionRiskScore = 100;
            executionFlags.push(
              "EXTREME_SLIPPAGE"
            );
          } else if (slippagePct > 3) {
            executionRiskScore = 80;
            executionFlags.push(
              "HIGH_SLIPPAGE"
            );
          } else if (slippagePct > 1) {
            executionRiskScore = 45;
            executionFlags.push(
              "ELEVATED_SLIPPAGE"
            );
          } else if (slippagePct > 0.25) {
            executionRiskScore = 20;
            executionFlags.push(
              "MEASURABLE_SLIPPAGE"
            );
          }

          // -------------------------------------------------------
          // COMPOSITE CLOUDPAYX RISK SCORE
          // -------------------------------------------------------

          const weightedRisk =
            networkRiskScore * 0.20 +
            assetRiskScore * 0.20 +
            liquidityRiskScore * 0.25 +
            executionRiskScore * 0.35;

          let riskScore =
            Math.round(weightedRisk);

          // Critical conditions override weighted averaging.
          if (
            !completeFill ||
            liquidityRiskScore >= 90 ||
            executionRiskScore >= 100 ||
            assetRiskScore >= 70 ||
            networkRiskScore >= 70
          ) {
            riskScore =
              Math.max(riskScore, 80);
          }

          riskScore =
            Math.min(
              100,
              Math.max(0, riskScore)
            );

          const riskLevel =
            riskScore < 25
              ? "LOW"
              : riskScore < 50
                ? "MODERATE"
                : riskScore < 80
                  ? "HIGH"
                  : "CRITICAL";

          let signal:
            | "ALLOW"
            | "REVIEW"
            | "ABORT";

          if (riskScore >= 80) {
            signal = "ABORT";
          } else if (riskScore >= 25) {
            signal = "REVIEW";
          } else {
            signal = "ALLOW";
          }

          const allFlags = [
            ...networkFlags,
            ...assetFlags,
            ...liquidityFlags,
            ...executionFlags
          ];

          const result = {
            success: true,
            service:
              "cloudpayx_risk_check_v2",
                version: "2.0",
                network: "xrpl:0",

                request: {
                  from,
                  to,
                  amount,
                  amount_asset: from
                },

                risk: {
                  score: riskScore,
                  max_score: 100,
                  level: riskLevel
                },

                dimensions: {
                  network: {
                    score:
                      networkRiskScore,
                    level:
                      networkRiskScore < 25
                        ? "LOW"
                        : networkRiskScore < 50
                          ? "MODERATE"
                          : networkRiskScore < 80
                            ? "HIGH"
                            : "CRITICAL"
                  },

                  asset: {
                    score:
                      assetRiskScore,
                    level:
                      assetRiskScore < 25
                        ? "LOW"
                        : assetRiskScore < 50
                          ? "MODERATE"
                          : assetRiskScore < 80
                            ? "HIGH"
                            : "CRITICAL"
                  },

                  liquidity: {
                    score:
                      liquidityRiskScore,
                    level:
                      liquidityRiskScore < 25
                        ? "LOW"
                        : liquidityRiskScore < 50
                          ? "MODERATE"
                          : liquidityRiskScore < 80
                            ? "HIGH"
                            : "CRITICAL"
                  },

                  execution: {
                    score:
                      executionRiskScore,
                    level:
                      executionRiskScore < 25
                        ? "LOW"
                        : executionRiskScore < 50
                          ? "MODERATE"
                          : executionRiskScore < 80
                            ? "HIGH"
                            : "CRITICAL"
                  }
                },

                issuer_analysis:
                  issuerResults,

                liquidity: {
                  visible_offer_count:
                    offers.length,
                  executable_offer_count:
                    executableOffers,
                  complete_fill:
                    completeFill
                },

                execution: {
                  requested_input:
                    amount,
                  consumed_input:
                    Number(
                      consumedInput.toFixed(6)
                    ),
                  expected_output:
                    Number(
                      output.toFixed(6)
                    ),
                  best_rate:
                    Number(
                      bestRate.toFixed(10)
                    ),
                  average_execution_rate:
                    Number(
                      averageExecutionRate.toFixed(10)
                    ),
                  estimated_slippage_pct:
                    Number(
                      slippagePct.toFixed(4)
                    )
                },

                network_state: {
                  ledger_index:
                    ledgerIndex,
                  ledger_age_seconds:
                    ledgerAge,
                  load_factor:
                    loadFactor,
                  base_fee_xrp:
                    validated?.base_fee_xrp ??
                    null
                },

                decision: {
                  signal,
                  flags: allFlags,
                  rules: {
                    allow_score_below: 25,
                    review_score_below: 80,
                    abort_score_at_or_above: 80,
                    elevated_slippage_pct: 1,
                    high_slippage_pct: 3,
                    extreme_slippage_pct: 10,
                    ledger_age_max_seconds: 10,
                    load_factor_max: 2
                  }
                },

                sources: [
                  "XRPL validated server_info",
                  "XRPL validated account_info",
                  "XRPL validated book_offers"
                ],

            generated_at:
              new Date().toISOString()
          };

          const report = createReport(
            "cloudpayx_risk_check_v2",
            "2.0",
            "xrpl:0",
            result
          );

          const responseBody = {
            ...result,
            report
          };

          return new Response(
            JSON.stringify(responseBody, null, 2),
            {
              status: 200,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );

        } catch (error: any) {
          console.error(
            "risk-check error:",
            error
          );

          return new Response(
            JSON.stringify({
              success: false,
              service:
                "cloudpayx_risk_check_v2",
              version: "2.0",
              network: "xrpl:0",
              error:
                "xrpl_risk_analysis_unavailable",
              reason:
                error?.message ||
                "unknown_error",
              generated_at:
                new Date().toISOString()
            }),
            {
              status: 503,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );
        }
      }

      if (url.pathname === "/agent/ledger-status") {
        try {
          const rpcResponse = await fetch("https://s1.ripple.com:51234/", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              method: "server_info",
              params: [{}]
            })
          });

          if (!rpcResponse.ok) {
            throw new Error(`xrpl_http_${rpcResponse.status}`);
          }

          const rpc: any = await rpcResponse.json();
          const info = rpc?.result?.info || {};
          const validated = info?.validated_ledger || {};

          const ledgerIndex =
            validated?.seq ?? null;

          const ledgerAge =
            Number.isFinite(Number(validated?.age))
              ? Number(validated.age)
              : null;

          const loadFactor =
            Number.isFinite(Number(info?.load_factor))
              ? Number(info.load_factor)
              : null;

          const loadFactorServer =
            Number.isFinite(Number(info?.load_factor_server))
              ? Number(info.load_factor_server)
              : null;

          const baseFeeXrp =
            validated?.base_fee_xrp ?? null;

          const reserveBaseXrp =
            validated?.reserve_base_xrp ?? null;

          const reserveIncrementXrp =
            validated?.reserve_inc_xrp ?? null;

          const serverState =
            info?.server_state ?? null;

          const peers =
            Number.isFinite(Number(info?.peers))
              ? Number(info.peers)
              : null;

          const uptimeSeconds =
            Number.isFinite(Number(info?.uptime))
              ? Number(info.uptime)
              : null;

          const validatedLedgerAvailable =
            rpc?.result?.status === "success" &&
            ledgerIndex !== null;

          const ledgerFresh =
            ledgerAge !== null &&
            ledgerAge <= 10;

          const loadNormal =
            loadFactor !== null &&
            loadFactor <= 2;

          const flags: string[] = [];

          if (!validatedLedgerAvailable) {
            flags.push("NO_VALIDATED_LEDGER");
          }

          if (ledgerAge === null) {
            flags.push("LEDGER_AGE_UNKNOWN");
          } else if (ledgerAge > 20) {
            flags.push("STALE_LEDGER");
          } else if (ledgerAge > 10) {
            flags.push("LEDGER_DELAY");
          }

          if (loadFactor === null) {
            flags.push("LOAD_FACTOR_UNKNOWN");
          } else if (loadFactor > 4) {
            flags.push("HIGH_NETWORK_LOAD");
          } else if (loadFactor > 2) {
            flags.push("ELEVATED_NETWORK_LOAD");
          }

          if (
            serverState &&
            !["full", "proposing", "validating"].includes(
              String(serverState).toLowerCase()
            )
          ) {
            flags.push("SERVER_STATE_CAUTION");
          }

          let signal: "ALLOW" | "REVIEW" | "ABORT" = "ALLOW";

          const abortFlags = new Set([
            "NO_VALIDATED_LEDGER",
            "STALE_LEDGER",
            "HIGH_NETWORK_LOAD"
          ]);

          if (flags.some(flag => abortFlags.has(flag))) {
            signal = "ABORT";
          } else if (flags.length > 0) {
            signal = "REVIEW";
          }

          const health =
            signal === "ALLOW"
              ? "HEALTHY"
              : signal === "REVIEW"
                ? "CAUTION"
                : "UNHEALTHY";

          const feePressure =
            loadFactor === null
              ? "UNKNOWN"
              : loadFactor <= 1.25
                ? "LOW"
                : loadFactor <= 2
                  ? "NORMAL"
                  : loadFactor <= 4
                    ? "ELEVATED"
                    : "HIGH";

          const freshness =
            ledgerAge === null
              ? "UNKNOWN"
              : ledgerAge <= 5
                ? "FRESH"
                : ledgerAge <= 10
                  ? "ACCEPTABLE"
                  : ledgerAge <= 20
                    ? "DELAYED"
                    : "STALE";

          const result = {
            success: true,
            service: "cloudpayx_ledger_status_v2",
            version: "2.0",
            network: "xrpl:0",

            ledger: {
              index: ledgerIndex,
              validated: validatedLedgerAvailable,
              age_seconds: ledgerAge
            },

            fees: {
              base_fee_xrp: baseFeeXrp,
              load_factor: loadFactor,
              load_factor_server: loadFactorServer,
              pressure: feePressure
            },

            reserves: {
              base_xrp: reserveBaseXrp,
              increment_xrp: reserveIncrementXrp
            },

            server: {
              state: serverState,
              peers,
              uptime_seconds: uptimeSeconds
            },

            execution_environment: {
              health,
              ledger_freshness: freshness,
              fee_pressure: feePressure,
              safe_to_submit:
                validatedLedgerAvailable &&
                ledgerFresh &&
                loadNormal &&
                signal === "ALLOW"
            },

            decision: {
              signal,
              flags,
              rules: {
                ledger_fresh_seconds_max: 10,
                ledger_stale_seconds_over: 20,
                normal_load_factor_max: 2,
                high_load_factor_over: 4
              }
            },

            sources: [
              "XRPL validated server_info"
            ],

            generated_at: new Date().toISOString()
          };

          const report = createReport(
            "cloudpayx_ledger_status_v2",
            "2.0",
            "xrpl:0",
            result
          );

          const responseBody = {
            ...result,
            report
          };

          return new Response(
            JSON.stringify(responseBody, null, 2),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
              }
            }
          );

        } catch (error: any) {
          console.error(
            "ledger-status error:",
            error
          );

          return new Response(
            JSON.stringify({
              success: false,
              service: "cloudpayx_ledger_status_v2",
              version: "2.0",
              network: "xrpl:0",
              error: "xrpl_ledger_status_unavailable",
              reason:
                error?.message || "unknown_error",
              generated_at:
                new Date().toISOString()
            }),
            {
              status: 503,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
              }
            }
          );
        }
      }

      if (url.pathname === "/agent/arbitrage-check") {
        try {
          const base = String(body.base || body.from || "RLUSD")
            .trim()
            .toUpperCase();

          const quote = String(body.quote || body.to || "USDC")
            .trim()
            .toUpperCase();

          const amountRaw = Number(body.amount ?? 1000);

          const amount =
            Number.isFinite(amountRaw) && amountRaw > 0
              ? amountRaw
              : 1000;

          const supported =
            new Set(["XRP", "RLUSD", "USDC"]);

          if (
            !supported.has(base) ||
            !supported.has(quote) ||
            base === quote
          ) {
            return new Response(
              JSON.stringify({
                success: false,
                service: "cloudpayx_arbitrage_check_v2",
                error: "unsupported_pair",
                message:
                  "Arbitrage Check V2 currently supports XRP, RLUSD and USDC pairs."
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json"
                }
              }
            );
          }

          const normalizeArbCurrency = (
            symbol: string
          ): string => {
            if (symbol === "XRP") return "XRP";
            if (symbol === "RLUSD") return RLUSD_ASSET;
            if (symbol === "USDC") return USDC_ASSET;

            throw new Error(
              `unsupported_arbitrage_asset:${symbol}`
            );
          };

          const getArbIssuer = (
            symbol: string
          ): string | null => {
            if (symbol === "RLUSD") return RLUSD_ISSUER;
            if (symbol === "USDC") return USDC_ISSUER;
            return null;
          };

          const arbAssetObject = (
            symbol: string
          ) => {
            if (symbol === "XRP") {
              return { currency: "XRP" };
            }

            const issuer = getArbIssuer(symbol);

            if (!issuer) {
              throw new Error(
                `issuer_not_configured:${symbol}`
              );
            }

            return {
              currency: normalizeArbCurrency(symbol),
              issuer
            };
          };

          const arbRpc = async (
            method: string,
            params: Record<string, any>
          ) => {
            const response = await fetch(
              "https://xrplcluster.com/",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  method,
                  params: [params]
                })
              }
            );

            if (!response.ok) {
              throw new Error(
                `xrpl_http_${response.status}`
              );
            }

            const json: any =
              await response.json();

            if (json?.result?.status !== "success") {
              throw new Error(
                json?.result?.error ||
                json?.result?.error_message ||
                "xrpl_rpc_failed"
              );
            }

            return json.result;
          };

          const arbAmountToNumber = (
            value: any
          ): number => {
            if (typeof value === "string") {
              return Number(value) / 1_000_000;
            }

            if (
              value &&
              typeof value === "object" &&
              value.value !== undefined
            ) {
              return Number(value.value);
            }

            return 0;
          };

          const simulateArbBook = (
            offers: any[],
            requestedInput: number
          ) => {
            let remaining = requestedInput;
            let output = 0;
            let consumedInput = 0;
            let executableOffers = 0;
            let bestRate = 0;

            for (const offer of offers || []) {
              if (remaining <= 0) break;

              const gets =
                arbAmountToNumber(
                  offer.taker_gets_funded ??
                  offer.TakerGets
                );

              const pays =
                arbAmountToNumber(
                  offer.taker_pays_funded ??
                  offer.TakerPays
                );

              if (
                !Number.isFinite(gets) ||
                !Number.isFinite(pays) ||
                gets <= 0 ||
                pays <= 0
              ) {
                continue;
              }

              const rate = gets / pays;

              if (bestRate === 0 || rate > bestRate) {
                bestRate = rate;
              }

              executableOffers += 1;

              const takeInput =
                Math.min(
                  remaining,
                  pays
                );

              output +=
                takeInput * rate;

              consumedInput +=
                takeInput;

              remaining -=
                takeInput;
            }

            const completeFill =
              remaining <= 0.0000001;

            const averageExecutionRate =
              consumedInput > 0
                ? output / consumedInput
                : 0;

            const slippagePct =
              completeFill &&
              bestRate > 0 &&
              averageExecutionRate > 0
                ? Math.max(
                    0,
                    (
                      (
                        bestRate -
                        averageExecutionRate
                      ) /
                      bestRate
                    ) * 100
                  )
                : completeFill
                  ? 0
                  : 100;

            return {
              output,
              consumedInput,
              executableOffers,
              completeFill,
              bestRate,
              averageExecutionRate,
              slippagePct
            };
          };

          const baseAsset =
            arbAssetObject(base);

          const quoteAsset =
            arbAssetObject(quote);

          const [forwardBook, reverseBook] =
            await Promise.all([
              arbRpc("book_offers", {
                taker_gets: quoteAsset,
                taker_pays: baseAsset,
                ledger_index: "validated",
                limit: 200
              }),

              arbRpc("book_offers", {
                taker_gets: baseAsset,
                taker_pays: quoteAsset,
                ledger_index: "validated",
                limit: 200
              })
            ]);

          const forwardOffers =
            Array.isArray(forwardBook?.offers)
              ? forwardBook.offers
              : [];

          const reverseOffers =
            Array.isArray(reverseBook?.offers)
              ? reverseBook.offers
              : [];

          const forward =
            simulateArbBook(
              forwardOffers,
              amount
            );

          const reverse =
            forward.completeFill &&
            forward.output > 0
              ? simulateArbBook(
                  reverseOffers,
                  forward.output
                )
              : {
                  output: 0,
                  consumedInput: 0,
                  executableOffers: 0,
                  completeFill: false,
                  bestRate: 0,
                  averageExecutionRate: 0,
                  slippagePct: 100
                };

          const roundTripComplete =
            forward.completeFill &&
            reverse.completeFill;

          const finalBaseAmount =
            roundTripComplete
              ? reverse.output
              : 0;

          const grossProfitBase =
            roundTripComplete
              ? finalBaseAmount - amount
              : 0;

          const grossReturnPct =
            roundTripComplete && amount > 0
              ? (
                  grossProfitBase /
                  amount
                ) * 100
              : -100;

          const combinedSlippagePct =
            roundTripComplete
              ? (
                  1 -
                  (
                    (1 - forward.slippagePct / 100) *
                    (1 - reverse.slippagePct / 100)
                  )
                ) * 100
              : 100;

          const MIN_EDGE_PCT = 0.05;

          const opportunityExists =
            roundTripComplete &&
            grossReturnPct > MIN_EDGE_PCT;

          let signal:
            | "ALLOW"
            | "REVIEW"
            | "ABORT" = "ABORT";

          const flags: string[] = [];

          if (!forward.completeFill) {
            flags.push(
              "FORWARD_LEG_INSUFFICIENT_DEPTH"
            );
          }

          if (
            forward.completeFill &&
            !reverse.completeFill
          ) {
            flags.push(
              "REVERSE_LEG_INSUFFICIENT_DEPTH"
            );
          }

          if (
            roundTripComplete &&
            grossReturnPct <= 0
          ) {
            flags.push(
              "NO_POSITIVE_EDGE"
            );
          }

          if (
            roundTripComplete &&
            grossReturnPct > 0 &&
            grossReturnPct <= MIN_EDGE_PCT
          ) {
            flags.push(
              "EDGE_BELOW_THRESHOLD"
            );
          }

          if (
            combinedSlippagePct > 1
          ) {
            flags.push(
              "ELEVATED_ROUND_TRIP_SLIPPAGE"
            );
          }

          if (
            opportunityExists &&
            combinedSlippagePct <= 1
          ) {
            signal = "ALLOW";
          } else if (
            roundTripComplete &&
            grossReturnPct > 0
          ) {
            signal = "REVIEW";
          } else {
            signal = "ABORT";
          }

          const ledgerIndex =
            forwardBook?.ledger_index ??
            forwardBook?.ledger_current_index ??
            reverseBook?.ledger_index ??
            reverseBook?.ledger_current_index ??
            null;

          const result = {
                success: true,
                service:
                  "cloudpayx_arbitrage_check_v2",
                version: "2.0",
                network: "xrpl:0",

                request: {
                  base,
                  quote,
                  amount,
                  amount_asset: base
                },

                cycle: {
                  path: [
                    base,
                    quote,
                    base
                  ],
                  complete:
                    roundTripComplete
                },

                legs: {
                  forward: {
                    path: [base, quote],
                    visible_offer_count:
                      forwardOffers.length,
                    executable_offer_count:
                      forward.executableOffers,
                    complete_fill:
                      forward.completeFill,
                    expected_output:
                      Number(
                        forward.output.toFixed(8)
                      ),
                    best_rate:
                      Number(
                        forward.bestRate.toFixed(10)
                      ),
                    average_execution_rate:
                      Number(
                        forward.averageExecutionRate.toFixed(10)
                      ),
                    estimated_slippage_pct:
                      Number(
                        forward.slippagePct.toFixed(4)
                      )
                  },

                  reverse: {
                    path: [quote, base],
                    visible_offer_count:
                      reverseOffers.length,
                    executable_offer_count:
                      reverse.executableOffers,
                    complete_fill:
                      reverse.completeFill,
                    expected_output:
                      Number(
                        reverse.output.toFixed(8)
                      ),
                    best_rate:
                      Number(
                        reverse.bestRate.toFixed(10)
                      ),
                    average_execution_rate:
                      Number(
                        reverse.averageExecutionRate.toFixed(10)
                      ),
                    estimated_slippage_pct:
                      Number(
                        reverse.slippagePct.toFixed(4)
                      )
                  }
                },

                economics: {
                  starting_amount:
                    amount,
                  final_amount:
                    Number(
                      finalBaseAmount.toFixed(8)
                    ),
                  gross_profit_base:
                    Number(
                      grossProfitBase.toFixed(8)
                    ),
                  gross_return_pct:
                    Number(
                      grossReturnPct.toFixed(6)
                    ),
                  combined_slippage_pct:
                    Number(
                      combinedSlippagePct.toFixed(4)
                    ),
                  minimum_edge_threshold_pct:
                    MIN_EDGE_PCT
                },

                opportunity: {
                  exists:
                    opportunityExists,
                  executable:
                    roundTripComplete
                },

                decision: {
                  signal,
                  flags
                },

                ledger_index:
                  ledgerIndex,

                sources: [
                  "XRPL validated book_offers"
                ],

                generated_at:
                  new Date().toISOString()
              };

          const report = createReport(
            "cloudpayx_arbitrage_check_v2",
            "2.0",
            "xrpl:0",
            result
          );

          const responseBody = {
            ...result,
            report
          };

          return new Response(
            JSON.stringify(responseBody, null, 2),
            {
              status: 200,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );

        } catch (error: any) {
          console.error(
            "arbitrage-check error:",
            error
          );

          return new Response(
            JSON.stringify({
              success: false,
              service:
                "cloudpayx_arbitrage_check_v2",
              version: "2.0",
              network: "xrpl:0",
              error:
                "xrpl_arbitrage_analysis_unavailable",
              reason:
                error?.message ||
                "unknown_error",
              generated_at:
                new Date().toISOString()
            }),
            {
              status: 503,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );
        }
      }


      if (url.pathname === "/agent/repair") {
        try {
          const engineResult = String(
            body.engine_result ??
            body.result ??
            body.error_code ??
            ""
          )
            .trim()
            .toUpperCase();

          const transactionType = String(
            body.transaction_type ??
            body.TransactionType ??
            body.tx?.TransactionType ??
            "UNKNOWN"
          )
            .trim()
            .toUpperCase();

          const suppliedMessage = String(
            body.engine_result_message ??
            body.message ??
            ""
          ).trim();

          if (!engineResult) {
            return new Response(
              JSON.stringify({
                success: false,
                service:
                  "cloudpayx_transaction_repair_v2",
                version: "2.0",
                error: "engine_result_required",
                message:
                  "Supply an XRPL engine result such as tecUNFUNDED_PAYMENT, tecPATH_DRY, tefPAST_SEQ, telINSUF_FEE_P, or terQUEUED.",
                example: {
                  engine_result:
                    "tecUNFUNDED_PAYMENT",
                  transaction_type:
                    "Payment"
                }
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                  "Cache-Control": "no-store"
                }
              }
            );
          }

          type RepairPlan = {
            category: string;
            severity:
              | "LOW"
              | "MODERATE"
              | "HIGH"
              | "CRITICAL";
            diagnosis: string;
            probableCauses: string[];
            recommendedAction: string;
            steps: string[];
            safeToRetry: boolean;
            retryUnchanged: boolean;
            requiresRebuild: boolean;
            requiresResign: boolean;
            submitResultClass: string;
          };

          const defaultPlan: RepairPlan = {
            category: "UNCLASSIFIED_XRPL_RESULT",
            severity: "MODERATE",
            diagnosis:
              "The XRPL engine result is not yet mapped to a specialized CloudPayX repair rule.",
            probableCauses: [
              "The result requires transaction-specific investigation.",
              "Additional transaction or ledger context may be required."
            ],
            recommendedAction:
              "INSPECT_RESULT_AND_TRANSACTION_CONTEXT",
            steps: [
              "Do not repeatedly resubmit the transaction unchanged.",
              "Inspect the full XRPL engine result and transaction fields.",
              "Confirm current validated-ledger state before rebuilding or retrying."
            ],
            safeToRetry: false,
            retryUnchanged: false,
            requiresRebuild: false,
            requiresResign: false,
            submitResultClass: "UNKNOWN"
          };

          const exactRepairs:
            Record<string, RepairPlan> = {

            "TECUNFUNDED_PAYMENT": {
              category:
                "INSUFFICIENT_PAYMENT_FUNDS",
              severity: "HIGH",
              diagnosis:
                "The source account does not have sufficient spendable funds to execute the payment.",
              probableCauses: [
                "Insufficient XRP or issued-asset balance.",
                "Available XRP is constrained by account reserve requirements.",
                "The requested payment amount exceeds currently spendable funds."
              ],
              recommendedAction:
                "FUND_OR_REDUCE_PAYMENT",
              steps: [
                "Check the source account balance and current reserve requirements.",
                "Increase the spendable balance or reduce the payment amount.",
                "Rebuild the transaction with the corrected amount if necessary.",
                "Sign and submit the corrected transaction."
              ],
              safeToRetry: true,
              retryUnchanged: false,
              requiresRebuild: true,
              requiresResign: true,
              submitResultClass: "TEC"
            },

            "TECPATH_DRY": {
              category:
                "LIQUIDITY_PATH_FAILURE",
              severity: "HIGH",
              diagnosis:
                "The requested payment path could not deliver the required destination amount.",
              probableCauses: [
                "Insufficient order-book or path liquidity.",
                "The selected path cannot satisfy the requested amount.",
                "Market conditions changed after the transaction was constructed."
              ],
              recommendedAction:
                "REQUOTE_OR_REDUCE_SIZE",
              steps: [
                "Request fresh path or order-book liquidity.",
                "Recalculate expected execution for the requested amount.",
                "Reduce trade size or select another viable path.",
                "Rebuild and sign the transaction using fresh execution parameters."
              ],
              safeToRetry: true,
              retryUnchanged: false,
              requiresRebuild: true,
              requiresResign: true,
              submitResultClass: "TEC"
            },

            "TECPATH_PARTIAL": {
              category:
                "PARTIAL_PATH_FAILURE",
              severity: "HIGH",
              diagnosis:
                "The payment path could not satisfy the requested delivery conditions in full.",
              probableCauses: [
                "Insufficient liquidity for the requested amount.",
                "Payment delivery constraints are too strict.",
                "The available path changed before execution."
              ],
              recommendedAction:
                "REQUOTE_PAYMENT_PATH",
              steps: [
                "Fetch current path and liquidity conditions.",
                "Review SendMax and delivery constraints.",
                "Reduce size or construct a new route.",
                "Rebuild and re-sign before resubmission."
              ],
              safeToRetry: true,
              retryUnchanged: false,
              requiresRebuild: true,
              requiresResign: true,
              submitResultClass: "TEC"
            },

            "TEFPAST_SEQ": {
              category:
                "STALE_SEQUENCE",
              severity: "MODERATE",
              diagnosis:
                "The transaction sequence is older than the account's current sequence.",
              probableCauses: [
                "Another transaction from the account already consumed the sequence.",
                "The transaction was constructed using stale account state."
              ],
              recommendedAction:
                "REFRESH_SEQUENCE_AND_RESIGN",
              steps: [
                "Fetch the account's current validated Sequence.",
                "Rebuild the transaction with the current sequence.",
                "Re-sign the rebuilt transaction.",
                "Submit the new transaction."
              ],
              safeToRetry: true,
              retryUnchanged: false,
              requiresRebuild: true,
              requiresResign: true,
              submitResultClass: "TEF"
            },

            "TERPRE_SEQ": {
              category:
                "FUTURE_SEQUENCE",
              severity: "MODERATE",
              diagnosis:
                "The transaction sequence is ahead of the sequence currently expected by the account.",
              probableCauses: [
                "An earlier account transaction has not yet validated.",
                "Transactions were submitted out of sequence."
              ],
              recommendedAction:
                "WAIT_OR_RECONCILE_SEQUENCE",
              steps: [
                "Check the account's validated Sequence.",
                "Check whether earlier transactions are pending.",
                "Wait for prerequisite transactions or rebuild with the correct sequence."
              ],
              safeToRetry: true,
              retryUnchanged: true,
              requiresRebuild: false,
              requiresResign: false,
              submitResultClass: "TER"
            },

            "TELINSUF_FEE_P": {
              category:
                "INSUFFICIENT_NETWORK_FEE",
              severity: "MODERATE",
              diagnosis:
                "The transaction fee is below the fee required by the server or current network conditions.",
              probableCauses: [
                "The transaction used a stale fee estimate.",
                "Network load increased after construction."
              ],
              recommendedAction:
                "REFRESH_FEE_AND_RESIGN",
              steps: [
                "Fetch current XRPL fee information.",
                "Set an appropriate transaction Fee.",
                "Re-sign the modified transaction.",
                "Submit the updated transaction."
              ],
              safeToRetry: true,
              retryUnchanged: false,
              requiresRebuild: true,
              requiresResign: true,
              submitResultClass: "TEL"
            },

            "TERQUEUED": {
              category:
                "TRANSACTION_QUEUED",
              severity: "LOW",
              diagnosis:
                "The transaction has been queued for later application rather than rejected.",
              probableCauses: [
                "Current server or network conditions caused the transaction to enter the queue."
              ],
              recommendedAction:
                "WAIT_FOR_VALIDATION",
              steps: [
                "Do not immediately create a duplicate payment.",
                "Monitor the transaction hash and validated ledger.",
                "Only rebuild if the transaction expires or definitively fails."
              ],
              safeToRetry: false,
              retryUnchanged: false,
              requiresRebuild: false,
              requiresResign: false,
              submitResultClass: "TER"
            },

            "TESUCCESS": {
              category:
                "SUCCESS",
              severity: "LOW",
              diagnosis:
                "The XRPL engine result indicates successful application.",
              probableCauses: [],
              recommendedAction:
                "NO_REPAIR_REQUIRED",
              steps: [
                "Confirm the transaction appears in a validated ledger."
              ],
              safeToRetry: false,
              retryUnchanged: false,
              requiresRebuild: false,
              requiresResign: false,
              submitResultClass: "TES"
            }
          };

          let plan =
            exactRepairs[engineResult];

          if (!plan) {
            const prefix =
              engineResult.slice(0, 3);

            const classDefaults:
              Record<string, Partial<RepairPlan>> = {
              TES: {
                category: "SUCCESS",
                severity: "LOW",
                submitResultClass: "TES"
              },
              TEC: {
                category:
                  "CLAIMED_COST_FAILURE",
                severity: "HIGH",
                submitResultClass: "TEC"
              },
              TEF: {
                category:
                  "FINAL_TRANSACTION_FAILURE",
                severity: "HIGH",
                submitResultClass: "TEF"
              },
              TER: {
                category:
                  "RETRYABLE_OR_QUEUED_RESULT",
                severity: "MODERATE",
                submitResultClass: "TER"
              },
              TEL: {
                category:
                  "LOCAL_SERVER_REJECTION",
                severity: "MODERATE",
                submitResultClass: "TEL"
              },
              TEM: {
                category:
                  "MALFORMED_TRANSACTION",
                severity: "HIGH",
                submitResultClass: "TEM"
              }
            };

            const family =
              classDefaults[prefix];

            plan = {
              ...defaultPlan,
              ...(family || {})
            };
          }

          let signal:
            | "ALLOW"
            | "REVIEW"
            | "ABORT";

          if (
            plan.category === "SUCCESS"
          ) {
            signal = "ALLOW";
          } else if (
            plan.severity === "CRITICAL" ||
            plan.severity === "HIGH"
          ) {
            signal = "ABORT";
          } else {
            signal = "REVIEW";
          }

          const flags: string[] = [];

          if (plan.requiresRebuild) {
            flags.push(
              "TRANSACTION_REBUILD_REQUIRED"
            );
          }

          if (plan.requiresResign) {
            flags.push(
              "RESIGN_REQUIRED"
            );
          }

          if (plan.retryUnchanged) {
            flags.push(
              "UNCHANGED_RETRY_POSSIBLE"
            );
          }

          if (
            !exactRepairs[engineResult]
          ) {
            flags.push(
              "GENERIC_RESULT_CLASSIFICATION"
            );
          }

          const result = {
            success: true,
            service:
              "cloudpayx_transaction_repair_v2",
            version: "2.0",
            network: "xrpl:0",

            input: {
              engine_result:
                engineResult,
              transaction_type:
                transactionType,
              engine_result_message:
                suppliedMessage || null
            },

            classification: {
              result_class:
                plan.submitResultClass,
              category:
                plan.category,
              severity:
                plan.severity,
              specialized_rule:
                Boolean(
                  exactRepairs[engineResult]
                )
            },

            diagnosis: {
              summary:
                plan.diagnosis,
              probable_causes:
                plan.probableCauses
            },

            repair: {
              recommended_action:
                plan.recommendedAction,
              steps:
                plan.steps,
              safe_to_retry:
                plan.safeToRetry,
              retry_unchanged:
                plan.retryUnchanged,
              requires_rebuild:
                plan.requiresRebuild,
              requires_resign:
                plan.requiresResign
            },

            decision: {
              signal,
              flags
            },

            confidence: {
              level:
                exactRepairs[engineResult]
                  ? "HIGH"
                  : "MODERATE",
              basis:
                exactRepairs[engineResult]
                  ? "SPECIALIZED_ENGINE_RESULT_RULE"
                  : "XRPL_RESULT_FAMILY_CLASSIFICATION"
            },

            generated_at:
              new Date().toISOString()
          };

          const report = createReport(
            "cloudpayx_transaction_repair_v2",
            "2.0",
            "xrpl:0",
            result
          );

          const responseBody = {
            ...result,
            report
          };

          return new Response(
            JSON.stringify(responseBody, null, 2),
            {
              status: 200,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );

        } catch (error: any) {
          console.error(
            "repair error:",
            error
          );

          return new Response(
            JSON.stringify({
              success: false,
              service:
                "cloudpayx_transaction_repair_v2",
              version: "2.0",
              network: "xrpl:0",
              error:
                "repair_analysis_unavailable",
              reason:
                error?.message ||
                "unknown_error",
              generated_at:
                new Date().toISOString()
            }),
            {
              status: 500,
              headers: {
                "Content-Type":
                  "application/json",
                "Cache-Control":
                  "no-store"
              }
            }
          );
        }
      }

      return new Response(JSON.stringify({ success: true, service: requestedService, telemetry: "active_consensus_stream_synchronized" }), { headers: { "Content-Type": "application/json" } });

    } catch (error) {
      return new Response(JSON.stringify({ error: "Internal Gateway Error" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }
});
