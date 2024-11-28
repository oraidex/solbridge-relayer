import Joi from "joi";
import dotenv from "dotenv";
dotenv.config();

const envVarsSchema = Joi.object()
  .keys({
    DUCKDB_CONNECTION_STRING: Joi.string().required(),
    COSMOS_RPC_URL: Joi.string().required(),
    OBRIDGE_RPC_URL: Joi.string().required(),
    SYNC_LIMIT: Joi.number().required(),
    MAX_THREAD_LEVEL: Joi.number().required(),
    SYNC_BLOCK_OFFSET: Joi.number().required(),
    SYNC_INTERVAL: Joi.number().required(),
    WEBHOOK_URL: Joi.string().allow("").optional(),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: "key" } })
  .validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export default {
  duckDb: {
    connectionString: envVars.DUCKDB_CONNECTION_STRING,
  },
  cosmos: {
    rpcUrl: envVars.COSMOS_RPC_URL,
    syncLimit: envVars.SYNC_LIMIT,
    maxThreadLevel: envVars.MAX_THREAD_LEVEL,
    syncBlockOffset: envVars.SYNC_BLOCK_OFFSET,
    syncInterval: envVars.SYNC_INTERVAL,
  },
  obridge: {
    rpcUrl: envVars.OBRIDGE_RPC_URL,
  },
  logger: {
    webhookUrl: envVars.WEBHOOK_URL,
  },
};
