import { DuckDb } from "@src/services/duckdb.service";
import { BlockOffset } from "@src/repositories/block-offset.repository";
import { ProcessedTransaction } from "@src/repositories/processed-transaction.repository";
import {
  CHANNEL,
  SyncData,
  SyncDataOptions,
  Txs,
} from "@oraichain/cosmos-rpc-sync";
import { EventEmitter } from "stream";
import env from "@src/configs/env.config";
import { IndexedTx, Event } from "@cosmjs/stargate";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { parsePacketEvent } from "@src/helpers/packet.helper";

export enum CosmwasmWatcherEvent {
  DATA = "data",
}

export const filterSendPackets = (item: IndexedTx): [boolean, Event[]] => {
  const sendPackets = item.events.filter((item) => {
    const packetType = item.type;
    if (packetType !== "send_packet") {
      return false;
    }
    const packetData = parsePacketEvent(item);
    if (packetData.packetSrcChannel !== "channel-29") {
      return false;
    }
    if (
      packetData.packetSrcPort !==
      "wasm.orai195269awwnt5m6c843q6w7hp8rt0k7syfu9de4h0wz384slshuzps8y7ccm"
    ) {
      return false;
    }
    if (packetData.packetDstChannel !== "channel-1") {
      return false;
    }
    if (packetData.packetDstPort !== "transfer") {
      return false;
    }
    return true;
  });
  return [sendPackets.length > 0, sendPackets];
};

export class CosmwasmWatcher extends EventEmitter {
  public running = false;

  constructor(private syncData: SyncData) {
    super();
  }

  async start() {
    if (this.syncData && this.running) {
      this.syncData.destroy();
    }
    this.running = true;
    this.syncData.startSpecificService("polling");
    this.syncData.on(CHANNEL.QUERY, async (chunk: Txs) => {
      try {
        const data = chunk.txs
          .filter((item: IndexedTx) => filterSendPackets(item)[0])
          .map((item: IndexedTx) => {
            const sendPackets = filterSendPackets(item)[1];
            const tx = decodeTxRaw(item.tx);
            return {
              txMemo: tx.body.memo,
              txHash: item.hash,
              sendPackets,
            };
          });
        this.emit(CosmwasmWatcherEvent.DATA, data);
      } catch (e) {
        this.emit("error", `CosmwasmWatcher:Error when parsing data:${e}`);
      }
    });
  }

  clearSyncData() {
    this.running = false;
    this.syncData.destroy();
  }

  setSyncData(syncData: SyncData) {
    this.syncData = syncData;
  }
}

export const createCosmosBridgeWatcher = async () => {
  const duckDb = await DuckDb.getInstance(env.duckDb.connectionString);
  const blockOffset = new BlockOffset(duckDb);
  await blockOffset.createTable();
  const processedTransaction = new ProcessedTransaction(duckDb);
  await processedTransaction.createTable();
  const offset = await blockOffset.mayLoadBlockOffset(
    env.cosmos.syncBlockOffset
  );
  const syncDataOpt: SyncDataOptions = {
    rpcUrl: env.cosmos.rpcUrl,
    limit: env.cosmos.syncLimit,
    maxThreadLevel: env.cosmos.maxThreadLevel,
    offset: offset,
    interval: env.cosmos.syncInterval,
    queryTags: [],
  };
  if (offset < env.cosmos.syncBlockOffset) {
    syncDataOpt.offset = env.cosmos.syncBlockOffset;
  }
  const syncData = new SyncData(syncDataOpt);
  await syncData.initClient();
  const cosmwasmWatcher = new CosmwasmWatcher(syncData);
  return cosmwasmWatcher;
};
