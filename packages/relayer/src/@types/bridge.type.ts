import { Event, IndexedTx } from "@cosmjs/stargate";

export interface ProcessBridgeTxParams {
  txMemo: string;
  txHash: string;
  sendPacket: Event;
}
