import { ethers } from "ethers";

export function deNormalizeAmount(amount: string, decimals: number): string {
  if (decimals <= 8) {
    return amount;
  }
  return ethers.utils
    .parseUnits(ethers.utils.formatUnits(amount, 8), decimals)
    .toString();
}
