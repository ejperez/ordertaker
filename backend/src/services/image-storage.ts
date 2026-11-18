import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env.js';

const maxImageBytes = 5 * 1024 * 1024;
const storedFilenamePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;
const publicDirectory = join(env.UPLOADS_DIR, 'public');
const privateDirectory = join(env.UPLOADS_DIR, 'private', 'payment-proofs');
const signatures = [
  {
    mimeType: 'image/jpeg',
    extension: '.jpg',
    matches: (data: Buffer) => data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  },
  {
    mimeType: 'image/png',
    extension: '.png',
    matches: (data: Buffer) =>
      data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/webp',
    extension: '.webp',
    matches: (data: Buffer) =>
      data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP',
  },
];

export class ImageValidationError extends Error {}

export interface ImageStorageService {
  saveProductImage(data: string): Promise<string>;
  removeProductImage(imagePath: string | null): Promise<void>;
  saveQrPaymentImage(data: string): Promise<string>;
  removeQrPaymentImage(imagePath: string | null): Promise<void>;
  savePaymentProof(data: string): Promise<string>;
  readPaymentProof(
    proofPath: string | null,
  ): Promise<{ bytes: Buffer; contentType: string } | null>;
  removePaymentProof(proofPath: string | null): Promise<void>;
}

function decodeImage(data: string): { bytes: Buffer; extension: string; contentType: string } {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new ImageValidationError('Image data must be valid base64');
  }

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0 || bytes.length > maxImageBytes) {
    throw new ImageValidationError('Image must be between 1 byte and 5 MB');
  }

  const format = signatures.find((candidate) => candidate.matches(bytes));
  if (!format) throw new ImageValidationError('Only JPEG, PNG, and WebP images are supported');
  return { bytes, extension: format.extension, contentType: format.mimeType };
}

function publicImageUrl(folder: 'products' | 'store', filename: string): string {
  return new URL(`/api/uploads/${folder}/${filename}`, env.API_PUBLIC_ORIGIN).toString();
}

function publicImageFilename(imagePath: string, folder: 'products' | 'store'): string {
  let url: URL;
  try {
    url = new URL(imagePath);
  } catch {
    throw new ImageValidationError('Invalid stored image path');
  }

  if (
    url.origin !== new URL(env.API_PUBLIC_ORIGIN).origin ||
    url.pathname.slice(0, `/api/uploads/${folder}/`.length) !== `/api/uploads/${folder}/` ||
    url.search ||
    url.hash
  ) {
    throw new ImageValidationError('Invalid stored image path');
  }

  const filename = url.pathname.slice(`/api/uploads/${folder}/`.length);
  if (!storedFilenamePattern.test(filename)) {
    throw new ImageValidationError('Invalid stored image path');
  }
  return filename;
}

function paymentProofFilename(proofPath: string): string {
  const [directory, filename, ...extraParts] = proofPath.split('/');
  if (
    directory !== 'payment-proofs' ||
    extraParts.length > 0 ||
    !filename ||
    !storedFilenamePattern.test(filename)
  ) {
    throw new ImageValidationError('Invalid stored payment proof path');
  }
  return filename;
}

function imageContentType(filename: string): string {
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return extension === '.jpg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : 'image/webp';
}

async function saveImage(
  directory: string,
  filename: string,
  bytes: Buffer,
  privateFile = false,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: privateFile ? 0o700 : 0o755 });
  await writeFile(join(directory, filename), bytes, {
    flag: 'wx',
    mode: privateFile ? 0o600 : 0o644,
  });
}

async function removeImage(directory: string, filename: string): Promise<void> {
  try {
    await unlink(join(directory, filename));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

export class LocalImageStorageService implements ImageStorageService {
  async saveProductImage(data: string): Promise<string> {
    const image = decodeImage(data);
    const filename = `${randomUUID()}${image.extension}`;
    await saveImage(join(publicDirectory, 'products'), filename, image.bytes);
    return publicImageUrl('products', filename);
  }

  async removeProductImage(imagePath: string | null): Promise<void> {
    if (!imagePath) return;
    await removeImage(
      join(publicDirectory, 'products'),
      publicImageFilename(imagePath, 'products'),
    );
  }

  async saveQrPaymentImage(data: string): Promise<string> {
    const image = decodeImage(data);
    const filename = `${randomUUID()}${image.extension}`;
    await saveImage(join(publicDirectory, 'store'), filename, image.bytes);
    return publicImageUrl('store', filename);
  }

  async removeQrPaymentImage(imagePath: string | null): Promise<void> {
    if (!imagePath) return;
    await removeImage(join(publicDirectory, 'store'), publicImageFilename(imagePath, 'store'));
  }

  async savePaymentProof(data: string): Promise<string> {
    const image = decodeImage(data);
    const filename = `${randomUUID()}${image.extension}`;
    await saveImage(privateDirectory, filename, image.bytes, true);
    return `payment-proofs/${filename}`;
  }

  async readPaymentProof(
    proofPath: string | null,
  ): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (!proofPath) return null;
    const filename = paymentProofFilename(proofPath);
    try {
      return {
        bytes: await readFile(join(privateDirectory, filename)),
        contentType: imageContentType(filename),
      };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
  }

  async removePaymentProof(proofPath: string | null): Promise<void> {
    if (!proofPath) return;
    await removeImage(privateDirectory, paymentProofFilename(proofPath));
  }
}

export const imageStorage: ImageStorageService = new LocalImageStorageService();
