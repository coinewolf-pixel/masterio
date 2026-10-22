import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { MAX_UPLOAD_BYTES, type UploadPurpose } from '@masterio/shared';
import { ENV, type Env } from '../config/env';
import { AppException } from '../common/app-exception';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

const PREFIX: Record<UploadPurpose, string> = {
  document: 'private/doc',
  order_photo: 'private/order',
  avatar: 'private/avatar',
  dispute_evidence: 'private/dispute',
  incident: 'private/incident',
};

const UPLOAD_TTL_SECONDS = 600;
const VIEW_TTL_SECONDS = 300;

/**
 * Закрытое S3-совместимое хранилище (AWS S3, Cloudflare R2, MinIO). Бакет приватный: загрузка — по
 * подписанной POST-форме с ограничением размера и типа, просмотр — по ссылке на 5 минут.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.bucket = env.S3_BUCKET ?? '';
    this.client =
      env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? new S3Client({
            region: env.S3_REGION,
            ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
            credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
          })
        : null;
  }

  async onModuleInit(): Promise<void> {
    if (!this.client || !this.env.S3_CREATE_BUCKET) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`created bucket ${this.bucket}`);
    }
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /** Ключ файла всегда начинается с префикса назначения и id владельца — чужой ключ подставить нельзя. */
  ownerPrefix(purpose: UploadPurpose, ownerId: string): string {
    return `${PREFIX[purpose]}/${ownerId}/`;
  }

  isOwnedKey(key: string, purpose: UploadPurpose, ownerId: string): boolean {
    return key.startsWith(this.ownerPrefix(purpose, ownerId)) && !key.includes('..');
  }

  async presignUpload(purpose: UploadPurpose, ownerId: string, contentType: string, sizeBytes: number) {
    const client = this.requireClient();
    if (sizeBytes > MAX_UPLOAD_BYTES) throw new AppException('VALIDATION_FAILED', { sizeBytes: `max ${MAX_UPLOAD_BYTES}` });
    if (purpose !== 'document' && contentType === 'application/pdf') {
      throw new AppException('VALIDATION_FAILED', { contentType: 'images only' });
    }
    const key = `${this.ownerPrefix(purpose, ownerId)}${randomUUID()}.${EXT[contentType] ?? 'bin'}`;
    const post = await createPresignedPost(client, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, Math.min(MAX_UPLOAD_BYTES, sizeBytes + 1024)],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: UPLOAD_TTL_SECONDS,
    });
    return { key, url: post.url, fields: post.fields, expiresIn: UPLOAD_TTL_SECONDS };
  }

  async exists(key: string): Promise<boolean> {
    const client = this.requireClient();
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Файл, который создаёт сам сервер (выгрузка данных пользователя). */
  async putObject(key: string, body: string, contentType: string): Promise<void> {
    await this.requireClient().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async deleteObject(key: string): Promise<void> {
    await this.requireClient().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Ссылка на скачивание с именем файла (Content-Disposition). */
  async downloadUrl(key: string, filename: string): Promise<{ url: string; expiresIn: number }> {
    const client = this.requireClient();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"` }),
      { expiresIn: VIEW_TTL_SECONDS },
    );
    return { url, expiresIn: VIEW_TTL_SECONDS };
  }

  async viewUrl(key: string): Promise<{ url: string; expiresIn: number }> {
    const client = this.requireClient();
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: VIEW_TTL_SECONDS });
    return { url, expiresIn: VIEW_TTL_SECONDS };
  }

  private requireClient(): S3Client {
    if (!this.client) throw new AppException('FEATURE_DISABLED', { reason: 'storage_not_configured' });
    return this.client;
  }
}
