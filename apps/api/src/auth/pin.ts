import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const KEY_LENGTH = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** Cost params are encoded in the stored string so they can be raised without breaking old hashes. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pin, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, nStr, rStr, pStr, saltB64, keyB64] = stored.split(":");
  if (scheme !== "scrypt" || !nStr || !rStr || !pStr || !saltB64 || !keyB64) return false;
  const [N, r, p] = [Number(nStr), Number(rStr), Number(pStr)];
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scryptAsync(pin, Buffer.from(saltB64, "base64url"), KEY_LENGTH, { N, r, p });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
