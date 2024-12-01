import { Event } from "@cosmjs/stargate";
import { ParsedPacketEvent } from "@src/@types";

export function parsePacketEvent(event: Event): ParsedPacketEvent {
  const packetSequence = event.attributes.find(
    (attr) => attr.key === "packet_sequence"
  )?.value;
  const packetSrcChannel = event.attributes.find(
    (attr) => attr.key === "packet_src_channel"
  )?.value;
  const packetSrcPort = event.attributes.find(
    (attr) => attr.key === "packet_src_port"
  )?.value;
  const packetDstChannel = event.attributes.find(
    (attr) => attr.key === "packet_dst_channel"
  )?.value;
  const packetDstPort = event.attributes.find(
    (attr) => attr.key === "packet_dst_port"
  )?.value;
  const packetDataItem = event.attributes.find(
    (attr) => attr.key === "packet_data"
  );
  const packetData = packetDataItem ? JSON.parse(packetDataItem.value) : null;
  const packetTimeoutTimestamp = event.attributes.find(
    (attr) => attr.key === "packet_timeout_timestamp"
  )?.value;

  if (
    !packetSequence ||
    !packetSrcChannel ||
    !packetSrcPort ||
    !packetDstChannel ||
    !packetDstPort ||
    !packetData ||
    !packetTimeoutTimestamp
  )
    return null;

  return {
    packetSequence: packetSequence,
    packetSrcChannel: packetSrcChannel,
    packetSrcPort: packetSrcPort,
    packetDstChannel: packetDstChannel,
    packetDstPort: packetDstPort,
    packetData,
    packetTimeoutTimestamp: packetTimeoutTimestamp,
  };
}
