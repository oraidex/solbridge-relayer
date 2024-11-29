import {
  CosmwasmWatcherEvent,
  createCosmosBridgeWatcher,
} from "@src/services/cosmos.service";
import { OraiSolRelayer } from "./orai-to-sol";
import { logger } from "./configs/logger.config";
import { DuckDb } from "./services/duckdb.service";
import envConfig from "./configs/env.config";
import { BlockOffset } from "./repositories/block-offset.repository";
import { ProcessedTransaction } from "./repositories/processed-transaction.repository";
import { ethers } from "ethers";

const main = async () => {
  const wallet = new ethers.Wallet(envConfig.evm.privateKey);
  const duckDb = await DuckDb.getInstance(envConfig.duckDb.connectionString);
  const blockOffset = new BlockOffset(duckDb);
  await blockOffset.createTable();
  const processedTransaction = new ProcessedTransaction(duckDb);
  await processedTransaction.createTable();
  const cosmosBridgeWatcher = await createCosmosBridgeWatcher(blockOffset);
  const loggerService = logger("OraiSolRelayer");
  const oraiSolRelayer = new OraiSolRelayer(
    cosmosBridgeWatcher,
    processedTransaction,
    blockOffset,
    wallet,
    loggerService
  );
  await oraiSolRelayer.connectProvider();
  await oraiSolRelayer.start();
};

main();
