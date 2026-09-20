// Google Sign-In — verifies a GIS ID token with GOOGLE_CLIENT_ID.
// No client secret needed: the frontend obtains the ID token via
// Google Identity Services and the backend verifies the signature.

import { OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

let client: OAuth2Client | null = null;

export function isGoogleAuthConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID?.trim();
}

function getClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  if (!client) client = new OAuth2Client(clientId);
  return client;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: clientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Google token missing sub/email');
  }
  if (payload.email_verified !== true) {
    throw new Error('Google email is not verified');
  }
  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    name: payload.name,
  };
}
