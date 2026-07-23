/**
 * S3-API-only storage seam (§6a guard 2). Implementations may use ONLY standard
 * S3 operations + SigV4 presigning — nothing Supabase-specific — so the on-prem
 * swap (RustFS) is config, not code.
 */
export interface ObjectStorage {
  presignPut(key: string, opts: { contentType?: string; expiresSeconds?: number }): Promise<string>;
  presignGet(key: string, opts?: { expiresSeconds?: number }): Promise<string>;
  getObject(key: string): Promise<{ body: Uint8Array; contentType?: string } | null>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
}
