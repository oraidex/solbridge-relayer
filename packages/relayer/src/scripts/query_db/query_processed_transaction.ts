import { DuckDb } from "../../services/duckdb.service";
import envConfig from "../../configs/env.config";
import { ProcessedTransaction } from "../../repositories/processed-transaction.repository";

const main = async () => {
  const duckDb = await DuckDb.getInstance(envConfig.duckDb.connectionString);
  const processedTransaction = new ProcessedTransaction(duckDb);
  console.log(await processedTransaction.getAll());
};

main();
