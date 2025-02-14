import { gql, useApolloClient } from "@apollo/client";
import { BigNumber, utils } from "ethers";
import { useMemo } from "react";
import { useForm } from "react-hook-form";

import {
  Icon,
  Button,
  DollarInput,
  Select,
  InfoIconTooltip,
  Form,
  Link,
} from "@/components/design-system";
import { USDC_DECIMALS } from "@/constants";
import { getContract } from "@/lib/contracts";
import { formatCrypto } from "@/lib/format";
import {
  WithdrawalPanelPoolTokenFieldsFragment,
  WithdrawalPanelZapFieldsFragment,
  SupportedCrypto,
} from "@/lib/graphql/generated";
import { toastTransaction } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";

export const WITHDRAWAL_PANEL_POOL_TOKEN_FIELDS = gql`
  fragment WithdrawalPanelPoolTokenFields on TranchedPoolToken {
    id
    principalAmount
    principalRedeemable
    interestRedeemable
  }
`;

export const WITHDRAWAL_PANEL_ZAP_FIELDS = gql`
  fragment WithdrawalPanelZapFields on Zap {
    id
    amount
    seniorPoolStakedPosition {
      id
    }
    poolToken {
      id
      principalRedeemable
      interestRedeemable
    }
  }
`;

interface WithdrawalPanelProps {
  tranchedPoolAddress: string;
  poolTokens: WithdrawalPanelPoolTokenFieldsFragment[];
  vaultedPoolTokens: WithdrawalPanelPoolTokenFieldsFragment[];
  zaps: WithdrawalPanelZapFieldsFragment[];
  isPoolLocked: boolean;
}

interface FormFields {
  amount: string;
  destination: string;
}

