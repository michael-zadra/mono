import { Resolvers } from "@apollo/client";
import { BigNumber, FixedNumber } from "ethers";

import { APY_DECIMALS, SECONDS_PER_YEAR, SECONDS_PER_DAY } from "@/constants";
import { getContract } from "@/lib/contracts";
import { CreditLine } from "@/lib/graphql/generated";
import { getProvider } from "@/lib/wallet";

const isCreditLinePaymentLate = async (
  creditLine: CreditLine
): Promise<boolean> => {
  // Not all CreditLine contracts have an 'isLate' accessor - use block timestamp to calc
  const provider = await getProvider();

  const currentBlock = await provider.getBlock("latest");
  if (creditLine.lastFullPaymentTime.isZero()) {
    // Brand new creditline
    return false;
  }

  const secondsSinceLastFullPayment =
    currentBlock.timestamp - creditLine.lastFullPaymentTime.toNumber();

  return (
    secondsSinceLastFullPayment >
    creditLine.paymentPeriodInDays.toNumber() * SECONDS_PER_DAY
  );
};

const calculateInterestOwed = async (
  creditLine: CreditLine
): Promise<BigNumber> => {
  if (await isCreditLinePaymentLate(creditLine)) {
    return creditLine.interestOwed;
  }

  const annualRate = creditLine.interestAprDecimal;
  const expectedElapsedSeconds = creditLine.nextDueTime.sub(
    creditLine.interestAccruedAsOf
  );
  const interestAccrualRate = annualRate.divUnsafe(
    FixedNumber.from(SECONDS_PER_YEAR)
  );
  const expectedAdditionalInterest = FixedNumber.from(creditLine.balance)
    .mulUnsafe(interestAccrualRate)
    .mulUnsafe(FixedNumber.from(expectedElapsedSeconds));

  const currentInterestOwed = creditLine.interestOwed
    .add(BigNumber.from(expectedAdditionalInterest))
    .div(APY_DECIMALS);

  return currentInterestOwed;
};

export const creditLineResolvers: Resolvers[string] = {
  async isLate(creditLine: CreditLine): Promise<boolean> {
    return await isCreditLinePaymentLate(creditLine);
  },

  // The remaining amount owed for the period
  async remainingPeriodDueAmount(creditLine: CreditLine): Promise<BigNumber> {
    const provider = await getProvider();
    const usdcContract = await getContract({ name: "USDC", provider });
    const collectedPaymentBalance = await usdcContract.balanceOf(creditLine.id);

    const currentInterestOwed = await calculateInterestOwed(creditLine);

    // If we are on our last period of the term, then it's interestOwed + principal
    // This is a bullet loan, so full principal is paid only at the end of the credit line term
    if (creditLine.nextDueTime.gte(creditLine.termEndTime)) {
      return currentInterestOwed.add(creditLine.balance);
    }

    // collectedPaymentBalance is the amount that's been paid so far for the period
    const remainingPeriodDueAmount = currentInterestOwed.sub(
      collectedPaymentBalance
    );
    if (remainingPeriodDueAmount.lte(0)) {
      return BigNumber.from(0);
    }

    return remainingPeriodDueAmount;
  },

  // The total remaining amount owed for the loan term
  async remainingTotalDueAmount(creditLine: CreditLine): Promise<BigNumber> {
    const provider = await getProvider();
    const usdcContract = await getContract({ name: "USDC", provider });
    const collectedPaymentBalance = await usdcContract.balanceOf(creditLine.id);

    const currentInterestOwed = await calculateInterestOwed(creditLine);
    const totalDueAmount = currentInterestOwed.add(creditLine.balance);

    const remainingTotalDueAmount = totalDueAmount.sub(collectedPaymentBalance);
    if (remainingTotalDueAmount.lte(0)) {
      return BigNumber.from(0);
    }

    return remainingTotalDueAmount;
  },
};
