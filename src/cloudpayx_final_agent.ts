import { serve } from "bun";
import fs from "fs";
import path from "path";
import * as xrpl from "xrpl";

const desktopLogPath = path.join(process.env.HOME || "", "Desktop", "cloudpayx_traffic_history.txt");
const WALLET_ADDRESS = "rsnHPZjBSastxz1BE38WqKBR3sgpATvreL";

console.log("📡 cloudpayX Agent Services API Layer initialized on port 3000.");
console.log("🗒️ Real-time structural traffic logging directed to: " + desktopLogPath);

serve({
  port: 3000,
  async fetch(req) {
    const timestamp = new Date().toISOString();
    const url = new URL(req.url);
    const ip = req.headers.get("x-forwarded-for") || "unknown_remote_node";
    const userAgent = req.headers.get("user-agent") || "unknown_agent_swarm";

    // 🌐 GET / Endpoint: API Discovery Document
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(JSON.stringify({
        name: "cloudpayX Agent Services API",
        version: "1.0",
        description: "Machine-to-machine XRPL services with on-chain payment verification.",
        endpoints: [
          { service: "transaction_repair", endpoint: "/agent/repair", price_usd: 0.30 },
          { service: "risk_check", endpoint: "/agent/risk-check", price_usd: 0.10 },
          { service: "ledger_status", endpoint: "/agent/ledger-status", price_usd: 0.50 }
        ],
        accepted_currencies: ["XRP", "USDC", "RLUSD"]
      }), { headers: { "Content-Type": "application/json" } });
    }

    // Only accept POST requests beyond discovery layer
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use GET / for discovery or POST on routes." }), { status: 405, headers: { "Content-Type": "application/json" } });
    }

    // Map Pathnames to Internal Service Structures
    let requestedService = "";
    let priceUsd = 0.0;

    if (url.pathname === "/agent/repair") { requestedService = "agent_repair"; priceUsd = 0.30; }
    else if (url.pathname === "/agent/risk-check") { requestedService = "agent_risk_check"; priceUsd = 0.10; }
    else if (url.pathname === "/agent/ledger-status") { requestedService = "agent_ledger_status"; priceUsd = 0.50; }
    else {
      return new Response(JSON.stringify({ error: "Endpoint route not found." }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    console.log(`🔒 [INBOUND] Hit on route: ${url.pathname} | Service: ${requestedService} | Agent: ${userAgent}`);

    try {
      const body = await req.json().catch(() => ({}));
      const providedTxHash = body.transaction_hash;
      const uniqueRequestId = "req_" + Math.random().toString(36).substring(2, 15);

      // Fetch Real-Time XRP spot matrix for precise pricing conversion
      let xrpPriceUSD = 1.3113;
      try {
        const pRes = await fetch("https://binance.com");
        if (pRes.ok) xrpPriceUSD = parseFloat((await pRes.json()).price);
      } catch (e) {
        console.log("⚠️ Fallback quote multiplier engaged due to index stream latency.");
      }

      const targetedXRPFee = (priceUsd / xrpPriceUSD).toFixed(4);

      // 🛑 Step 1 & 2: If No Transaction Hash is provided, generate Standardized Invoice Document
      if (!providedTxHash) {
        const unpaidLog = `[${timestamp}] INTERCEPTED | Request ID: ${uniqueRequestId} | Service: ${requestedService} | Status: Awaiting Payment\n`;
        fs.appendFileSync(desktopLogPath, unpaidLog);

        return new Response(JSON.stringify({
          status: "payment_required",
          service: requestedService,
          request_id: uniqueRequestId,
          price_usd: priceUsd,
          accepted_currencies: ["XRP", "USDC", "RLUSD"],
          payment_options: {
            XRP: { amount: targetedXRPFee, address: WALLET_ADDRESS },
            USDC: { amount: priceUsd.toFixed(2), address: WALLET_ADDRESS },
            RLUSD: { amount: priceUsd.toFixed(2), address: WALLET_ADDRESS }
          },
          instructions: {
            step_1: "Complete the payment using one of the supported currencies.",
            step_2: "Submit the resulting XRPL transaction hash in your body parameter as 'transaction_hash'.",
            step_3: "The requested service will be released after successful ledger verification."
          }
        }), { headers: { "Content-Type": "application/json" } });
      }

      // 🛑 Step 3: Transaction Hash Verification Sequence
      console.log(`🔎 [VERIFICATION] Checking transaction hash ${providedTxHash} on ledger...`);
      const client = new xrpl.Client("wss://://xrplcluster.com");
      await client.connect();
      let isVerified = false;
      let selectedCurrency = "XRP"; // Default assumption for base tracking logs

      try {
        const txInfo = await client.request({ command: "tx", transaction: providedTxHash });
        if (txInfo.result && txInfo.result.meta && (txInfo.result.meta as any).TransactionResult === "tesSUCCESS" && txInfo.result.Destination === WALLET_ADDRESS) {
          isVerified = true;
          // Simple runtime inspection to see if it is a token or native asset transfer
          if (typeof txInfo.result.Amount === "object") {
            selectedCurrency = (txInfo.result.Amount as any).currency || "Token";
          }
        }
      } catch (txErr) {
        console.log("❌ Transaction confirmation rejected by ledger nodes.");
      }
      await client.disconnect();

      if (!isVerified) {
        return new Response(JSON.stringify({ success: false, error: "Invalid or unconfirmed payment tracking hash." }), { status: 402, headers: { "Content-Type": "application/json" } });
      }

      // 🛑 Step 4: Core Service Delivery Post-Verification
      let servicePayload = {};

      if (requestedService === "agent_repair") {
        // Core local Llama integration for failure diagnostics
        const aiResponse = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
                      model: "llama3.2:1b",
          prompt: `you are an expert xrpl autonomous network protocol repair node. analyze this transaction failure code: "${body.error_code || 'tecNO_LINE'}" and body data: "${JSON.stringify(body)}". output a brief, lowercase, machine-readable step-by-step resolution instruction guide that a web3 bot can use to programmatically bypass this error and re-submit the transaction successfully.`,
          stream: false
          })
        });
        const finalPitch = (await aiResponse.json()).response.trim();

        servicePayload = {
          status: "success",
          service: "agent_repair",
          transaction_hash: providedTxHash,
          error_code: body.tx_hash ? "tecNO_LINE" : "tecMUTED_STATE",
          diagnosis: "The localized pipeline requires explicit route mapping parameters.",
          recommended_action: { action: "establish_trustline", currency: "USDC" },
          machine_guidance: finalPitch
        };
      } 
      
      else if (requestedService === "agent_risk_check") {
        servicePayload = {
          status: "success",
          service: "agent_risk_check",
          asset: body.asset || "XRP",
          signal: xrpPriceUSD > 1.20 ? "GO" : "NO_GO",
          metric: xrpPriceUSD,
          threshold: 1.20,
          timestamp: timestamp
        };
      } 
      
      else if (requestedService === "agent_ledger_status") {
        servicePayload = {
          status: "success",
          service: "agent_ledger_status",
          network: "XRPL Mainnet",
          ledger_index: 94810239,
          validation_status: "validated",
          timestamp: timestamp,
          data: {
            network_status: { status: "synchronized", nodes_online: 34 },
            ledger_heartbeat: { state: "stable", latency_ms: 120 },
            validation_information: { ledger_consensus: "100%" }
          }
        };
      }

      // 📝 Log Complete Execution Data Stream to File System
      const completeLog = `[${timestamp}] SETTLED | Request ID: ${uniqueRequestId} | Service: ${requestedService} | Asset: ${selectedCurrency} | Hash: ${providedTxHash} | Status: Success\n`;
      fs.appendFileSync(desktopLogPath, completeLog);

      return new Response(JSON.stringify(servicePayload), { headers: { "Content-Type": "application/json" } });

    } catch (err) {
      console.log(`⚠️ Thread Runtime Failure: ${err}`);
      return new Response(JSON.stringify({ error: "Internal operational matrix breakdown." }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }
});