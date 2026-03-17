import { expect, test } from "vitest";

function calculateRequiredCredits(durationInSeconds: number | null): number {
  if (durationInSeconds === null) return 1; // Fallback
  
  if (durationInSeconds <= 300) {
    return 1;
  }
  
  // 1 credit for first 5 mins, + 1 credit per each additional minute (or part thereof)
  const additionalSeconds = durationInSeconds - 300;
  const additionalCredits = Math.ceil(additionalSeconds / 60);
  
  return 1 + additionalCredits;
}

test("calculateRequiredCredits", () => {
  expect(calculateRequiredCredits(0)).toBe(1);
  expect(calculateRequiredCredits(300)).toBe(1); // 5:00
  expect(calculateRequiredCredits(301)).toBe(2); // 5:01
  expect(calculateRequiredCredits(360)).toBe(2); // 6:00
  expect(calculateRequiredCredits(361)).toBe(3); // 6:01
  expect(calculateRequiredCredits(600)).toBe(6); // 10:00 -> 1 + Math.ceil(300/60) = 1 + 5 = 6
  expect(calculateRequiredCredits(null)).toBe(1);
});
