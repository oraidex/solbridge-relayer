import { PublicKey } from "@solana/web3.js";
import { validateSolanaAddress } from "./utils";
import {
  EVM_CHAIN_ID_TO_WORMHOLE_CHAIN_ID,
  WORMHOLE_BRIDGE_ADDRESSES,
} from "./constants";
import { ERC20__factory } from "@oraichain/oraidex-common";
import { ethers } from "ethers";
import envConfig from "./configs/env.config";
import { Bridge__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { CHAIN_ID_SOLANA } from "@certusone/wormhole-sdk";
import { UniversalAddress } from "@wormhole-foundation/sdk";

const main = async () => {
  let evmWallet = new ethers.Wallet(envConfig.evm.privateKey);
  evmWallet = evmWallet.connect(
    new ethers.providers.JsonRpcProvider(envConfig.evm.rpcUrl)
  );
  const wormholeBridgeAddress =
    WORMHOLE_BRIDGE_ADDRESSES[EVM_CHAIN_ID_TO_WORMHOLE_CHAIN_ID[56]];
  const solAddress = "4k7xvinq6nB221iBhcP9uMFCPFh29MxQ6LieMH7cqw45";
  const tokenAddress = "0x10407cEa4B614AB11bd05B326193d84ec20851f6";
  const tokenClient = ERC20__factory.connect(tokenAddress, evmWallet);
  const wormholeBridgeClient = Bridge__factory.connect(
    wormholeBridgeAddress,
    evmWallet
  );
  const sendingAmount = ethers.BigNumber.from(
    ethers.utils.parseUnits("0.01", 18)
  );
  const approveTx = await tokenClient.approve(
    wormholeBridgeAddress,
    sendingAmount
  );
  console.log(approveTx.hash);
  const balance = await tokenClient.balanceOf(evmWallet.address);
  console.log({ balance });
  const solUniversalAddress = new UniversalAddress(solAddress, "base58");
  const transferTx = await wormholeBridgeClient.transferTokensWithPayload(
    tokenAddress,
    balance,
    CHAIN_ID_SOLANA,
    solUniversalAddress.toUint8Array(),
    0,
    "0x"
  );
  console.log(transferTx.hash);
};

main();
