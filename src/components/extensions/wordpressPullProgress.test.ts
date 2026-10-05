import { expect, test } from "bun:test";
import { formatTransferBytes } from "./wordpressPullProgress";

test("transfer sizes are decimal with two places", () => {
  expect(formatTransferBytes(3557437696)).toBe("3.56 GB");
  expect(formatTransferBytes(344869407)).toBe("344.87 MB");
  expect(formatTransferBytes(0)).toBe("0 B");
});
