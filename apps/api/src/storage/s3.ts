import {
  S3Client,
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type BucketLocationConstraint,
  type GetObjectCommandInput,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "./types.js";

export interface S3StorageConfig {
  endpoint: string;
  /**
   * Where the browser reaches the same store, when that differs from
   * `endpoint` (a compose-internal host such as http://storage:9000). Presigned
   * URLs are opened by the browser and the host is part of the signature, so
   * they are signed against this endpoint.
   */
  publicEndpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

function s3Client(cfg: S3StorageConfig, endpoint: string): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: cfg.forcePathStyle ?? false,
  });
}

/**
 * Creates the bucket when it does not exist yet. The appliance's own storage
 * starts empty on a cold start; an existing bucket is left untouched.
 */
export async function ensureBucket(cfg: S3StorageConfig): Promise<"exists" | "created"> {
  const client = s3Client(cfg, cfg.endpoint);
  try {
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    return "exists";
  } catch (error) {
    if (!(error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchBucket"))) {
      throw error;
    }
  }
  await client.send(
    new CreateBucketCommand({
      Bucket: cfg.bucket,
      // us-east-1 is the one region S3 rejects as an explicit constraint.
      ...(cfg.region === "us-east-1"
        ? {}
        : {
            CreateBucketConfiguration: {
              LocationConstraint: cfg.region as BucketLocationConstraint,
            },
          }),
    }),
  );
  return "created";
}

export function createS3Storage(cfg: S3StorageConfig): ObjectStorage {
  const client = s3Client(cfg, cfg.endpoint);
  const presignClient =
    cfg.publicEndpoint && cfg.publicEndpoint !== cfg.endpoint
      ? s3Client(cfg, cfg.publicEndpoint)
      : client;

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
      return getSignedUrl(presignClient, command, {
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
      return getSignedUrl(presignClient, command, {
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
