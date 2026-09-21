const BLOB_API = 'https://blob.vercel-storage.com';
const API_VERSION = '7';
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 2 * 1024 * 1024;

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
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
  const pathname = `avatars/${userId}-${Date.now()}.${extFor(mime)}`;
  const auth = token();
  const url = `${BLOB_API}/${pathname}?addRandomSuffix=true`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth}`,
    'x-api-version': API_VERSION,
    'x-content-type': mime,
    'Content-Type': mime,
  };

  let response = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'x-access': 'public' },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) {
    response = await fetch(url, {
      method: 'PUT',
      headers,
      body: new Uint8Array(bytes),
    });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(detail || `No se pudo subir el avatar (${response.status})`) as Error & { status?: number };
    err.status = 502;
    throw err;
  }
  const payload = (await response.json()) as BlobPutResponse;
  return {
    url: payload.url,
    pathname: payload.pathname || pathname,
  };
}

export async function deleteBlob(url: string | null | undefined): Promise<void> {
  if (!url || !isBlobConfigured()) return;
  try {
    await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token()}`,
        'x-api-version': API_VERSION,
      },
    });
  } catch {
    // Previous object may already be gone.
  }
}

export async function fetchBlobBytes(
  url: string,
): Promise<{ body: Buffer; contentType: string } | null> {
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
