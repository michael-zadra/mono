import hre, {getNamedAccounts} from "hardhat"
import {
  ERC20Instance,
  FiduInstance,
  GFIInstance,
  SeniorPoolInstance,
  StakingRewardsInstance,
} from "@goldfinch-eng/protocol/typechain/truffle"
import {
  expect,
  BN,
  advanceTime,
  expectAction,
  SECONDS_PER_DAY,
  getFirstLog,
  decodeLogs,
  erc20Approve,
  usdcVal,
} from "../testHelpers"
import {
  ContractDeployer,
  ContractUpgrader,
  getERC20Address,
  getTruffleContract,
  MAINNET_CHAIN_ID,
  StakedPositionType,
} from "../../blockchain_scripts/deployHelpers"
import {UpgradedContracts} from "../../blockchain_scripts/deployHelpers/upgradeContracts"
import {
  changeImplementations,
  getDeployEffects,
} from "@goldfinch-eng/protocol/blockchain_scripts/migrations/deployEffects"
import {impersonateAccount} from "../../blockchain_scripts/helpers/impersonateAccount"
import {fundWithWhales} from "@goldfinch-eng/protocol/blockchain_scripts/helpers/fundWithWhales"
import {time} from "@openzeppelin/test-helpers"
import {Staked} from "../../typechain/truffle/StakingRewards"
import {DepositMade} from "../../typechain/truffle/SeniorPool"
import {MAINNET_TRUSTED_SIGNER_ADDRESS} from "@goldfinch-eng/protocol/blockchain_scripts/mainnetForkingHelpers"

const {deployments} = hre

const setupTest = deployments.createFixture(async ({deployments}) => {
  await deployments.fixture("baseDeploy", {keepExistingDeployments: true})

  let upgradedContracts: UpgradedContracts
  {
    const {gf_deployer} = await getNamedAccounts()
    fundWithWhales(["ETH"], [gf_deployer!, MAINNET_TRUSTED_SIGNER_ADDRESS])
    const deployEffects = await getDeployEffects({
      title: "Test Update Staking Rewards",
    })

    const deployer = new ContractDeployer(console.log, hre)
    const upgrader = new ContractUpgrader(deployer)

    upgradedContracts = await upgrader.upgrade({
      contracts: ["StakingRewards"],
    })

    deployEffects.add(
      await changeImplementations({
        contracts: upgradedContracts,
      })
    )

    await deployEffects.executeDeferred()
  }

  return {
    gfi: await getTruffleContract<GFIInstance>("GFI"),
    fidu: await getTruffleContract<FiduInstance>("Fidu"),
    usdc: await getTruffleContract<ERC20Instance>("ERC20", {at: getERC20Address("USDC", MAINNET_CHAIN_ID)}),
    seniorPool: await getTruffleContract<SeniorPoolInstance>("SeniorPool"),
    stakingRewards: await getTruffleContract<StakingRewardsInstance>("StakingRewards", {
      at: upgradedContracts.StakingRewards?.ProxyContract.address,
    }),
  }
})

