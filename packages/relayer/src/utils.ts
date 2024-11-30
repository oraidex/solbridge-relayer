import { PublicKey } from "@solana/web3.js";

export function parseTokenAddress(denom: string) {
  const lastDenom = denom.split("/").pop();
  return lastDenom.split("oraib")[1];
}

export function parseDestAddrFromMemo(denom: string) {
  const lastDenom = denom.split("/").pop();
  return lastDenom.split("oraib")[1];
}

export function retryWrapperFn<T>(
  fn: () => Promise<T>,
  retries: number,
  delay: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const retry = (n: number) => {
      fn()
        .then(resolve)
        .catch((err) => {
          if (n > 1) {
            setTimeout(() => retry(n - 1), delay);
          } else {
            reject(err);
          }
        });
    };
    retry(retries);
  });
}

export function validateSolanaAddress(address: string): boolean {
  try {
    const pubKey = new PublicKey(address);
    return PublicKey.isOnCurve(pubKey.toBuffer());
  } catch {
    return false;
  }
}
