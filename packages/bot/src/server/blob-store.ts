import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BLOB_API = 'https://blob.vercel-storage.com';
const API_VERSION = '7';
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 2 * 1024 * 1024;
const LOCAL_PREFIX = 'local://';
const SAFE_AVATAR_NAME = /^[0-9a-f-]{36}-\d+\.(jpg|png|webp)$/i;

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function avatarDir(): string {
  const configured = process.env.AVATAR_DIR?.trim();
  return configured || path.join(process.cwd(), 'data', 'avatars');
}

function localFilePath(url: string): string | null {
  if (!url.startsWith(LOCAL_PREFIX)) return null;
  const name = url.slice(LOCAL_PREFIX.length);
  if (!SAFE_AVATAR_NAME.test(name)) return null;
  const dir = path.resolve(avatarDir());
  const full = path.resolve(dir, name);
  if (full !== path.join(dir, name)) return null;
  return full;
}

function contentTypeFor(file: string): string {
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/** Content-Type safe to embed in a cross-origin <img>. Browsers drop the
 *  image when nosniff meets application/octet-stream. */
export function imageContentType(declared: string, body: Buffer): string {
  const clean = declared.split(';')[0]?.trim().toLowerCase() ?? '';
  if (clean === 'image/jpg' || clean === 'image/jpeg') return 'image/jpeg';
  if (clean === 'image/png' || clean === 'image/webp') return clean;
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.length >= 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) return 'image/png';
  if (
    body.length >= 12
    && body.toString('ascii', 0, 4) === 'RIFF'
    && body.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp';
  return 'application/octet-stream';
}

async function uploadAvatarLocal(
  userId: string,
  mime: string,
  bytes: Buffer,
): Promise<{ url: string; pathname: string }> {
  const filename = `${userId}-${Date.now()}.${extFor(mime)}`;
  if (!SAFE_AVATAR_NAME.test(filename)) {
    const err = new Error('No se pudo guardar el avatar') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const dir = avatarDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
  return { url: `${LOCAL_PREFIX}${filename}`, pathname: filename };
}

function token(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!value) {
    const err = new Error('El almacenamiento de avatares no está configurado') as Error & { status?: number };
    err.status = 503;
    throw err;
  }
  return value;
}

function preferredBlobAccess(): 'public' | 'private' {
  const base = process.env.BLOB_BASE_URL?.trim() ?? '';
  return base.includes('.private.') ? 'private' : 'public';
}

function accessHeaders(access: 'public' | 'private'): Record<string, string> {
  if (access === 'private') return { 'x-vercel-blob-access': 'private' };
  return { 'x-access': 'public', 'x-vercel-blob-access': 'public' };
}

export function assertImageUpload(mime: string, bytes: Buffer): void {
  if (!ALLOWED_TYPES.has(mime)) {
    const err = new Error('Solo se aceptan JPEG, PNG o WebP') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    const err = new Error('La imagen debe pesar como máximo 2 MB') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
}

function extFor(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

interface BlobPutResponse {
  url: string;
  pathname: string;
  downloadUrl?: string;
}

export async function uploadAvatar(
  userId: string,
  mime: string,
  bytes: Buffer,
): Promise<{ url: string; pathname: string }> {
  assertImageUpload(mime, bytes);
  if (!isBlobConfigured()) return uploadAvatarLocal(userId, mime, bytes);
  const pathname = `avatars/${userId}-${Date.now()}.${extFor(mime)}`;
  const auth = token();
  const url = `${BLOB_API}/${pathname}?addRandomSuffix=true`;
  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${auth}`,
    'x-api-version': API_VERSION,
    'x-content-type': mime,
    'Content-Type': mime,
  };
  const body = new Uint8Array(bytes);
  const access = preferredBlobAccess();

  let response = await fetch(url, {
    method: 'PUT',
    headers: { ...baseHeaders, ...accessHeaders(access) },
    body,
  });
  if (!response.ok && access === 'public') {
    response = await fetch(url, { method: 'PUT', headers: baseHeaders, body });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (access !== 'private' && /private store/i.test(detail)) {
      response = await fetch(url, {
        method: 'PUT',
        headers: { ...baseHeaders, ...accessHeaders('private') },
        body,
      });
      if (!response.ok) {
        const retryDetail = await response.text().catch(() => '');
        const err = new Error(retryDetail || `No se pudo subir el avatar (${response.status})`) as Error & { status?: number };
        err.status = 502;
        throw err;
      }
    } else {
      const err = new Error(detail || `No se pudo subir el avatar (${response.status})`) as Error & { status?: number };
      err.status = 502;
      throw err;
    }
  }
  const payload = (await response.json()) as BlobPutResponse;
  return {
    url: payload.url,
    pathname: payload.pathname || pathname,
  };
}

export async function deleteBlob(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const local = localFilePath(url);
  if (local) {
    try {
      await unlink(local);
    } catch {
      // Previous file may already be gone.
    }
    return;
  }
  if (!isBlobConfigured()) return;
  try {
    await fetch(`${BLOB_API}/delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'x-api-version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ urls: [url] }),
    });
  } catch {
    // Previous object may already be gone.
  }
}

export async function fetchBlobBytes(
  url: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const local = localFilePath(url);
  if (local) {
    try {
      return { body: await readFile(local), contentType: contentTypeFor(local) };
    } catch {
      return null;
    }
  }
  const headers: Record<string, string> = {};
  if (isBlobConfigured()) headers.Authorization = `Bearer ${token()}`;
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const body = Buffer.from(await response.arrayBuffer());
  return {
    body,
    contentType: response.headers.get('content-type') || 'image/jpeg',
  };
}
