import { StargateClient } from "@cosmjs/stargate";
import { ProcessBridgeTxParams } from "./@types";
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
import {
  EVM_CHAIN_ID_TO_WORMHOLE_CHAIN_ID,
  ITERATION_DELAY,
  WORMHOLE_ADDRESSES,
  WORMHOLE_BRIDGE_ADDRESSES,
} from "./constants";
import { BlockOffset } from "./repositories/block-offset.repository";
import { ProcessedTransaction } from "./repositories/processed-transaction.repository";
import {
  parseDestAddrFromMemo,
  parseTokenAddress,
  retryWrapperFn,
  validateSolanaAddress,
} from "./utils";
import { ethers } from "ethers";
import {
  Bridge,
  Bridge__factory,
} from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { ERC20__factory } from "@oraichain/oraidex-common";
import { UniversalAddress, ChainAddress } from "@wormhole-foundation/sdk";
import { CHAIN_ID_SOLANA } from "@certusone/wormhole-sdk";

export class OraiSolRelayer {
  public evmProvider?: ethers.providers.JsonRpcProvider;
  public evmChainId?: number;
  protected requestBridgeQueue: MemoryQueue<ProcessBridgeTxParams>;
  protected oraiSolQueue: MemoryQueue<ProcessBridgeTxParams>;
  protected wormholeBridgeClient?: Bridge;
  private initProvider: boolean = false;

  constructor(
    protected cosmwasmWatcher: CosmwasmWatcher,
    protected processedTransactionRepository: ProcessedTransaction,
    protected blockOffsetRepository: BlockOffset,
    protected evmWallet: ethers.Wallet,
    protected logger: Logger
  ) {
    this.requestBridgeQueue = new MemoryQueue<ProcessBridgeTxParams>(
      "requestBridgeQueue"
    );
    this.oraiSolQueue = new MemoryQueue<ProcessBridgeTxParams>("oraiSolQueue");
  }

  async connectProvider(rpcUrl?: string) {
    const connectRpcUrl = rpcUrl || env.evm.rpcUrl;
    const provider = new ethers.providers.JsonRpcProvider(connectRpcUrl);
    const network = await provider.getNetwork();
    const chainId = network.chainId;
    const wormholeAddress = "0xB6F6D86a8f9879A9c87f643768d9efc38c1Da6E7";
    this.evmChainId = chainId;
    this.evmProvider = provider;
    this.evmWallet = this.evmWallet.connect(provider);
    this.wormholeBridgeClient = Bridge__factory.connect(
      wormholeAddress,
      this.evmWallet
    );
    this.initProvider = true;
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
      await setTimeout(ITERATION_DELAY.REQUEST_BRIDGE_PACKET_DELAY);
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

    try {
      await retryWrapperFn(
        async () => {
          const txs = await stargateClient.searchTx(queryTags);
          if (txs.length === 0) {
            throw new Error("Failed to fetch packet data on Orai Bridge!");
          }
          await this.oraiSolQueue.enqueue(packet);
        },
        10,
        ITERATION_DELAY.RETRY_DELAY
      );
    } catch (err) {
      this.logger.error("[handleRequestBridgePacket] failed:", err);
    }
  }

  async runOraiSolProcess() {
    while (true) {
      const size = await this.oraiSolQueue.size();
      if (size > 0) {
        const packet = await this.oraiSolQueue.dequeue();
        try {
          const parsedPacket = parsePacketEvent(packet.sendPacket);
          console.log(parsedPacket);
          this.logger.info(
            `[runOraiSolProcess] found packet with sequence ${parsedPacket.packetSequence} at txHash: ${packet.txHash}`
          );
          await this.handleOraiSolPacket(packet);
        } catch (err) {
          this.logger.error("[handleOraiSolPacket] failed:", err);
          await this.oraiSolQueue.enqueue(packet);
        }
      }
      // await this.syncBlockOffset();
      await setTimeout(ITERATION_DELAY.ORAI_TO_SOL_BRIDGE_DELAY);
    }
  }

  async handleOraiSolPacket(packet: ProcessBridgeTxParams) {
    const { sendPacket, txHash, txMemo } = packet;
    const parsedPacket = parsePacketEvent(sendPacket);
    const packetData = parsedPacket.packetData;
    const msgIndex = Number(
      sendPacket.attributes.find((item) => item.key === "msg_index")?.value || 0
    );
    const dstEvmAddr = parseDestAddrFromMemo(packetData.memo);
    const recvEvmAddr = this.evmWallet.address;
    console.log(this.initProvider, dstEvmAddr, recvEvmAddr);
    if (dstEvmAddr !== recvEvmAddr) {
      // skip if not correct addr
      return;
    }
    if (!this.initProvider) {
      return;
    }
    if (!validateSolanaAddress(txMemo)) {
      return;
    }

    const wormholeBridgeAddress =
      WORMHOLE_BRIDGE_ADDRESSES[
        EVM_CHAIN_ID_TO_WORMHOLE_CHAIN_ID[this.evmChainId!]
      ];
    const solAddress = txMemo;
    const tokenAddress = parseTokenAddress(packetData.denom);
    const tokenClient = ERC20__factory.connect(tokenAddress, this.evmWallet);
    const relayerBalance = await tokenClient.balanceOf(recvEvmAddr);
    const sendingAmount = ethers.BigNumber.from(packetData.amount);
    const data = await this.processedTransactionRepository.get(
      txHash,
      msgIndex
    );
    if (data) {
      return;
    }

    if (relayerBalance.lt(sendingAmount)) {
      throw new Error("Not enough balance to send!");
    }

    const approveTx = await tokenClient.approve(
      wormholeBridgeAddress,
      sendingAmount
    );
    this.logger.info(
      `Approve for token bridge ${wormholeBridgeAddress} at txHash: ${approveTx.hash}`
    );
    const solUniversalAddress = new UniversalAddress(solAddress, "base58");
    const transferTx =
      await this.wormholeBridgeClient!.transferTokensWithPayload(
        tokenAddress,
        sendingAmount,
        CHAIN_ID_SOLANA,
        solUniversalAddress.toUint8Array(),
        0,
        "0x"
      );
    this.logger.info(`Transfer token at ${transferTx.hash}`);
    console.log({
      txHash,
      msgIndex,
    });
    await this.processedTransactionRepository.insert(txHash, msgIndex);
  }

  async syncBlockOffset() {
    const size = await this.oraiSolQueue.size();
    if (size == 0) {
      const currentBlockOffset = this.cosmwasmWatcher.offset;
      await this.blockOffsetRepository.updateBlockOffset(currentBlockOffset);
      if (currentBlockOffset != 0) {
        this.logger.info(
          `[runOraiSolProcess] save current block offset at: ${currentBlockOffset}`
        );
      }
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
