import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { HttpError, unauthorized } from '../http-error.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164_RE = /^\+[1-9][0-9]{7,14}$/;
const VERIFY_ALGS = ['HS256', 'ES256', 'RS256'] as const;

const remoteJwksByIssuer = new Map<string, JWTVerifyGetKey>();

export interface JwtClaims {
  authUserId: string;
  phone: string | null;
  email: string | null;
}

export interface JwtVerifyInput {
  issuer: string;
  /** Yalnız legacy HS256 (yerel test / eski JWT secret). Hosted ES256 için gerekmez. */
  secret?: string;
  /** Testlerde yerel JWKS; üretimde issuer üzerinden keşfedilir. */
  jwks?: JWTVerifyGetKey;
}

export function supabaseIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
}

function remoteJwks(issuer: string): JWTVerifyGetKey {
  const cached = remoteJwksByIssuer.get(issuer);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  remoteJwksByIssuer.set(issuer, jwks);
  return jwks;
}

function verifyKey(input: JwtVerifyInput): JWTVerifyGetKey {
  return async (header, token) => {
    const alg = header.alg;
    if (alg === 'HS256') {
      if (!input.secret) {
        throw unauthorized('Geçersiz oturum');
      }
      return new TextEncoder().encode(input.secret);
    }
    if (alg === 'ES256' || alg === 'RS256') {
      const jwks = input.jwks ?? remoteJwks(input.issuer);
      return jwks(header, token);
    }
    throw unauthorized('Geçersiz oturum');
  };
}

export async function verifyAccessToken(token: string, input: JwtVerifyInput): Promise<JwtClaims> {
  try {
    const { payload } = await jwtVerify(token, verifyKey(input), {
      algorithms: [...VERIFY_ALGS],
      issuer: input.issuer,
      audience: 'authenticated',
      clockTolerance: 30,
    });
    if (payload['role'] !== 'authenticated') {
      throw unauthorized('Geçersiz oturum');
    }
    const authUserId = payload.sub;
    if (typeof authUserId !== 'string' || !UUID_RE.test(authUserId)) {
      throw unauthorized('Geçersiz oturum');
    }
    return {
      authUserId,
      phone: e164Phone(stringClaim(payload['phone'])),
      email: emailVerified(payload) ? emailClaim(payload['email']) : null,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw unauthorized('Geçersiz oturum');
  }
}

function emailVerified(payload: JWTPayload): boolean {
  // user_metadata GoTrue'da kullanıcı tarafından yazılabilir; yetki kararı olmaz.
  return payload['email_verified'] === true || payload['email_confirmed'] === true;
}

function e164Phone(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/[^\d+]/g, '');
  if (E164_RE.test(compact)) return compact;
  if (/^[1-9][0-9]{7,14}$/.test(compact)) return `+${compact}`;
  return null;
}

function emailClaim(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const email = value.trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}