export function WithdrawalPanel({
  tranchedPoolAddress,
  poolTokens,
  vaultedPoolTokens,
  zaps,
  isPoolLocked,
}: WithdrawalPanelProps) {
  const totalPrincipalRedeemable = poolTokens.reduce(
    (prev, current) => current.principalRedeemable.add(prev),
    BigNumber.from(0)
  );
  const totalInterestRedeemable = poolTokens.reduce(
    (prev, current) => current.interestRedeemable.add(prev),
    BigNumber.from(0)
  );
  const totalZapped = zaps.reduce(
    (prev, current) =>
      prev
        .add(current.poolToken.principalRedeemable)
        .add(current.poolToken.interestRedeemable),
    BigNumber.from(0)
  );
  const totalWithdrawable = totalPrincipalRedeemable
    .add(totalInterestRedeemable)
    .add(totalZapped);

  const rhfMethods = useForm<FormFields>({
    defaultValues: { destination: "wallet" },
  });
  const { control, watch } = rhfMethods;
  const selectedDestination = watch("destination");
  const apolloClient = useApolloClient();
  const { provider } = useWallet();

  const onSubmit = async (data: FormFields) => {
    if (!provider) {
      throw new Error("Wallet not connected properly");
    }
    const tranchedPoolContract = await getContract({
      name: "TranchedPool",
      provider,
      address: tranchedPoolAddress,
    });

    if (data.destination === "wallet") {
      const usdcToWithdraw = utils.parseUnits(data.amount, USDC_DECIMALS);
      let transaction;
      if (
        usdcToWithdraw.lte(
          poolTokens[0].principalRedeemable.add(
            poolTokens[0].interestRedeemable
          )
        )
      ) {
        transaction = tranchedPoolContract.withdraw(
          BigNumber.from(poolTokens[0].id),
          usdcToWithdraw
        );
      } else {
        let remainingAmount = usdcToWithdraw;
        const tokenIds: BigNumber[] = [];
        const amounts: BigNumber[] = [];
        for (const poolToken of poolTokens) {
          if (remainingAmount.isZero()) {
            break;
          }
          const redeemable = poolToken.principalRedeemable.add(
            poolToken.interestRedeemable
          );
          if (redeemable.isZero()) {
            continue;
          }
          const amountFromThisToken = redeemable.gt(remainingAmount)
            ? remainingAmount
            : redeemable;
          tokenIds.push(BigNumber.from(poolToken.id));
          amounts.push(amountFromThisToken);
          remainingAmount = remainingAmount.sub(amountFromThisToken);
        }
        transaction = tranchedPoolContract.withdrawMultiple(tokenIds, amounts);
      }
      await toastTransaction({
        transaction,
        pendingPrompt: `Withdrawal submitted for pool ${tranchedPoolAddress}.`,
        successPrompt: `Withdrawal from pool ${tranchedPoolAddress} succeeded.`,
      });
    } else {
      const zapperContract = await getContract({ name: "Zapper", provider });
      const poolTokenId = BigNumber.from(data.destination.split("-")[1]);
      if (isPoolLocked) {
        const transaction = zapperContract
          .claimTranchedPoolZap(poolTokenId)
          .then(() => tranchedPoolContract.withdrawMax(poolTokenId));
        await toastTransaction({
          transaction,
          pendingPrompt:
            "Transferring pool token to your ownership and withdrawing...",
          successPrompt:
            "Successfully transferred pool token to you and withdrew",
        });
      } else {
        const transaction = zapperContract.unzapToStakingRewards(poolTokenId);
        await toastTransaction({
          transaction,
          pendingPrompt:
            "Submitted transaction to move capital back to senior pool stake",
          successPrompt:
            "Successfully returned capital back to senior pool stake",
        });
      }
    }
    await apolloClient.refetchQueries({
      include: "active",
      updateCache(cache) {
        cache.evict({ fieldName: "tranchedPoolTokens" });
        cache.evict({ fieldName: "zaps" });
      },
    });
  };

  const validateWithdrawalAmount = (value: string) => {
    if (selectedDestination !== "wallet") {
      return;
    }
    if (!value) {
      return "You must specify an amount to withdraw";
    }
    const usdcToWithdraw = utils.parseUnits(value, USDC_DECIMALS);
    if (usdcToWithdraw.gt(totalWithdrawable)) {
      return "Withdrawal amount too high";
    }
    if (usdcToWithdraw.lte(BigNumber.from(0))) {
      return "Must withdraw more than 0";
    }
  };

  const availableDestinations = useMemo(() => {
    const wallet = [
      {
        label: `Wallet \u00b7 ${formatCrypto({
          token: SupportedCrypto.Usdc,
          amount: totalPrincipalRedeemable.add(totalInterestRedeemable),
        })}`,
        value: "wallet",
      },
    ];
    const seniorPoolStakedPositions = zaps.map((zap, index) => ({
      label: `Senior Pool Capital ${index + 1} \u00b7 ${formatCrypto({
        token: SupportedCrypto.Usdc,
        amount: zap.poolToken.principalRedeemable.add(
          zap.poolToken.interestRedeemable
        ),
      })}`,
      value: `seniorPool-${zap.poolToken.id}`,
    }));
    return wallet.concat(seniorPoolStakedPositions);
  }, [zaps, totalPrincipalRedeemable, totalInterestRedeemable]);

  return (
    <div className="rounded-xl bg-sunrise-01 p-5 text-white">
      <div className="mb-3 flex justify-between text-sm">
        Available to withdraw
        <InfoIconTooltip
          content="Your USDC funds that are currently available to be withdrawn from this Pool."
          size="sm"
        />
      </div>
      <div className="mb-9 flex items-center gap-3 text-5xl">
        {formatCrypto({
          token: SupportedCrypto.Usdc,
          amount: totalWithdrawable,
        })}
        <Icon name="Usdc" size="sm" />
      </div>
      <Form rhfMethods={rhfMethods} onSubmit={onSubmit}>
        <Select
          control={control}
          options={availableDestinations}
          name="destination"
          label="Destination"
          textSize="xl"
          colorScheme="dark"
          labelClassName="!mb-3 text-sm"
          className={availableDestinations.length > 1 ? "mb-3" : "hidden"}
        />
        <DollarInput
          name="amount"
          label="Amount"
          control={control}
          textSize="xl"
          colorScheme="dark"
          rules={{ validate: validateWithdrawalAmount }}
          labelClassName="!mb-3 text-sm"
          className="mb-3"
          disabled={selectedDestination !== "wallet"}
          maxValue={totalWithdrawable}
        />
        <Button
          type="submit"
          colorScheme="secondary"
          size="xl"
          className="block w-full"
        >
          Withdraw
        </Button>
        {!isPoolLocked ? (
          <div className="mt-3 flex items-center justify-center gap-2 text-sm text-sand-700">
            <InfoIconTooltip
              size="sm"
              content="While this Pool is still open for Backer investments, you can instantly withdraw any amount of the funds you have already invested. Once the Pool is has reached its Pool limit for funding and is closed for further investment, you will only be able to withdraw your share of the Pool's interest and principal repayments."
            />
            You can withdraw capital until the pool is closed.
          </div>
        ) : null}
        {vaultedPoolTokens.length > 0 ? (
          <div className="flex-column mt-3 flex items-center justify-between gap-4 rounded bg-mustard-200 p-3 text-xs md:flex-row">
            <div className="text-mustard-900">
              You cannot withdraw capital from your positions while they are in
              the Vault
            </div>
            <Link
              href="/membership"
              iconRight="ArrowSmRight"
              className="whitespace-nowrap font-medium text-mustard-700"
            >
              Go to Vault
            </Link>
          </div>
        ) : null}
      </Form>
    </div>
  );
}
