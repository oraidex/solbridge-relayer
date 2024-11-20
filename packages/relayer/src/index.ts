import {
  Environment,
  StandardRelayerApp,
  StandardRelayerContext,
} from "@wormhole-foundation/relayer-engine";
import { CHAIN_ID_SOLANA } from "@certusone/wormhole-sdk";
import { deserialize } from "@wormhole-foundation/sdk";

const main = async () => {
  const app = new StandardRelayerApp<StandardRelayerContext>(
    Environment.MAINNET,
    // Other app specific config options can be set here for things
    // like retries, logger, or redis connection settings
    {
      name: "ExampleRelayer",
    }
  );

  app.chain(CHAIN_ID_SOLANA).address(
    // Emitter address on Solana
    "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb",
    // Callback function to invoke on new message
    async (ctx, next) => {
      const vaaBytes = ctx.vaaBytes;
      if (vaaBytes) {
        const vaa = deserialize(
          "TokenBridge:TransferWithPayload",
          new Uint8Array(vaaBytes.buffer)
        );
        console.log("Got VAA", vaa);
      }
    }
  );

  await app.listen();
};

main();