describe("StakingRewards", () => {
  let gfi: GFIInstance,
    stakingRewards: StakingRewardsInstance,
    fidu: FiduInstance,
    seniorPool: SeniorPoolInstance,
    usdc: ERC20Instance

  beforeEach(async () => ({gfi, stakingRewards, fidu, seniorPool, usdc} = await setupTest()))

  describe("curve lp", () => {
    describe("account with pre-migration position", () => {
      let account
      const tokenId = new BN(1438)
      let amount

      const setup = deployments.createFixture(async () => {
        const position = await stakingRewards.getPosition(tokenId)
        expect(position.amount).to.bignumber.gt(new BN(0))
        amount = position.amount
        account = await stakingRewards.ownerOf(tokenId)
        await impersonateAccount(hre, account)
        await fundWithWhales(["ETH", "USDC"], [account])
      })

      beforeEach(async () => {
        await setup()
      })

      it("continues vesting unvested rewards after fully unstaking without slashing", async () => {
        // Establish totalUnvested before unstaking, cover slashing case
        await stakingRewards.getReward(tokenId, {from: account})
        const {totalUnvested, endTime} = (await stakingRewards.positions(new BN(tokenId)))[1]
        const expectedChange = new BN(totalUnvested)
          .mul(new BN(30).mul(SECONDS_PER_DAY))
          .div(new BN(endTime).sub(await time.latest()))

        await stakingRewards.unstake(tokenId, amount, {from: account})
        await stakingRewards.getReward(tokenId, {from: account})

        const balanceBefore = await gfi.balanceOf(account)

        await advanceTime({days: 30})

        await expectAction(() => stakingRewards.getReward(tokenId, {from: account})).toChange([
          [async () => (await gfi.balanceOf(account)).sub(balanceBefore), {byCloseTo: expectedChange}],
        ])
      })

      it("stops earning after vesting period if unstaked", async () => {
        await stakingRewards.unstake(tokenId, amount, {from: account})
        await advanceTime({days: 365})

        await stakingRewards.getReward(tokenId, {from: account})
        const balanceBefore = await gfi.balanceOf(account)

        await advanceTime({days: 30})

        await stakingRewards.getReward(tokenId, {from: account})
        expect(await gfi.balanceOf(account)).to.bignumber.eq(balanceBefore)
      })

      it("earns without vesting on a new position", async () => {
        let fiduAmount
        {
          await erc20Approve(usdc, seniorPool.address, usdcVal(5000), [account])
          const receipt = await seniorPool.deposit(usdcVal(5000), {from: account})
          const depositEvent = getFirstLog<DepositMade>(decodeLogs(receipt.receipt.rawLogs, seniorPool, "DepositMade"))
          fiduAmount = new BN(depositEvent.args.shares)
        }

        await fidu.approve(stakingRewards.address, fiduAmount, {from: account})

        const receipt = await stakingRewards.stake(fiduAmount, StakedPositionType.Fidu, {from: account})
        const stakedTokenId = getFirstLog<Staked>(decodeLogs(receipt.receipt.rawLogs, stakingRewards, "Staked")).args
          .tokenId

        await advanceTime({days: 30})

        await stakingRewards.getReward(stakedTokenId, {from: account})
        const {totalClaimed, totalUnvested, totalVested} = (await stakingRewards.positions(new BN(stakedTokenId)))[1]

        expect(totalClaimed).to.bignumber.eq(new BN(totalUnvested).add(new BN(totalVested)))
      })
    })
  })

  describe("fidu", () => {
    describe("account with pre-migration position", () => {
      let account
      const tokenId = new BN(200)
      let amount

      const setup = deployments.createFixture(async () => {
        const position = await stakingRewards.getPosition(tokenId)
        expect(position.amount).to.bignumber.gt(new BN(0))
        amount = position.amount
        account = await stakingRewards.ownerOf(tokenId)
        await impersonateAccount(hre, account)
        await fundWithWhales(["ETH", "USDC"], [account])
      })

      beforeEach(async () => {
        await setup()
      })

      it("continues vesting unvested rewards after fully unstaking without slashing", async () => {
        // Establish totalUnvested before unstaking, cover slashing case
        await stakingRewards.getReward(tokenId, {from: account})
        const {totalUnvested, endTime} = (await stakingRewards.positions(new BN(tokenId)))[1]
        const expectedChange = new BN(totalUnvested)
          .mul(new BN(30).mul(SECONDS_PER_DAY))
          .div(new BN(endTime).sub(await time.latest()))

        await stakingRewards.unstake(tokenId, amount, {from: account})
        await stakingRewards.getReward(tokenId, {from: account})

        const balanceBefore = await gfi.balanceOf(account)

        await advanceTime({days: 30})

        await expectAction(() => stakingRewards.getReward(tokenId, {from: account})).toChange([
          [async () => (await gfi.balanceOf(account)).sub(balanceBefore), {byCloseTo: expectedChange}],
        ])
      })

      it("stops earning after vesting period if unstaked", async () => {
        await stakingRewards.unstake(tokenId, amount, {from: account})
        await advanceTime({days: 365})

        await stakingRewards.getReward(tokenId, {from: account})
        const balanceBefore = await gfi.balanceOf(account)

        await advanceTime({days: 30})

        await stakingRewards.getReward(tokenId, {from: account})
        expect(await gfi.balanceOf(account)).to.bignumber.eq(balanceBefore)
      })

      it("earns without vesting on a new position", async () => {
        let fiduAmount
        {
          await erc20Approve(usdc, seniorPool.address, usdcVal(5000), [account])
          const receipt = await seniorPool.deposit(usdcVal(5000), {from: account})
          const depositEvent = getFirstLog<DepositMade>(decodeLogs(receipt.receipt.rawLogs, seniorPool, "DepositMade"))
          fiduAmount = new BN(depositEvent.args.shares)
        }

        await fidu.approve(stakingRewards.address, fiduAmount, {from: account})

        const receipt = await stakingRewards.stake(fiduAmount, StakedPositionType.Fidu, {from: account})
        const stakedTokenId = getFirstLog<Staked>(decodeLogs(receipt.receipt.rawLogs, stakingRewards, "Staked")).args
          .tokenId

        await advanceTime({days: 30})

        await stakingRewards.getReward(stakedTokenId, {from: account})
        const {totalClaimed, totalUnvested, totalVested} = (await stakingRewards.positions(new BN(stakedTokenId)))[1]

        expect(totalClaimed).to.bignumber.eq(new BN(totalUnvested).add(new BN(totalVested)))
      })
    })
  })
})
