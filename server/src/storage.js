import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Penyimpanan foto:
 *  - Cloudflare R2 (S3-compatible) bila R2_BUCKET diisi → wajib di Vercel
 *  - Folder lokal (UPLOAD_DIR) untuk development
 * Bucket R2 tetap PRIVAT; admin melihat foto lewat signed URL berumur pendek.
 */
const R2 = () => !!process.env.R2_BUCKET;
const PREFIX = 'r2:';
let s3;

function client() {
  if (!s3) {
    s3 = new S3Client({
      region: 'auto',
      forcePathStyle: true,
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3;
}

/** @returns {Promise<string>} referensi yang disimpan di kolom photo_path */
export async function savePhoto(key, buf) {
  if (R2()) {
    await client().send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg',
    }));
    return PREFIX + key;
  }
  if (process.env.VERCEL) throw new Error('R2_BUCKET belum diatur — Vercel tidak punya disk permanen');
  const file = path.resolve(process.env.UPLOAD_DIR || './uploads', key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  return file;
}

export async function deletePhoto(ref) {
  if (!ref) return;
  if (ref.startsWith(PREFIX)) {
    await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: ref.slice(PREFIX.length) })).catch(() => {});
  } else {
    await fs.unlink(ref).catch(() => {});
  }
}

/** Signed URL R2 (dihitung lokal, tanpa request jaringan). null bila foto disimpan lokal. */
export async function photoUrl(ref, expiresIn = 3600) {
  if (!ref?.startsWith(PREFIX)) return null;
  return getSignedUrl(client(), new GetObjectCommand({
    Bucket: process.env.R2_BUCKET, Key: ref.slice(PREFIX.length),
  }), { expiresIn });
}
