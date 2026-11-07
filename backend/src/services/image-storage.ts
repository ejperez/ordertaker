import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const productsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../public/uploads/products',
);
const paymentProofsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../private/uploads/payment-proofs',
);
const maxImageBytes = 5 * 1024 * 1024;
const storedFilenamePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;
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
  savePaymentProof(data: string): Promise<string>;
  removePaymentProof(proofPath: string | null): Promise<void>;
}

function decodeImage(data: string): { bytes: Buffer; extension: string } {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new ImageValidationError('Image data must be valid base64');
  }

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0 || bytes.length > maxImageBytes) {
    throw new ImageValidationError('Image must be between 1 byte and 5 MB');
  }

  const format = signatures.find((candidate) => candidate.matches(bytes));
  if (!format) throw new ImageValidationError('Only JPEG, PNG, and WebP images are supported');
  return { bytes, extension: format.extension };
}

export class LocalImageStorageService implements ImageStorageService {
  async saveProductImage(data: string): Promise<string> {
    const image = decodeImage(data);
    await mkdir(productsDirectory, { recursive: true });
    const filename = `${randomUUID()}${image.extension}`;
    await writeFile(resolve(productsDirectory, filename), image.bytes, { flag: 'wx' });
    return `/uploads/products/${filename}`;
  }

  async removeProductImage(imagePath: string | null): Promise<void> {
    if (!imagePath) return;
    const filename = imagePath.split('/').at(-1);
    if (!filename || !storedFilenamePattern.test(filename)) {
      throw new ImageValidationError('Invalid stored image path');
    }
    await unlink(resolve(productsDirectory, filename));
  }

  async savePaymentProof(data: string): Promise<string> {
    const image = decodeImage(data);
    await mkdir(paymentProofsDirectory, { recursive: true });
    const filename = `${randomUUID()}${image.extension}`;
    await writeFile(resolve(paymentProofsDirectory, filename), image.bytes, { flag: 'wx' });
    return `payment-proofs/${filename}`;
  }

  async removePaymentProof(proofPath: string | null): Promise<void> {
    if (!proofPath) return;
    const [directory, filename] = proofPath.split('/');
    if (directory !== 'payment-proofs' || !filename || !storedFilenamePattern.test(filename)) {
      throw new ImageValidationError('Invalid stored payment proof path');
    }
    await unlink(resolve(paymentProofsDirectory, filename));
  }
}

export const imageStorage: ImageStorageService = new LocalImageStorageService();
