import {
  Environment,
  fetchVaaHash,
  StandardRelayerApp,
  StandardRelayerContext,
} from "@wormhole-foundation/relayer-engine";
import {
  CHAIN_ID_SOLANA,
  TokenBridgePayload,
  getIsTransferCompletedEth,
  CONTRACTS,
  redeemOnEth,
} from "@certusone/wormhole-sdk";

import {
  chainIdToChain,
  deserialize,
  UniversalAddress,
} from "@wormhole-foundation/sdk";
import { TokenBridge__factory } from "./types";

import { logger } from "./logger";
import { MemoryQueue } from "./MemoryQueue";
import { ethers } from "ethers";
import { config } from "dotenv";
import {
  Gravity__factory,
  ERC20__factory,
  gravityContracts,
} from "@oraichain/oraidex-common";
import { toBech32 } from "@cosmjs/encoding";
import {
  AttestationContext,
  attestationMiddleware,
} from "./attestation.middleware";
config();

const interval = +process.env.INTERVAL || 2000;
const queue = new MemoryQueue("ParsedVaaQueue");
const attestMetaQueue = new MemoryQueue("AttestMetaQueue");
const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY);
// const wallet2 = new ethers.Wallet(process.env.ETH_PRIVATE_KEY_2);

const jsonRpcProvider = new ethers.providers.JsonRpcProvider(
  process.env.BSC_RPC
);
const signerGravity = wallet.connect(jsonRpcProvider);
// const signerWormhole = wallet2.connect(jsonRpcProvider);
const gravityContract = Gravity__factory.connect(
  gravityContracts["0x38"],
  signerGravity
);
const walletAddress = signerGravity.address.toLowerCase();

// // Create the Token Bridge contract instance
const wormholeBridgeBsc = TokenBridge__factory.connect(
  CONTRACTS.MAINNET.bsc.token_bridge,
  signerGravity
);

export type GravityRelayerContext = StandardRelayerContext & AttestationContext;

const main = async () => {
  const app = new StandardRelayerApp<GravityRelayerContext>(
    Environment.MAINNET,
    {
      name: "GravityRelayer",
      logger: logger("GravityRelayer"),
      spyEndpoint: process.env.SPY_ENDPOINT,
      redis: {
        host: process.env.REDIS_HOST || "localhost",
        port: +process.env.REDIS_PORT || 6379,
      },
      missedVaaOptions: {
        startingSequenceConfig: {
          1: BigInt(process.env.START_SEQUENCE || 0),
        },
      },
    }
  );
  app.multiple(
    {
      [CHAIN_ID_SOLANA]: ["wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"],
    },
    attestationMiddleware(),
    async (ctx, next) => {
      const seq = ctx.vaa!.sequence.toString();
      const bytes = ctx.vaa.bytes;
      const { payload } = ctx.tokenBridge;
      // Check if the payload is a transfer
      if (payload.payloadType == TokenBridgePayload.TransferWithPayload) {
        await queue.enqueue(bytes.toString("base64"));
        ctx.logger.info("Process Sequence: " + seq);
        ctx.logger.info(
          `Transfer processing for: \n` +
            `\tToken: ${payload.tokenChain}:${payload.tokenAddress.toString(
              "hex"
            )}\n` +
            `\tAmount: ${payload.amount}\n` +
            `\tSender ${payload.fromAddress?.toString("hex")}\n` +
            `\tReceiver: ${payload.toChain}:${payload.to.toString("hex")}\n` +
            `\tPayload: ${payload.tokenTransferPayload.toString("hex")}\n`
        );
      }

      next();
    }
  );

  await app.listen();
};

(async () => {
  // Long running process
  const handleQueueProcessLogger = logger("handleQueueProcess");
  const handleParsedVaaQueue = async () => {
    const queueSize = await queue.size();
    if (queueSize > 0) {
      const bytes = await queue.dequeue();
      const isTransferCompleted = await getIsTransferCompletedEth(
        CONTRACTS.MAINNET.bsc.token_bridge,
        signerGravity,
        new Uint8Array(Buffer.from(bytes, "base64"))
      );

      if (!isTransferCompleted) {
        const parsedTransferWithPayload = deserialize(
          "TokenBridge:TransferWithPayload",
          new Uint8Array(Buffer.from(bytes, "base64"))
        );
        const amount = parsedTransferWithPayload.payload.token.amount;
        const isSolanaToBsc =
          parsedTransferWithPayload.payload.to.chain == "Bsc" &&
          parsedTransferWithPayload.payload.token.chain === "Solana";
        handleQueueProcessLogger.info(
          `Found ${parsedTransferWithPayload.sequence} `
        );

        if (isSolanaToBsc) {
          const toAddress = parsedTransferWithPayload.payload.to.address
            .toNative("Bsc")
            .address.toLowerCase();
          const tokenAddress =
            parsedTransferWithPayload.payload.token.address.toString();
          const tokenWrappedAddress = await wormholeBridgeBsc.wrappedAsset(
            CHAIN_ID_SOLANA,
            tokenAddress
          );

          if (toAddress === walletAddress) {
            const oraiWallet = toBech32(
              "orai",
              parsedTransferWithPayload.payload.payload
            );
            handleQueueProcessLogger.info(
              `Found ${parsedTransferWithPayload.sequence} transfer to ${oraiWallet}`
            );
            const tokenContract = ERC20__factory.connect(
              tokenWrappedAddress,
              signerGravity
            );
            const allowance = await tokenContract.allowance(
              walletAddress,
              gravityContracts["0x38"]
            );
            if (allowance.toBigInt() < amount) {
              const txApprove = await tokenContract.approve(
                gravityContracts["0x38"],
                9999999999999999999999999n
              );
              const txApproveReceipt = await txApprove.wait();
              handleQueueProcessLogger.info(
                `Approve txHash: ${txApproveReceipt.transactionHash}`
              );
            }
            const redeemTx = await redeemOnEth(
              CONTRACTS.MAINNET.bsc.token_bridge,
              signerGravity,
              new Uint8Array(Buffer.from(bytes, "base64"))
            );
            handleQueueProcessLogger.info(
              `Redeem ${parsedTransferWithPayload.sequence} at txHash: ${redeemTx.transactionHash}`
            );
            const txSendToCosmos = await gravityContract.sendToCosmos(
              tokenWrappedAddress,
              `channel-6/${oraiWallet}`,
              amount
            );
            const txSendToCosmosReceipt = await txSendToCosmos.wait();
            handleQueueProcessLogger.info(
              `Send to Cosmos txHash: ${txSendToCosmosReceipt.transactionHash}`
            );
          }
        }
      }
    }
    setTimeout(handleParsedVaaQueue, interval);
  };
  setTimeout(handleParsedVaaQueue, interval);

  // const handleAttestMetaLogger = logger("handleAttestMeta");
  // const handleAttestMetaVaaQueue = async () => {
  //   const queueSize = await attestMetaQueue.size();
  //   if (queueSize > 0) {
  //     const bytes = await queue.dequeue();
  //     const hex = Buffer.from(bytes, "base64").toString("hex");
  //     const createdWrapped = await wormholeBridgeBsc.createWrapped("0x" + hex);
  //     const createdWrappedReceipt = await createdWrapped.wait();
  //     handleAttestMetaLogger.info(
  //       `Create wrapped at txHash: ${createdWrappedReceipt.transactionHash}`
  //     );
  //   }
  //   setTimeout(handleParsedVaaQueue, interval);
  // };
  // setTimeout(handleAttestMetaVaaQueue, interval);
})();

main();

process.on("uncaughtException", (err) => {
  console.error(err);
  process.exit(1);
});
