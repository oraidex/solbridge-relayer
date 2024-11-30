import { DuckDb } from "../../services/duckdb.service";
import envConfig from "../../configs/env.config";
import { BlockOffset } from "@src/repositories/block-offset.repository";

const main = async () => {
  const duckDb = await DuckDb.getInstance(envConfig.duckDb.connectionString);
  const blockOffset = new BlockOffset(duckDb);
  console.log(await blockOffset.getBlockOffset());
};

main();
