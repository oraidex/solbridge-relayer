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
  const packetData = JSON.parse(
    event.attributes.find((attr) => attr.key === "packet_data")?.value || "{}"
  );
  const packetTimeoutTimestamp = event.attributes.find(
    (attr) => attr.key === "packet_timeout_timestamp"
  )?.value;

  return {
    packetSequence: packetSequence || "",
    packetSrcChannel: packetSrcChannel || "",
    packetSrcPort: packetSrcPort || "",
    packetDstChannel: packetDstChannel || "",
    packetDstPort: packetDstPort || "",
    packetData,
    packetTimeoutTimestamp: packetTimeoutTimestamp || "",
  };
}
