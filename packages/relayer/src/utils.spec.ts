import { deNormalizeAmount } from "./utils";

describe("deNormalizeAmount", () => {
  it("should return the same amount if decimals are less than or equal to 8", () => {
    expect(deNormalizeAmount("100000000", 8)).toBe("100000000");
    expect(deNormalizeAmount("100000000", 7)).toBe("100000000");
  });

  it("should de-normalize the amount correctly if decimals are greater than 8", () => {
    expect(deNormalizeAmount("100000000", 9)).toBe("1000000000");
    expect(deNormalizeAmount("100000000", 10)).toBe("10000000000");
  });

  it("should handle large numbers correctly", () => {
    expect(deNormalizeAmount("1000000000000000000", 18)).toBe(
      "10000000000000000000000000000"
    );
  });

  it("should handle edge cases", () => {
    expect(deNormalizeAmount("0", 9)).toBe("0");
    expect(deNormalizeAmount("1", 9)).toBe("10");
  });
});
