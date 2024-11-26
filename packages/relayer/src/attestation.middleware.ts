import {
  encodeEmitterAddress,
  Environment,
  Middleware,
  ProviderContext,
  UnrecoverableError,
} from "@wormhole-foundation/relayer-engine";
import {
  AssetMeta,
  CHAIN_ID_SUI,
  ChainId,
  coalesceChainName,
  CONTRACTS,
  EVMChainId,
  parseAttestMetaVaa,
  ParsedAttestMetaVaa,
  ParsedVaa,
  SignedVaa,
} from "@certusone/wormhole-sdk";
import {
  ITokenBridge,
  ITokenBridge__factory,
} from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { ethers, logger } from "ethers";
import { getObjectFields } from "@certusone/wormhole-sdk/lib/cjs/sui";

export interface AttestationContext extends ProviderContext {
  attestation: {
    vaa?: ParsedAttestMetaVaa;
    payload?: AssetMeta;
  };
}
function extractTokenBridgeAddressesFromSdk(env: Environment) {
  return Object.fromEntries(
    Object.entries((CONTRACTS as any)[env.toUpperCase()]).map(
      ([chainName, addresses]: any[]) => [chainName, addresses.token_bridge]
    )
  );
}

const tokenBridgeAddresses = {
  [Environment.MAINNET]: extractTokenBridgeAddressesFromSdk(
    Environment.MAINNET
  ),
  [Environment.TESTNET]: extractTokenBridgeAddressesFromSdk(
    Environment.TESTNET
  ),
  [Environment.DEVNET]: extractTokenBridgeAddressesFromSdk(Environment.DEVNET),
};

export type TokenBridgeChainConfigInfo = {
  evm: {
    [k in EVMChainId]: { contracts: ITokenBridge[] };
  };
};

function instantiateReadEvmContracts(
  env: Environment,
  chainRpcs: Partial<Record<EVMChainId, ethers.providers.JsonRpcProvider[]>>
) {
  const evmChainContracts: Partial<{
    [k in EVMChainId]: ITokenBridge[];
  }> = {};
  for (const [chainIdStr, chainRpc] of Object.entries(chainRpcs)) {
    const chainId = Number(chainIdStr) as EVMChainId;
    // @ts-ignore
    const address = tokenBridgeAddresses[env][CHAIN_ID_TO_NAME[chainId]];
    const contracts = chainRpc.map((rpc) =>
      ITokenBridge__factory.connect(address, rpc)
    );
    evmChainContracts[chainId] = contracts;
  }
  return evmChainContracts;
}

// initialized when then first vaa comes through
let tokenBridgeEmitterCapSui = "";

function isAttestationVaa(env: Environment, vaa: ParsedVaa): boolean {
  const chainId = vaa.emitterChain as ChainId;
  const chainName = coalesceChainName(chainId);

  // @ts-ignore TODO remove
  const tokenBridgeLocalAddress =
    vaa.emitterChain === CHAIN_ID_SUI
      ? tokenBridgeEmitterCapSui
      : tokenBridgeAddresses[env][chainName];
  if (!tokenBridgeLocalAddress) {
    return false;
  }

  const emitterAddress = vaa.emitterAddress.toString("hex");
  const tokenBridgeEmitterAddress = encodeEmitterAddress(
    chainId,
    tokenBridgeLocalAddress
  );
  return tokenBridgeEmitterAddress === emitterAddress;
}

function tryToParseAttestationVaa(
  vaaBytes: SignedVaa
): ParsedAttestMetaVaa | undefined {
  try {
    return parseAttestMetaVaa(vaaBytes);
  } catch (e) {
    // it may not be a token transfer vaa. TODO Maybe we want to do something to support attestations etc.
    return undefined;
  }
}

export function attestationMiddleware(): Middleware<AttestationContext> {
  let evmContracts: Partial<{ [k in EVMChainId]: ITokenBridge[] }>;
  // Sui State
  let suiState: Record<any, any>;
  return async (ctx: AttestationContext, next) => {
    if (!ctx.providers) {
      throw new UnrecoverableError(
        "You need to first use the providers middleware."
      );
    }

    // User might or might not use sui, so a provider for sui
    // might not be present.
    if (suiState === undefined && ctx.providers.sui.length > 0) {
      const fields = await getObjectFields(
        ctx.providers.sui[0],
        CONTRACTS[ctx.env.toUpperCase() as "MAINNET" | "TESTNET" | "DEVNET"].sui
          .token_bridge
      );
      if (fields === null) {
        throw new UnrecoverableError("Couldn't read Sui object field");
      }
      suiState = fields;
      tokenBridgeEmitterCapSui = suiState?.emitter_cap.fields.id.id;
    }

    if (!evmContracts) {
      ctx.logger?.debug(`Token Bridge Contracts initializing...`);
      evmContracts = instantiateReadEvmContracts(ctx.env, ctx.providers.evm);
      ctx.logger?.debug(`Token Bridge Contracts initialized`);
    }

    // TODO: should we actually allow these fields to be undefined in the context type?
    if (ctx.vaa === undefined) {
      throw new UnrecoverableError("Parsed VAA is undefined.");
    }
    if (ctx.vaaBytes === undefined) {
      throw new UnrecoverableError("Raw VAA is undefined.");
    }

    let parsedAttestationMetaVaa: ParsedAttestMetaVaa | undefined;
    let payload;
    if (isAttestationVaa(ctx.env, ctx.vaa)) {
      parsedAttestationMetaVaa = tryToParseAttestationVaa(ctx.vaaBytes);
      if (parsedAttestationMetaVaa !== undefined) {
        payload = {
          payloadType: parsedAttestationMetaVaa.payloadType,
          tokenAddress: parsedAttestationMetaVaa.tokenAddress,
          tokenChain: parsedAttestationMetaVaa.tokenChain,
          decimals: parsedAttestationMetaVaa.decimals,
          symbol: parsedAttestationMetaVaa.symbol,
          name: parsedAttestationMetaVaa.name,
        };
      }
    }
    ctx.attestation = {
      vaa: parsedAttestationMetaVaa,
      payload,
    };
    ctx.logger?.debug("AttestMeta have been attached to context");
    await next();
  };
}
