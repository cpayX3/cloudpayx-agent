export type XRPLRepairSignal =
  | "ALLOW"
  | "REVIEW"
  | "ABORT";

export type XRPLRepairSeverity =
  | "LOW"
  | "MODERATE"
  | "HIGH"
  | "CRITICAL";

export type XRPLRepairRequest = {
  engine_result?: unknown;
  result?: unknown;
  error_code?: unknown;
  engine_result_message?: unknown;
  message?: unknown;
  transaction_type?: unknown;
  TransactionType?: unknown;
  tx?: Record<string, unknown>;
  validated?: unknown;
};

export type XRPLRepairPlan = {
  category: string;
  severity: XRPLRepairSeverity;
  diagnosis: string;
  probable_causes: string[];
  recommended_action: string;
  steps: string[];
  safe_to_retry: boolean;
  retry_unchanged: boolean;
  requires_rebuild: boolean;
  requires_resign: boolean;
};

type ExactRule = Omit<
  XRPLRepairPlan,
  "safe_to_retry"
> & {
  safe_to_retry?: boolean;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function resultClass(
  engineResult: string
): string {
  return engineResult.slice(0, 3);
}

function transactionFamily(
  transactionType: string
): string {
  if (transactionType === "PAYMENT") {
    return "PAYMENT";
  }

  if (
    transactionType === "OFFERCREATE" ||
    transactionType === "OFFERCANCEL"
  ) {
    return "DEX_OFFER";
  }

  if (transactionType.startsWith("AMM")) {
    return "AMM";
  }

  if (transactionType.startsWith("MPTOKEN")) {
    return "MPT";
  }

  if (transactionType.startsWith("NFTOKEN")) {
    return "NFT";
  }

  if (transactionType === "TRUSTSET") {
    return "TRUST_LINE";
  }

  if (transactionType.startsWith("ESCROW")) {
    return "ESCROW";
  }

  if (transactionType.startsWith("CHECK")) {
    return "CHECK";
  }

  if (transactionType.startsWith("PAYMENTCHANNEL")) {
    return "PAYMENT_CHANNEL";
  }

  if (transactionType.startsWith("DEPOSITPREAUTH")) {
    return "DEPOSIT_PREAUTH";
  }

  if (transactionType === "SIGNERLISTSET") {
    return "SIGNER_LIST";
  }

  if (transactionType === "TICKETCREATE") {
    return "TICKET";
  }

  if (transactionType === "CLAWBACK") {
    return "CLAWBACK";
  }

  if (transactionType === "ACCOUNTSET") {
    return "ACCOUNT_CONFIGURATION";
  }

  return transactionType === "UNKNOWN"
    ? "UNKNOWN"
    : "OTHER";
}

const EXACT_RULES:
  Record<string, ExactRule> = {
    TECUNFUNDED_PAYMENT: {
      category: "INSUFFICIENT_PAYMENT_FUNDS",
      severity: "HIGH",
      diagnosis:
        "The source account lacks sufficient spendable funds for the payment.",
      probable_causes: [
        "The XRP or issued-asset balance is insufficient.",
        "XRP reserve requirements constrain the spendable balance.",
        "The requested amount exceeds the currently available balance."
      ],
      recommended_action:
        "FUND_OR_REDUCE_PAYMENT",
      steps: [
        "Read the current validated source-account balance.",
        "Account for owner reserve and transaction cost.",
        "Fund the account or reduce the payment amount.",
        "Rebuild and re-sign before submitting again."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TECPATH_DRY: {
      category: "LIQUIDITY_PATH_FAILURE",
      severity: "HIGH",
      diagnosis:
        "The payment path could not deliver the requested amount.",
      probable_causes: [
        "Order-book or path liquidity is insufficient.",
        "The selected path is no longer executable.",
        "Market conditions changed after transaction construction."
      ],
      recommended_action:
        "REQUOTE_OR_REDUCE_SIZE",
      steps: [
        "Fetch fresh path and order-book data.",
        "Recalculate execution for the requested amount.",
        "Reduce size or choose another viable path.",
        "Rebuild and re-sign with fresh parameters."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TECPATH_PARTIAL: {
      category: "PARTIAL_PATH_FAILURE",
      severity: "HIGH",
      diagnosis:
        "The selected payment path could not satisfy all delivery constraints.",
      probable_causes: [
        "Available liquidity cannot satisfy the requested delivery amount.",
        "SendMax or delivery constraints are too strict."
      ],
      recommended_action:
        "REQUOTE_PAYMENT_PATH",
      steps: [
        "Fetch fresh path and liquidity information.",
        "Review Amount, DeliverMin, SendMax, and payment flags.",
        "Reduce size or construct a new route.",
        "Rebuild and re-sign the transaction."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TECNO_LINE: {
      category: "TRUST_LINE_REQUIRED",
      severity: "HIGH",
      diagnosis:
        "A required trust line does not exist.",
      probable_causes: [
        "The receiving or sending account has no trust line for the issued currency."
      ],
      recommended_action:
        "ESTABLISH_REQUIRED_TRUST_LINE",
      steps: [
        "Identify the currency and issuer involved.",
        "Confirm whether the account is permitted to hold the asset.",
        "Create the required TrustSet transaction.",
        "Retry the original operation only after the trust line validates."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TECNO_AUTH: {
      category: "TRUST_LINE_NOT_AUTHORIZED",
      severity: "HIGH",
      diagnosis:
        "The issuer requires authorization and the trust line is not authorized.",
      probable_causes: [
        "The issuer has RequireAuth enabled.",
        "The holder trust line has not been authorized by the issuer."
      ],
      recommended_action:
        "OBTAIN_ISSUER_AUTHORIZATION",
      steps: [
        "Confirm the issuer RequireAuth setting.",
        "Request authorization from the issuer.",
        "Verify authorization in a validated ledger.",
        "Rebuild the original transaction after authorization."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TECFROZEN: {
      category: "ASSET_FROZEN",
      severity: "CRITICAL",
      diagnosis:
        "The issued asset or trust line is frozen.",
      probable_causes: [
        "The issuer enabled global freeze.",
        "The relevant trust line is individually frozen."
      ],
      recommended_action:
        "STOP_AND_RESOLVE_FREEZE",
      steps: [
        "Inspect issuer and trust-line freeze flags.",
        "Do not repeatedly resubmit the transaction.",
        "Contact the issuer if unfreezing is appropriate."
      ],
      retry_unchanged: false,
      requires_rebuild: false,
      requires_resign: false
    },

    TECNO_PERMISSION: {
      category: "PERMISSION_DENIED",
      severity: "CRITICAL",
      diagnosis:
        "The submitting account is not permitted to perform this operation.",
      probable_causes: [
        "The account is not the required owner or issuer.",
        "An asset, offer, escrow, AMM, MPT, or NFToken permission is missing."
      ],
      recommended_action:
        "VERIFY_ACCOUNT_AUTHORITY",
      steps: [
        "Inspect ownership, issuer, destination, and authorization requirements.",
        "Do not retry from the same account unless authority changes.",
        "Reconstruct the operation using an authorized account when appropriate."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TECOBJECT_NOT_FOUND: {
      category: "LEDGER_OBJECT_NOT_FOUND",
      severity: "HIGH",
      diagnosis:
        "A referenced ledger object does not exist in the evaluated ledger.",
      probable_causes: [
        "The offer, escrow, check, ticket, AMM, MPT, or NFToken object was removed.",
        "The transaction references a stale or incorrect object identifier."
      ],
      recommended_action:
        "REFRESH_LEDGER_OBJECT_REFERENCE",
      steps: [
        "Query the referenced object from a validated ledger.",
        "Confirm that the identifier and owner are correct.",
        "Stop if the object was already consumed or deleted.",
        "Otherwise rebuild using current object state."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TECAMM_UNFUNDED: {
      category: "AMM_FUNDING_INSUFFICIENT",
      severity: "HIGH",
      diagnosis:
        "The account lacks sufficient assets to fund the AMM operation.",
      probable_causes: [
        "One or both required asset balances are insufficient."
      ],
      recommended_action:
        "REFRESH_AMM_BALANCES",
      steps: [
        "Fetch current balances for both AMM assets.",
        "Recalculate the deposit or creation amounts.",
        "Rebuild and re-sign the AMM transaction."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TECAMM_EMPTY: {
      category: "AMM_EMPTY",
      severity: "HIGH",
      diagnosis:
        "The AMM currently has no assets available for this operation.",
      probable_causes: [
        "The AMM pool was emptied before execution."
      ],
      recommended_action:
        "REFUND_OR_DELETE_AMM",
      steps: [
        "Read current validated AMM state.",
        "Only fund or delete the empty AMM as permitted.",
        "Do not retry the same operation unchanged."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEFBAD_AUTH: {
      category: "SIGNING_KEY_NOT_AUTHORIZED",
      severity: "CRITICAL",
      diagnosis:
        "The signing key is not authorized for the source account.",
      probable_causes: [
        "The regular key changed or was removed.",
        "The transaction was signed by the wrong wallet."
      ],
      recommended_action:
        "USE_AUTHORIZED_SIGNING_KEY",
      steps: [
        "Read the account master-key, regular-key, and signer-list configuration.",
        "Select an authorized signing method.",
        "Rebuild and re-sign the transaction."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEFBAD_QUORUM: {
      category: "MULTISIGN_QUORUM_NOT_MET",
      severity: "HIGH",
      diagnosis:
        "The submitted multisigned transaction does not meet signer quorum.",
      probable_causes: [
        "Signer weights do not reach the configured quorum.",
        "A required signer is missing."
      ],
      recommended_action:
        "COMPLETE_MULTISIGNATURE_SET",
      steps: [
        "Read the current validated signer list.",
        "Collect enough valid signer weights.",
        "Rebuild the multisigned transaction if signer configuration changed."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEFPAST_SEQ: {
      category: "STALE_SEQUENCE",
      severity: "MODERATE",
      diagnosis:
        "The transaction sequence is below the account's current sequence.",
      probable_causes: [
        "Another transaction consumed the sequence.",
        "The transaction was built from stale account state."
      ],
      recommended_action:
        "REFRESH_SEQUENCE_AND_RESIGN",
      steps: [
        "Fetch the current validated account Sequence.",
        "Check whether the original transaction already validated.",
        "If it did not validate, rebuild with a current sequence and re-sign."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEFMAX_LEDGER: {
      category: "LAST_LEDGER_SEQUENCE_EXPIRED",
      severity: "HIGH",
      diagnosis:
        "The transaction expired before it could be included.",
      probable_causes: [
        "The validated ledger passed LastLedgerSequence."
      ],
      recommended_action:
        "REBUILD_WITH_FRESH_LEDGER_WINDOW",
      steps: [
        "Confirm the original transaction did not validate.",
        "Read the current validated ledger index.",
        "Rebuild with a fresh LastLedgerSequence and re-sign."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEFALREADY: {
      category: "TRANSACTION_ALREADY_APPLIED",
      severity: "LOW",
      diagnosis:
        "The exact transaction was already applied.",
      probable_causes: [
        "The client resubmitted a transaction that already validated."
      ],
      recommended_action:
        "LOOK_UP_EXISTING_TRANSACTION",
      steps: [
        "Look up the transaction hash in a validated ledger.",
        "Inspect metadata to confirm its actual delivered outcome.",
        "Do not create a duplicate transaction."
      ],
      safe_to_retry: false,
      retry_unchanged: false,
      requires_rebuild: false,
      requires_resign: false
    },

    TEFNFTOKEN_IS_NOT_TRANSFERABLE: {
      category: "NFT_NOT_TRANSFERABLE",
      severity: "CRITICAL",
      diagnosis:
        "The NFToken is not transferable for the requested participants.",
      probable_causes: [
        "The NFToken transferable flag is disabled.",
        "The transfer is neither to nor from the issuer."
      ],
      recommended_action:
        "STOP_UNAUTHORIZED_NFT_TRANSFER",
      steps: [
        "Inspect the NFToken flags and issuer.",
        "Do not retry the same transfer between the same accounts."
      ],
      retry_unchanged: false,
      requires_rebuild: false,
      requires_resign: false
    },

    TERPRE_SEQ: {
      category: "FUTURE_SEQUENCE",
      severity: "MODERATE",
      diagnosis:
        "The transaction sequence is ahead of the sequence currently expected.",
      probable_causes: [
        "An earlier transaction has not validated.",
        "Transactions were submitted out of order."
      ],
      recommended_action:
        "WAIT_OR_RECONCILE_SEQUENCE",
      steps: [
        "Read the current validated Sequence.",
        "Check earlier pending transactions.",
        "Wait or rebuild only after sequence state is reconciled."
      ],
      safe_to_retry: true,
      retry_unchanged: true,
      requires_rebuild: false,
      requires_resign: false
    },

    TERQUEUED: {
      category: "TRANSACTION_QUEUED",
      severity: "LOW",
      diagnosis:
        "The transaction is queued rather than definitively rejected.",
      probable_causes: [
        "Current network conditions placed it in the transaction queue."
      ],
      recommended_action:
        "WAIT_FOR_VALIDATION",
      steps: [
        "Do not create a duplicate transaction.",
        "Monitor the hash and LastLedgerSequence.",
        "Rebuild only after expiry or a definitive failure."
      ],
      safe_to_retry: false,
      retry_unchanged: false,
      requires_rebuild: false,
      requires_resign: false
    },

    TELINSUF_FEE_P: {
      category: "INSUFFICIENT_NETWORK_FEE",
      severity: "MODERATE",
      diagnosis:
        "The transaction fee is below the server or network requirement.",
      probable_causes: [
        "The fee estimate is stale.",
        "Network load increased after construction."
      ],
      recommended_action:
        "REFRESH_FEE_AND_RESIGN",
      steps: [
        "Fetch current fee information.",
        "Set an appropriate Fee and ledger window.",
        "Re-sign and submit the updated transaction."
      ],
      safe_to_retry: true,
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEMBAD_AMOUNT: {
      category: "INVALID_AMOUNT",
      severity: "HIGH",
      diagnosis:
        "One or more transaction amounts are malformed or outside protocol rules.",
      probable_causes: [
        "An amount is negative, zero where prohibited, malformed, or uses an invalid representation."
      ],
      recommended_action:
        "CORRECT_TRANSACTION_AMOUNT",
      steps: [
        "Validate XRP drops and issued-currency amount formatting.",
        "Validate MPT amount fields when applicable.",
        "Rebuild and re-sign the transaction."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEMBAD_CURRENCY: {
      category: "INVALID_CURRENCY",
      severity: "HIGH",
      diagnosis:
        "A currency field is not encoded according to XRPL rules.",
      probable_causes: [
        "The currency code or asset representation is malformed."
      ],
      recommended_action:
        "CORRECT_CURRENCY_ENCODING",
      steps: [
        "Validate the currency code and issuer pairing.",
        "Use XRP without an issuer.",
        "Rebuild and re-sign the corrected transaction."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEMBAD_ISSUER: {
      category: "INVALID_ISSUER",
      severity: "HIGH",
      diagnosis:
        "An issued-currency issuer field is invalid.",
      probable_causes: [
        "The issuer is missing, malformed, or incompatible with the amount."
      ],
      recommended_action:
        "CORRECT_ISSUER",
      steps: [
        "Verify the issued asset's exact currency and issuer.",
        "Rebuild and re-sign the transaction."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEMBAD_OFFER: {
      category: "INVALID_DEX_OFFER",
      severity: "HIGH",
      diagnosis:
        "The OfferCreate transaction contains an invalid trading pair or amount.",
      probable_causes: [
        "The offer trades an asset for itself.",
        "TakerGets or TakerPays is malformed."
      ],
      recommended_action:
        "REBUILD_OFFER",
      steps: [
        "Validate both sides of the offer.",
        "Confirm the currency and issuer of each issued asset.",
        "Rebuild and re-sign the offer."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEMBAD_AMM_TOKENS: {
      category: "INVALID_AMM_ASSETS",
      severity: "HIGH",
      diagnosis:
        "The AMM transaction specifies invalid or mismatched assets.",
      probable_causes: [
        "The same asset was specified twice.",
        "An issuer does not match the AMM pool asset."
      ],
      recommended_action:
        "CORRECT_AMM_ASSETS",
      steps: [
        "Read the validated AMM asset pair.",
        "Correct both asset identifiers and issuers.",
        "Rebuild and re-sign the AMM transaction."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TEMBAD_NFTOKEN_TRANSFER_FEE: {
      category: "INVALID_NFT_TRANSFER_FEE",
      severity: "HIGH",
      diagnosis:
        "The NFToken transfer fee is outside protocol requirements.",
      probable_causes: [
        "TransferFee is malformed or incompatible with the NFToken flags."
      ],
      recommended_action:
        "CORRECT_NFT_TRANSFER_FEE",
      steps: [
        "Validate the NFTokenMint TransferFee and flags.",
        "Rebuild and re-sign the mint transaction."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TECBAD_PROOF: {
      category: "INVALID_CONFIDENTIAL_MPT_PROOF",
      severity: "CRITICAL",
      diagnosis:
        "The confidential MPT cryptographic proof could not be verified.",
      probable_causes: [
        "The submitted proof is malformed, stale, or does not match the transfer."
      ],
      recommended_action:
        "REGENERATE_CONFIDENTIAL_PROOF",
      steps: [
        "Do not resubmit the same proof.",
        "Regenerate the proof from current confidential MPT state.",
        "Rebuild and re-sign the transaction."
      ],
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    },

    TESSUCCESS: {
      category: "SUCCESS",
      severity: "LOW",
      diagnosis:
        "The engine result indicates successful application.",
      probable_causes: [],
      recommended_action:
        "VERIFY_VALIDATED_OUTCOME",
      steps: [
        "Confirm the transaction appears in a validated ledger.",
        "Inspect metadata to verify the intended outcome."
      ],
      safe_to_retry: false,
      retry_unchanged: false,
      requires_rebuild: false,
      requires_resign: false
    }
  };

function familyPlan(
  family: string,
  validated: boolean
): XRPLRepairPlan {
  if (family === "TES") {
    return {
      category: "SUCCESS",
      severity: "LOW",
      diagnosis:
        "The result reports success, but the intended outcome still requires metadata verification.",
      probable_causes: [],
      recommended_action:
        "VERIFY_VALIDATED_OUTCOME",
      steps: [
        "Confirm validation.",
        "Inspect transaction metadata and delivered amounts."
      ],
      safe_to_retry: false,
      retry_unchanged: false,
      requires_rebuild: false,
      requires_resign: false
    };
  }

  if (family === "TEC") {
    return {
      category: "CLAIMED_COST_FAILURE",
      severity: "HIGH",
      diagnosis: validated
        ? "The validated transaction failed and consumed its transaction cost and sequence."
        : "The transaction provisionally returned a claimed-cost failure; its final result is not yet established.",
      probable_causes: [
        "A ledger-state or transaction-specific condition prevented the intended operation."
      ],
      recommended_action: validated
        ? "INSPECT_METADATA_AND_REBUILD"
        : "WAIT_FOR_FINALITY",
      steps: validated
        ? [
            "Inspect validated transaction metadata for side effects.",
            "Refresh ledger state.",
            "Rebuild and re-sign only after identifying the cause."
          ]
        : [
            "Track the transaction until its result is final.",
            "Do not create a duplicate while the result remains provisional."
          ],
      safe_to_retry: false,
      retry_unchanged: false,
      requires_rebuild: validated,
      requires_resign: validated
    };
  }

  if (family === "TEF") {
    return {
      category: "FINAL_TRANSACTION_FAILURE",
      severity: "HIGH",
      diagnosis:
        "The transaction cannot be applied to the current ledger state unchanged.",
      probable_causes: [
        "Sequence, authorization, signature, ledger window, or referenced state is invalid."
      ],
      recommended_action:
        "REFRESH_STATE_AND_REBUILD",
      steps: [
        "Confirm the original transaction did not already validate.",
        "Refresh account and ledger state.",
        "Identify the failed constraint.",
        "Rebuild and re-sign before another submission."
      ],
      safe_to_retry: false,
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    };
  }

  if (family === "TEM") {
    return {
      category: "MALFORMED_TRANSACTION",
      severity: "HIGH",
      diagnosis:
        "The transaction violates XRPL format or protocol rules.",
      probable_causes: [
        "A field, flag, amount, signature, or transaction combination is invalid."
      ],
      recommended_action:
        "CORRECT_REBUILD_AND_RESIGN",
      steps: [
        "Validate the transaction against its XRPL transaction-type schema.",
        "Correct invalid fields or flags.",
        "Rebuild and re-sign the transaction."
      ],
      safe_to_retry: false,
      retry_unchanged: false,
      requires_rebuild: true,
      requires_resign: true
    };
  }

  if (family === "TER") {
    return {
      category: "RETRYABLE_PROVISIONAL_RESULT",
      severity: "MODERATE",
      diagnosis:
        "The transaction was not applied but may succeed in a future ledger.",
      probable_causes: [
        "A prerequisite transaction or ledger-state change is pending."
      ],
      recommended_action:
        "RECONCILE_STATE_BEFORE_RETRY",
      steps: [
        "Refresh validated account and ledger state.",
        "Check pending transactions and sequence ordering.",
        "Retry only when the blocking condition has cleared."
      ],
      safe_to_retry: true,
      retry_unchanged: true,
      requires_rebuild: false,
      requires_resign: false
    };
  }

  if (family === "TEL") {
    return {
      category: "LOCAL_SERVER_REJECTION",
      severity: "MODERATE",
      diagnosis:
        "A local server condition prevented processing.",
      probable_causes: [
        "Server load, queue policy, fee level, or local limits rejected the transaction."
      ],
      recommended_action:
        "RETRY_LATER_OR_USE_ANOTHER_SERVER",
      steps: [
        "Check current fee and server load.",
        "Avoid duplicate submission while transaction status is uncertain.",
        "Retry later or use another trusted XRPL server."
      ],
      safe_to_retry: true,
      retry_unchanged: true,
      requires_rebuild: false,
      requires_resign: false
    };
  }

  return {
    category: "UNCLASSIFIED_XRPL_RESULT",
    severity: "MODERATE",
    diagnosis:
      "The supplied result is not a recognized XRPL result family.",
    probable_causes: [
      "The result may be malformed, application-specific, or require additional context."
    ],
    recommended_action:
      "INSPECT_RESULT_AND_TRANSACTION_CONTEXT",
    steps: [
      "Do not repeatedly submit the transaction unchanged.",
      "Confirm the exact xrpld engine result.",
      "Inspect the transaction and current validated ledger state."
    ],
    safe_to_retry: false,
    retry_unchanged: false,
    requires_rebuild: false,
    requires_resign: false
  };
}

export function repairXRPLTransactionV3(
  request: XRPLRepairRequest
) {
  const engineResult = text(
    request.engine_result ??
    request.result ??
    request.error_code
  ).toUpperCase();

  if (!engineResult) {
    throw new Error(
      "engine_result is required."
    );
  }

  const transactionType = text(
    request.transaction_type ??
    request.TransactionType ??
    request.tx?.TransactionType ??
    "UNKNOWN"
  ).toUpperCase();

  const validated =
    request.validated === true;

  const family =
    resultClass(engineResult);

  const exact =
    EXACT_RULES[engineResult];

  const basePlan = exact
    ? {
        ...exact,
        safe_to_retry:
          exact.safe_to_retry ??
          false
      }
    : familyPlan(
        family,
        validated
      );

  const flags: string[] = [];

  if (!exact) {
    flags.push(
      "GENERIC_RESULT_CLASSIFICATION"
    );
  }

  if (!validated) {
    flags.push(
      "RESULT_FINALITY_UNCONFIRMED"
    );
  }

  if (basePlan.requires_rebuild) {
    flags.push(
      "TRANSACTION_REBUILD_REQUIRED"
    );
  }

  if (basePlan.requires_resign) {
    flags.push(
      "RESIGN_REQUIRED"
    );
  }

  if (basePlan.retry_unchanged) {
    flags.push(
      "UNCHANGED_RETRY_POSSIBLE"
    );
  }

  const txFamily =
    transactionFamily(
      transactionType
    );

  if (txFamily !== "UNKNOWN") {
    flags.push(
      `${txFamily}_TRANSACTION`
    );
  }

  let signal: XRPLRepairSignal;

  if (
    basePlan.category === "SUCCESS"
  ) {
    signal = validated
      ? "ALLOW"
      : "REVIEW";
  } else if (
    basePlan.severity === "HIGH" ||
    basePlan.severity === "CRITICAL"
  ) {
    signal = "ABORT";
  } else {
    signal = "REVIEW";
  }

  return {
    success: true,
    service:
      "cloudpayx_transaction_repair_v3",
    version: "3.0",
    network: "xrpl:0",
    input: {
      engine_result: engineResult,
      engine_result_message:
        text(
          request.engine_result_message ??
          request.message
        ) || null,
      transaction_type:
        transactionType,
      transaction_family:
        txFamily,
      validated
    },
    classification: {
      result_class: family,
      category:
        basePlan.category,
      severity:
        basePlan.severity,
      specialized_rule:
        Boolean(exact),
      finality:
        validated
          ? "VALIDATED"
          : "UNCONFIRMED"
    },
    diagnosis: {
      summary:
        basePlan.diagnosis,
      probable_causes:
        basePlan.probable_causes
    },
    repair: {
      recommended_action:
        basePlan.recommended_action,
      steps:
        basePlan.steps,
      safe_to_retry:
        basePlan.safe_to_retry,
      retry_unchanged:
        basePlan.retry_unchanged,
      requires_rebuild:
        basePlan.requires_rebuild,
      requires_resign:
        basePlan.requires_resign
    },
    decision: {
      signal,
      flags,
      reason:
        signal === "ALLOW"
          ? "The validated result reports success; verify transaction metadata."
          : signal === "ABORT"
            ? "The transaction must not be resubmitted unchanged."
            : "Further validation or ledger-state reconciliation is required."
    },
    generated_at:
      new Date().toISOString()
  };
}
