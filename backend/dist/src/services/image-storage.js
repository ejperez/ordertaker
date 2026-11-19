import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
const maxImageBytes = 5 * 1024 * 1024;
const storedFilenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;
const signatures = [
    {
        mimeType: 'image/jpeg',
        extension: '.jpg',
        matches: (data) => data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
    },
    {
        mimeType: 'image/png',
        extension: '.png',
        matches: (data) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    },
    {
        mimeType: 'image/webp',
        extension: '.webp',
        matches: (data) => data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP',
    },
];
export class ImageValidationError extends Error {
}
const storageEndpoint = `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object`;
function decodeImage(data) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
        throw new ImageValidationError('Image data must be valid base64');
    }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > maxImageBytes) {
        throw new ImageValidationError('Image must be between 1 byte and 5 MB');
    }
    const format = signatures.find((candidate) => candidate.matches(bytes));
    if (!format)
        throw new ImageValidationError('Only JPEG, PNG, and WebP images are supported');
    return { bytes, extension: format.extension, contentType: format.mimeType };
}
function objectUrl(bucket, objectPath) {
    const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
    return `${storageEndpoint}/${encodeURIComponent(bucket)}/${encodedPath}`;
}
function publicImageUrl(bucket, objectPath) {
    return `${storageEndpoint}/public/${encodeURIComponent(bucket)}/${objectPath
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
}
async function storageRequest(method, bucket, objectPath, body, contentType) {
    const url = method === 'DELETE'
        ? `${storageEndpoint}/${encodeURIComponent(bucket)}`
        : objectUrl(bucket, objectPath);
    const requestBody = typeof body === 'string' ? body : body === undefined ? undefined : Uint8Array.from(body);
    const response = await fetch(url, {
        method,
        headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            ...(contentType ? { 'Content-Type': contentType } : {}),
            ...(method === 'POST' ? { 'x-upsert': 'false' } : {}),
        },
        ...(requestBody === undefined ? {} : { body: requestBody }),
    });
    if (!response.ok) {
        throw new Error(`Supabase Storage ${method} failed (${response.status})`);
    }
    return response;
}
function publicImageObjectPath(imageUrl, folder) {
    let url;
    try {
        url = new URL(imageUrl);
    }
    catch {
        throw new ImageValidationError('Invalid stored image path');
    }
    const baseUrl = new URL(env.SUPABASE_URL);
    const prefix = `/storage/v1/object/public/${env.SUPABASE_PRODUCT_BUCKET}/${folder}/`;
    const filename = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
    if (url.origin !== baseUrl.origin ||
        url.search ||
        url.hash ||
        !storedFilenamePattern.test(filename)) {
        throw new ImageValidationError('Invalid stored image path');
    }
    return `${folder}/${filename}`;
}
function paymentProofObjectPath(proofPath) {
    const [directory, filename, ...extraParts] = proofPath.split('/');
    if (directory !== 'payment-proofs' ||
        extraParts.length > 0 ||
        !filename ||
        !storedFilenamePattern.test(filename)) {
        throw new ImageValidationError('Invalid stored payment proof path');
    }
    return proofPath;
}
function imageContentType(filename) {
    const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    return extension === '.jpg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : 'image/webp';
}
export class SupabaseImageStorageService {
    async saveProductImage(data) {
        const image = decodeImage(data);
        const filename = `${randomUUID()}${image.extension}`;
        const objectPath = `products/${filename}`;
        await storageRequest('POST', env.SUPABASE_PRODUCT_BUCKET, objectPath, image.bytes, image.contentType);
        return publicImageUrl(env.SUPABASE_PRODUCT_BUCKET, objectPath);
    }
    async removeProductImage(imagePath) {
        if (!imagePath)
            return;
        const objectPath = publicImageObjectPath(imagePath, 'products');
        await storageRequest('DELETE', env.SUPABASE_PRODUCT_BUCKET, objectPath, JSON.stringify({ prefixes: [objectPath] }), 'application/json');
    }
    async saveQrPaymentImage(data) {
        const image = decodeImage(data);
        const filename = `${randomUUID()}${image.extension}`;
        const objectPath = `store/${filename}`;
        await storageRequest('POST', env.SUPABASE_PRODUCT_BUCKET, objectPath, image.bytes, image.contentType);
        return publicImageUrl(env.SUPABASE_PRODUCT_BUCKET, objectPath);
    }
    async removeQrPaymentImage(imagePath) {
        if (!imagePath)
            return;
        const objectPath = publicImageObjectPath(imagePath, 'store');
        await storageRequest('DELETE', env.SUPABASE_PRODUCT_BUCKET, objectPath, JSON.stringify({ prefixes: [objectPath] }), 'application/json');
    }
    async savePaymentProof(data) {
        const image = decodeImage(data);
        const filename = `${randomUUID()}${image.extension}`;
        const objectPath = `payment-proofs/${filename}`;
        await storageRequest('POST', env.SUPABASE_PAYMENT_PROOFS_BUCKET, objectPath, image.bytes, image.contentType);
        return `payment-proofs/${filename}`;
    }
    async readPaymentProof(proofPath) {
        if (!proofPath)
            return null;
        const objectPath = paymentProofObjectPath(proofPath);
        const response = await storageRequest('GET', env.SUPABASE_PAYMENT_PROOFS_BUCKET, objectPath);
        return {
            bytes: Buffer.from(await response.arrayBuffer()),
            contentType: imageContentType(objectPath),
        };
    }
    async removePaymentProof(proofPath) {
        if (!proofPath)
            return;
        const objectPath = paymentProofObjectPath(proofPath);
        await storageRequest('DELETE', env.SUPABASE_PAYMENT_PROOFS_BUCKET, objectPath, JSON.stringify({ prefixes: [objectPath] }), 'application/json');
    }
}
export const imageStorage = new SupabaseImageStorageService();
