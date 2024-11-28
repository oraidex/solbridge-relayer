import { StargateClient } from "@cosmjs/stargate";
import { PacketData, ProcessBridgeTxParams } from "./@types";
import { Logger } from "winston";
import { MemoryQueue } from "./MemoryQueue";
import {
  CosmwasmWatcher,
  CosmwasmWatcherEvent,
} from "./services/cosmos.service";
import env from "./configs/env.config";
import { QueryTag } from "@cosmjs/tendermint-rpc";
import { parsePacketEvent } from "@src/helpers/packet.helper";
import { setTimeout } from "timers/promises";

export class OraiSolRelayer {
  protected requestBridgeQueue: MemoryQueue<ProcessBridgeTxParams>;
  protected oraiSolQueue: MemoryQueue<ProcessBridgeTxParams>;

  constructor(
    protected cosmwasmWatcher: CosmwasmWatcher,
    protected logger: Logger
  ) {
    this.requestBridgeQueue = new MemoryQueue<ProcessBridgeTxParams>(
      "requestBridgeQueue"
    );
    this.oraiSolQueue = new MemoryQueue<ProcessBridgeTxParams>("oraiSolQueue");
  }

  async runRequestBridgeProcess() {
    while (true) {
      const size = await this.requestBridgeQueue.size();
      if (size > 0) {
        const packet = await this.requestBridgeQueue.dequeue();
        try {
          await this.handleRequestBridgePacket(packet);
        } catch (err) {
          this.logger.error("[handleRequestBridgePacket] failed:", err);
        }
      }
      await setTimeout(3000);
    }
  }

  async handleRequestBridgePacket(packet: ProcessBridgeTxParams) {
    const { sendPacket, txHash } = packet;
    const stargateClient = await StargateClient.connect(env.obridge.rpcUrl);
    const packetData = parsePacketEvent(sendPacket);
    const msgIndex = Number(
      sendPacket.attributes.find((item) => item.key === "msg_index")?.value || 0
    );
    const packetTimeout = new Date(
      Math.floor(Number(packetData.packetTimeoutTimestamp) / 1000000)
    ).getTime();
    const currentTime = new Date().getTime();
    if (packetTimeout < currentTime) {
      this.logger.info(
        `Packet with txHash ${txHash} on msg index ${msgIndex} has been timeout, and removed out of queue!`
      );
      return;
    }
    const queryTags: QueryTag[] = [
      {
        key: `recv_packet.packet_sequence`,
        value: `${packetData.packetSequence}`,
      },
      {
        key: `recv_packet.packet_src_channel`,
        value: packetData.packetSrcChannel,
      },
      {
        key: `recv_packet.packet_dst_channel`,
        value: packetData.packetDstChannel,
      },
    ];

    let loop = 0;
    while (true) {
      if (loop === 10) {
        throw new Error("Failed to fetch packet data on Orai Bridge!");
      }

      const txs = await stargateClient.searchTx(queryTags);
      console.log(txs, queryTags);
      if (txs.length === 0) {
        await setTimeout(5000);
        loop++;
        continue;
      }

      await this.oraiSolQueue.enqueue(packet);
    }
  }

  async runOraiSolProcess() {
    while (true) {
      const size = await this.oraiSolQueue.size();
      if (size > 0) {
        const packet = await this.oraiSolQueue.dequeue();
        try {
          const parsedPacket = parsePacketEvent(packet.sendPacket);
          this.logger.info(
            `[runOraiSolProcess] found packet: ${parsedPacket} at txHash: ${packet.txHash}`
          );
        } catch (err) {
          this.logger.error("[handleOraiSolPacket] failed:", err);
        }
      }
      await setTimeout(3000);
    }
  }

  async start() {
    this.cosmwasmWatcher.on(CosmwasmWatcherEvent.DATA, async (chunkData) => {
      for (const data of chunkData) {
        const { txMemo, txHash, sendPackets } = data;

        for (const sendPacket of sendPackets) {
          await this.requestBridgeQueue.enqueue({
            txMemo,
            txHash,
            sendPacket,
          });
        }
      }
    });

    await Promise.all([
      this.cosmwasmWatcher.start(),
      this.runRequestBridgeProcess(),
      this.runOraiSolProcess(),
    ]);
  }
}
