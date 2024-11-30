export type PacketData = {
  amount: string;
  denom: string;
  receiver: string;
  sender: string;
  memo: string;
};

export type ParsedPacketEvent = {
  packetSequence: string;
  packetSrcChannel: string;
  packetSrcPort: string;
  packetDstChannel: string;
  packetDstPort: string;
  packetData: PacketData;
  packetTimeoutTimestamp: string;
};
