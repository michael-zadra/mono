import { gql } from "@apollo/client";
import { format } from "date-fns";
import Image from "next/future/image";
import { useCallback } from "react";

import { Address } from "@/components/address";
import {
  GoldfinchLogo,
  Link,
  ShimmerLines,
  Table,
} from "@/components/design-system";
import { formatCrypto } from "@/lib/format";
import {
  useTranchedPoolTransactionTableQuery,
  TransactionCategory,
} from "@/lib/graphql/generated";
import { getShortTransactionLabel } from "@/lib/pools";
import { reduceOverlappingEventsToNonOverlappingTxs } from "@/lib/tx";

gql`
  query TranchedPoolTransactionTable(
    $tranchedPoolId: String!
    $first: Int!
    $skip: Int!
  ) {
    transactions(
      where: { tranchedPool: $tranchedPoolId }
      orderBy: timestamp
      orderDirection: desc
      first: $first
      skip: $skip
    ) {
      id
      transactionHash
      user {
        id
      }
      category
      sentAmount
      sentToken
      receivedAmount
      receivedToken
      timestamp
      tranchedPool {
        id
        borrowerName @client
        borrowerLogo @client
      }
    }
  }
`;

interface TransactionTableProps {
  tranchedPoolId: string;
}

const subtractiveIconTransactionCategories = [
  TransactionCategory.TranchedPoolWithdrawal,
  TransactionCategory.TranchedPoolDrawdown,
  TransactionCategory.SeniorPoolRedemption,
];

const sentTokenCategories = [TransactionCategory.TranchedPoolDeposit];

export function TransactionTable({ tranchedPoolId }: TransactionTableProps) {
  const { data, loading, error, fetchMore } =
    useTranchedPoolTransactionTableQuery({
      variables: { tranchedPoolId, first: 20, skip: 0 },
    });

  const filteredTxs = reduceOverlappingEventsToNonOverlappingTxs(
    data?.transactions
  );

  const rows = filteredTxs.map((transaction) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tranchedPool = transaction.tranchedPool!;

    const user =
      transaction.category === TransactionCategory.TranchedPoolDrawdown ||
      transaction.category === TransactionCategory.TranchedPoolRepayment ? (
        <div className="flex items-center gap-2">
          <Image
            src={tranchedPool.borrowerLogo}
            alt=""
            width={24}
            height={24}
            className="shrink-0 overflow-hidden rounded-full"
          />
          <span>{tranchedPool.borrowerName}</span>
        </div>
      ) : transaction.category === TransactionCategory.SeniorPoolRedemption ? (
        <div className="flex items-center gap-2">
          <GoldfinchLogo className="h-6 w-6" />
          Senior Pool
        </div>
      ) : (
        <Address address={transaction.user.id} />
      );

    let tokenToDisplay = transaction.receivedToken;
    let amountToDisplay = transaction.receivedAmount;

    if (sentTokenCategories.includes(transaction.category)) {
      tokenToDisplay = transaction.sentToken;
      amountToDisplay = transaction.sentAmount;
    }

    const amount =
      tokenToDisplay && amountToDisplay
        ? (subtractiveIconTransactionCategories.includes(transaction.category)
            ? "-"
            : "+") +
          formatCrypto(
            {
              token: tokenToDisplay,
              amount: amountToDisplay,
            },
            { includeToken: true }
          )
        : null;

    const date = new Date(transaction.timestamp * 1000);

    return [
      <div key={`${transaction.id}-user`}>{user}</div>,
      <div key={`${transaction.id}-category`} className="text-left">
        {getShortTransactionLabel(transaction)}
      </div>,
      <div key={`${transaction.id}-amount`}>{amount}</div>,
      <div key={`${transaction.id}-date`}>{format(date, "MMM d, y")}</div>,
      <Link
        href={`https://etherscan.io/tx/${transaction.transactionHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sand-400"
        key={`${transaction.id}-link`}
        iconRight="ArrowTopRight"
      >
        Tx
      </Link>,
    ];
  });

  const onScrollBottom = useCallback(() => {
    if (data?.transactions) {
      fetchMore({
        variables: {
          skip: data?.transactions.length,
          first: 20,
        },
      });
    }
  }, [data, fetchMore]);

  return loading ? (
    <ShimmerLines lines={4} truncateFirstLine={false} />
  ) : error ? (
    <div className="text-clay-500">
      There was an error fetching transactions: {error.message}
    </div>
  ) : rows.length === 0 ? (
    <div className="rounded bg-sand-50 p-3 text-center text-sm text-sand-400">
      No recent activity
    </div>
  ) : (
    <Table
      headings={["User", "Category", "Amount", "Date", "Link"]}
      hideHeadings
      rows={rows}
      onScrollBottom={onScrollBottom}
      fixedHeight
    />
  );
}
