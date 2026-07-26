export const serializeMinor = (value: bigint): number => {
  const asNumber = Number(value);
  if (Math.abs(asNumber) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Value ${value} exceeds MAX_SAFE_INTEGER`);
  }
  return asNumber;
};
