import {
  Environment,
  StandardRelayerApp,
  StandardRelayerContext,
} from "@wormhole-foundation/relayer-engine";
import { CHAIN_ID_SOLANA, TokenBridgePayload } from "@certusone/wormhole-sdk";
import { logger } from "./logger";

const main = async () => {
  const app = new StandardRelayerApp<StandardRelayerContext>(
    Environment.MAINNET,
    // Other app specific config options can be set here for things
    // like retries, logger, or redis connection settings
    {
      name: "ExampleRelayer",
      logger: logger("ExampleRelayer"),
    }
  );

  app.multiple(
    {
      [CHAIN_ID_SOLANA]: ["wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"],
    },
    async (ctx, next) => {
      let seq = ctx.vaa!.sequence.toString();

      const { payload } = ctx.tokenBridge;
      if (payload.payloadType === TokenBridgePayload.TransferWithPayload) {
        ctx.logger.info(`chain middleware - ${seq} - ${ctx.sourceTxHash}`);
        console.log(`Seq: ${seq}`);
        if (seq == "1028203") {
          console.log("FOUND ME!");
        }
      }

      // only care about transfers
      switch (payload.payloadType) {
        case TokenBridgePayload.TransferWithPayload:
          console.log("Wah ho", payload.to.toString("hex"));
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
          break;
      }
    }
  );

  // app.chain(CHAIN_ID_SOLANA).address(
  //   // Emitter address on Solana
  //   "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb",
  //   // Callback function to invoke on new message
  //   async (ctx, next) => {
  //     let seq = ctx.vaa!.sequence.toString();
  //     ctx.logger.info(`chain middleware - ${seq} - ${ctx.sourceTxHash}`);

  //     const { payload } = ctx.tokenBridge;

  //     // only care about transfers
  //     switch (payload?.payloadType) {
  //       case TokenBridgePayload.Transfer:
  //         ctx.logger.info(
  //           `Transfer processing for: \n` +
  //             `\tToken: ${payload.tokenChain}:${payload.tokenAddress.toString(
  //               "hex"
  //             )}\n` +
  //             `\tAmount: ${payload.amount}\n` +
  //             `\tReceiver: ${payload.toChain}:${payload.to.toString("hex")}\n`
  //         );
  //         break;
  //       case TokenBridgePayload.TransferWithPayload:
  //         ctx.logger.info(
  //           `Transfer processing for: \n` +
  //             `\tToken: ${payload.tokenChain}:${payload.tokenAddress.toString(
  //               "hex"
  //             )}\n` +
  //             `\tAmount: ${payload.amount}\n` +
  //             `\tSender ${payload.fromAddress?.toString("hex")}\n` +
  //             `\tReceiver: ${payload.toChain}:${payload.to.toString("hex")}\n` +
  //             `\tPayload: ${payload.tokenTransferPayload.toString("hex")}\n`
  //         );
  //         break;
  //     }
  //   }
  // );

  await app.listen();
};

main();
