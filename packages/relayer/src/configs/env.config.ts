import Joi from "joi";
import dotenv from "dotenv";
dotenv.config();

const envVarsSchema = Joi.object()
  .keys({
    EVM_PRIVATE_KEY: Joi.string().required(),
    EVM_RPC_URL: Joi.string().required(),
    SPY_ENDPOINT: Joi.string().allow("").optional(),
    START_SEQUENCE: Joi.number().allow("").optional(),
    REDIS_HOST: Joi.string().allow("").optional(),
    REDIS_PORT: Joi.number().allow("").optional(),
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
    bridge: {
      syncLimit: envVars.SYNC_LIMIT,
      maxThreadLevel: envVars.MAX_THREAD_LEVEL,
      syncBlockOffset: envVars.SYNC_BLOCK_OFFSET,
      syncInterval: envVars.SYNC_INTERVAL,
    },
  },
  wormhole: {
    startSequence: envVars?.START_SEQUENCE || 0,
    spyEndpoint: envVars?.SPY_ENDPOINT || "http://localhost:7073",
  },
  obridge: {
    rpcUrl: envVars.OBRIDGE_RPC_URL,
  },
  evm: {
    privateKey: envVars.EVM_PRIVATE_KEY,
    rpcUrl: envVars.EVM_RPC_URL,
  },
  redis: {
    host: envVars?.REDIS_HOST || "localhost",
    port: envVars?.REDIS_PORT || 6379,
  },
  logger: {
    webhookUrl: envVars.WEBHOOK_URL,
  },
};
