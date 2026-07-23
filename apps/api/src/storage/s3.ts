import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  type GetObjectCommandInput,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "./types.js";

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export function createS3Storage(cfg: S3StorageConfig): ObjectStorage {
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: cfg.forcePathStyle ?? false,
  });

  return {
    async presignPut(
      key: string,
      opts?: { contentType?: string; expiresSeconds?: number },
    ): Promise<string> {
      const command = new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        ContentType: opts?.contentType,
      } as PutObjectCommandInput);
      return getSignedUrl(client, command, {
        expiresIn: opts?.expiresSeconds ?? 900,
      });
    },

    async presignGet(
      key: string,
      opts?: { expiresSeconds?: number },
    ): Promise<string> {
      const command = new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
      } as GetObjectCommandInput);
      return getSignedUrl(client, command, {
        expiresIn: opts?.expiresSeconds ?? 300,
      });
    },

    async getObject(key: string): Promise<{
      body: Uint8Array;
      contentType?: string;
    } | null> {
      try {
        const command = new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
        } as GetObjectCommandInput);
        const response = await client.send(command);
        
        // Transform the stream body to Uint8Array
        const chunks: Uint8Array[] = [];
        if (response.Body) {
          const reader = response.Body as AsyncIterable<Uint8Array>;
          for await (const chunk of reader) {
            chunks.push(chunk);
          }
        }
        
        const body = new Uint8Array(
          chunks.reduce((acc, chunk) => acc + chunk.length, 0),
        );
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.length;
        }

        const result: { body: Uint8Array; contentType?: string } = { body };
        if (response.ContentType !== undefined) {
          result.contentType = response.ContentType;
        }
        return result;
      } catch (error) {
        if (error instanceof Error && error.name === "NoSuchKey") {
          return null;
        }
        throw error;
      }
    },

    async putObject(
      key: string,
      body: Uint8Array,
      contentType: string,
    ): Promise<void> {
      const command = new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      } as PutObjectCommandInput);
      await client.send(command);
    },
  };
}
