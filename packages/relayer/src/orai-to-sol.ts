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
  WORMHOLE_BRIDGE_ADDRESSES,
} from "./constants";
import { BlockOffset } from "./repositories/block-offset.repository";
import { ProcessedTransaction } from "./repositories/processed-transaction.repository";
import {
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
import { UniversalAddress } from "@wormhole-foundation/sdk";
import { CHAIN_ID_SOLANA } from "@certusone/wormhole-sdk";
import { sleep } from "@wormhole-foundation/relayer-engine";
class OraiSolRelayer {
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
    const wormholeAddress =
      WORMHOLE_BRIDGE_ADDRESSES[EVM_CHAIN_ID_TO_WORMHOLE_CHAIN_ID[chainId]];
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
        const packet: ProcessBridgeTxParams =
          await this.requestBridgeQueue.dequeue();
        try {
          await this.handleRequestBridgePacket(packet);
        } catch (err) {
          this.logger.error(
            "[handleRequestBridgePacket] failed: ",
            err,
            packet.txHash,
            packet.txMemo
          );
        }
      }
      await setTimeout(ITERATION_DELAY.REQUEST_BRIDGE_PACKET_DELAY);
    }
  }

  async handleRequestBridgePacket(packet: ProcessBridgeTxParams) {
    const { sendPacket, txHash } = packet;
    const stargateClient = await StargateClient.connect(env.obridge.rpcUrl);
    const packetData = parsePacketEvent(sendPacket);
    if (!packetData) {
      this.logger.warn(
        "[handleRequestBridgePacket] parsePacketEvent failed due to missing attributes. Skip this packet with tx hash and memo",
        packet.txHash,
        packet.txMemo
      );
      return;
    }
    const msgIndexItem = sendPacket.attributes.find(
      (item) => item.key === "msg_index"
    );
    if (!msgIndexItem) {
      this.logger.warn(
        "[handleRequestBridgePacket] Could not find any attribute with key 'msg_index'. Skip this packet with tx hash and memo",
        packet.txHash,
        packet.txMemo
      );
      return;
    }
    const msgIndex = Number(msgIndexItem.value);
    const packetTimeout = new Date(
      Math.floor(Number(packetData.packetTimeoutTimestamp) / 1000000)
    ).getTime();
    const currentTime = new Date().getTime();
    if (packetTimeout < currentTime) {
      this.logger.warn(
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
      this.logger.error(
        "[handleRequestBridgePacket] failed: ",
        err,
        packet.txHash,
        packet.txMemo
      );
    }
  }

  async runOraiSolProcess() {
    while (true) {
      const size = await this.oraiSolQueue.size();
      if (size > 0) {
        const packet = await this.oraiSolQueue.dequeue();
        try {
          const parsedPacket = parsePacketEvent(packet.sendPacket);
          if (!parsedPacket) {
            this.logger.warn(
              "[runOraiSolProcess] parsePacketEvent failed due to missing attributes. Skip this packet with tx hash and memo",
              packet.txHash,
              packet.txMemo
            );
            continue;
          }
          console.log(parsedPacket);
          this.logger.info(
            `[runOraiSolProcess] found packet with sequence ${parsedPacket.packetSequence} at txHash: ${packet.txHash}`
          );
          await this.handleOraiSolPacket(packet);
        } catch (err) {
          this.logger.error(
            "[handleOraiSolPacket] failed: ",
            err,
            packet.txHash,
            packet.txMemo
          );
          // DO NOT retry by re-adding it to the queue! If something goes wrong -> handle manually
          // await this.oraiSolQueue.enqueue(packet);
        }
      }
      await this.syncBlockOffset();
      await setTimeout(ITERATION_DELAY.ORAI_TO_SOL_BRIDGE_DELAY);
    }
  }

  async handleOraiSolPacket(packet: ProcessBridgeTxParams) {
    const { sendPacket, txHash, txMemo } = packet;
    const parsedPacket = parsePacketEvent(sendPacket);
    if (!parsedPacket) {
      this.logger.warn(
        "[handleOraiSolPacket] parsePacketEvent failed due to missing attributes. Skip this packet with tx hash and memo",
        packet.txHash,
        packet.txMemo
      );
      return;
    }
    const packetData = parsedPacket.packetData;
    const msgIndexItem = sendPacket.attributes.find(
      (item) => item.key === "msg_index"
    );
    if (!msgIndexItem) {
      this.logger.warn(
        "[handleOraiSolPacket] Could not find any attribute with key 'msg_index'. Skip this packet with tx hash and memo",
        packet.txHash,
        packet.txMemo
      );
      return;
    }
    const msgIndex = Number(msgIndexItem.value);
    const dstEvmAddr = parseTokenAddress(packetData.memo);
    if (!dstEvmAddr) {
      this.logger.error(
        "[handleOraiSolPacket] packet data memo is not a valid dst Evm Address. Skipping this packet...",
        packet.txHash,
        packet.txMemo,
        packetData.memo
      );
      return;
    }
    const recvEvmAddr = this.evmWallet.address;
    if (dstEvmAddr !== recvEvmAddr) {
      // skip if not correct addr
      this.logger.warn(
        "[handleOraiSolPacket] dstEvmAddr is not recvEvmAddr, skip this packet Sol Bridge...",
        dstEvmAddr,
        recvEvmAddr,
        packet.txHash,
        packet.txMemo
      );
      return;
    }
    if (!this.initProvider) {
      this.logger.error(
        "[handleOraiSolPacket] The initProvider is empty!",
        packet.txHash,
        packet.txMemo
      );
      return;
    }
    if (!validateSolanaAddress(txMemo)) {
      this.logger.warn(
        "[handleOraiSolPacket] tx memo is not a valid Solana Address.",
        packet.txHash,
        packet.txMemo
      );
      return;
    }

    const wormholeBridgeAddress: string =
      WORMHOLE_BRIDGE_ADDRESSES[
        EVM_CHAIN_ID_TO_WORMHOLE_CHAIN_ID[this.evmChainId!]
      ];
    const solAddress = txMemo;
    const tokenAddress = parseTokenAddress(packetData.denom);
    if (!tokenAddress) {
      this.logger.error(
        "[handleOraiSolPacket] packet data denom is not a valid token Address. Skipping this packet...",
        packet.txHash,
        packet.txMemo,
        packetData.denom
      );
      return;
    }
    const tokenClient = ERC20__factory.connect(tokenAddress, this.evmWallet);
    const relayerBalance = await tokenClient.balanceOf(recvEvmAddr);
    const sendingAmount = ethers.BigNumber.from(packetData.amount);

    // try to find duplicates
    const data = await this.processedTransactionRepository.get(
      txHash,
      msgIndex
    );
    if (data) {
      return;
    }

    if (relayerBalance.lt(sendingAmount)) {
      throw new Error("[handleOraiSolPacket] Not enough balance to send!");
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
    this.logger.info(
      `Transfer token at ${transferTx.hash} with msg index ${msgIndex}`
    );
    // This part is important. We need to make sure the tx hash and msg index is stored before moving on to the next tx
    while (true) {
      try {
        await this.processedTransactionRepository.insert(txHash, msgIndex);
      } catch (error) {
        this.logger.error(
          `[handleOraiSolPacket] Error inserting tx hash ${txHash} with msgIndex ${msgIndex} into the db. Retrying...`,
          txHash,
          msgIndex,
          packet.txMemo
        );
        await setTimeout(ITERATION_DELAY.ORAI_TO_SOL_BRIDGE_DELAY);
      }
    }
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

export default OraiSolRelayer;
