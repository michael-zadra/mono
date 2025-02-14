import { Resolvers } from "@apollo/client";

import { getContract } from "@/lib/contracts";
import { getProvider } from "@/lib/wallet";

import { CreditLine } from "../generated";

export const creditLineResolvers: Resolvers[string] = {
  async isLate(creditLine: CreditLine): Promise<boolean | null> {
    const provider = await getProvider();
    if (!creditLine.id) {
      throw new Error("CreditLine ID unavailable when querying isLate");
    }
    const creditLineContract = await getContract({
      name: "CreditLine",
      address: creditLine.id,
      provider,
      useSigner: false,
    });
    try {
      return await creditLineContract.isLate();
    } catch (e) {
      return null;
    }
  },
};
