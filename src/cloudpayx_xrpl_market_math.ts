export type XRPLBookSimulation = {
  output: number;
  consumedInput: number;
  executableOffers: number;
  completeFill: boolean;
  bestRate: number;
  averageExecutionRate: number;
  slippagePct: number;
};

export function xrplAmountToNumber(
  value: any
): number {
  if (typeof value === "string") {
    const amount =
      Number(value) / 1_000_000;

    return Number.isFinite(amount)
      ? amount
      : 0;
  }

  if (
    value &&
    typeof value === "object" &&
    value.value !== undefined
  ) {
    const amount =
      Number(value.value);

    return Number.isFinite(amount)
      ? amount
      : 0;
  }

  return 0;
}

export function simulateXRPLBook(
  offers: any[],
  requestedInput: number
): XRPLBookSimulation {
  if (
    !Number.isFinite(requestedInput) ||
    requestedInput <= 0
  ) {
    throw new Error(
      "requestedInput must be positive"
    );
  }

  let remaining = requestedInput;
  let output = 0;
  let consumedInput = 0;
  let executableOffers = 0;
  let bestRate = 0;

  for (const offer of offers || []) {
    if (remaining <= 0) {
      break;
    }

    const gets =
      xrplAmountToNumber(
        offer.taker_gets_funded ??
        offer.TakerGets
      );

    const pays =
      xrplAmountToNumber(
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

  return {
    output,
    consumedInput,
    executableOffers,
    completeFill,
    bestRate,
    averageExecutionRate,
    slippagePct
  };
}
