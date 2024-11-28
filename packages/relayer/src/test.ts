import {
  CosmwasmWatcherEvent,
  createCosmosBridgeWatcher,
} from "@src/services/cosmos.service";
import { OraiSolRelayer } from "./orai-to-sol";
import { logger } from "./configs/logger.config";

const main = async () => {
  const cosmosBridgeWatcher = await createCosmosBridgeWatcher();
  const loggerService = logger("OraiSolRelayer");
  const oraiSolRelayer = new OraiSolRelayer(cosmosBridgeWatcher, loggerService);
  await oraiSolRelayer.start();
};

main();
