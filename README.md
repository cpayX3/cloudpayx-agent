# cloudpayX Agent

Machine-to-machine XRPL services protected by HTTP 402 payment requirements.

cloudpayX Agent provides lightweight, pay-per-request infrastructure for autonomous agents operating on the XRP Ledger. Services are exposed through a permanent HTTPS API and priced for programmatic consumption.

## Live API

API Base:

`https://api.cloudpayxagent.xyz`

A request to the API root returns the currently available service catalog.

## Available Services

| Service                    | Endpoint                      | Price |
| -------------------------- | ----------------------------- | ----: |
| Arbitrage Optimization     | `POST /agent/arbitrage-check` | $0.02 |
| Volumetric Risk Assessment | `POST /agent/risk-check`      | $0.10 |
| Transaction Repair         | `POST /agent/repair`          | $0.30 |
| Consensus Telemetry        | `POST /agent/ledger-status`   | $0.50 |

### Arbitrage Optimization

`POST /agent/arbitrage-check`

Low-cost XRPL trading utility designed for automated trading and routing systems. Evaluates swap parameters and returns route intelligence intended to help agents evaluate execution conditions and potential slippage.

Price: `$0.02 USD`

### Volumetric Risk Assessment

`POST /agent/risk-check`

Deterministic risk circuit breaker for automated financial workflows. Evaluates supplied market or pool conditions and returns an automation-oriented risk result.

Price: `$0.10 USD`

### Transaction Repair

`POST /agent/repair`

XRPL transaction diagnostic service. Accepts transaction failure information, including XRPL execution result codes, and returns structured diagnostic information for automated recovery workflows.

Price: `$0.30 USD`

### Consensus Telemetry

`POST /agent/ledger-status`

Infrastructure monitoring endpoint providing XRPL ledger and consensus telemetry for autonomous systems requiring current network-state information.

Price: `$0.50 USD`

## HTTP 402 Payment Flow

Protected endpoints return `HTTP 402 Payment Required` when called without valid payment proof.

Example:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"from":"XRP","to":"RLUSD","amount":100}' \
  https://api.cloudpayxagent.xyz/agent/arbitrage-check
```

The resource server responds with payment requirements describing the requested service, payment amount, XRPL network, settlement asset, destination, and request identifier.

Example response characteristics:

```text
HTTP 402 Payment Required
scheme: exact
network: xrpl:0
asset: XRP
price_usd: 0.02
```

After satisfying the applicable payment requirements, the client retries the protected request with valid payment proof.

## Settlement

Primary settlement rail: XRP Ledger

Supported service assets:

* XRP
* RLUSD
* USDC

cloudpayX uses direct XRPL settlement and does not require the service gateway to custody payer funds.

## Architecture

The public API is intentionally lightweight:

```text
Autonomous Agent
      |
      v
api.cloudpayxagent.xyz
      |
      v
HTTP 402 Payment Gate
      |
      v
XRPL Payment Verification
      |
      v
cloudpayX Service
      |
      v
Structured Machine Response
```

The production compute layer is self-hosted and exposed through a secure Cloudflare Tunnel.

## Discovery

Service metadata is available through the repository's x402 and OpenAPI manifests:

* `x402_manifest.json`
* `cloudpayx_openapi.json`
* `xrpl_hub_registration.json`

These files describe the public machine-consumable interface without exposing private operational infrastructure.

## Status

Production API: Live

Protocol: x402 / HTTP 402

Network: XRP Ledger

API Version: 1.1

Permanent Endpoint:

`https://api.cloudpayxagent.xyz`

## Repository

Maintained by cloudpayX.

This repository contains the public service interface, protocol metadata, and integration resources for cloudpayX Agent. Internal discovery systems, automation infrastructure, credentials, and operational tooling are intentionally excluded.
