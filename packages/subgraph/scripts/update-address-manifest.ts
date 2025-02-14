import path from "path"
import fs from "fs"

import mainnetDeployments from "../../protocol/deployments/all.json"

type KnownNetwork = "mainnet" | "localhost"
const NETWORK_NAME = (process.env.NETWORK_NAME as KnownNetwork) ?? "mainnet"

console.log(`Updating the address manifest for network ${NETWORK_NAME}`)

const devDeploymentsPath = path.resolve(__dirname, "../../protocol/deployments/all_dev.json")
let devDeployments: {"31337": {localhost: typeof mainnetDeployments["1"]["mainnet"]}} | null = null
if (fs.existsSync(devDeploymentsPath)) {
  devDeployments = JSON.parse(fs.readFileSync(devDeploymentsPath).toString())
}

if (NETWORK_NAME === "localhost" && !devDeployments) {
  throw new Error("Requested addresses of localhost contracts, but all_dev.json does not exist")
}

const contracts =
  NETWORK_NAME === "localhost" && devDeployments
    ? devDeployments["31337"].localhost.contracts
    : mainnetDeployments["1"].mainnet.contracts

function getAddress(contractName: keyof typeof contracts): string {
  return contracts[contractName].address.toLowerCase()
}

const code = `
// This file is automatically generated
// Network: ${NETWORK_NAME}
export const STAKING_REWARDS_ADDRESS = "${getAddress("StakingRewards")}";
export const POOL_TOKENS_ADDRESS = "${getAddress("PoolTokens")}";
`
fs.writeFileSync(path.resolve(__dirname, "../src/address-manifest.ts"), code)

console.log("Finished updating the address manifest")
