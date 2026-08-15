import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string; // user id
}

export function signAccessToken(userId: string): string {
  const options: jwt.SignOptions = { expiresIn: env.accessTokenTtl as jwt.SignOptions['expiresIn'] };
  return jwt.sign({ sub: userId }, env.jwtAccessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

// Token de staff (dashboard): mesmo segredo, mas com um claim `role` que
// os tokens de usuário comum nunca têm — authenticateStaff exige esse
// claim, então um token de app_users nunca passa como staff, mesmo
// usando a mesma chave. TTL mais longo (7 dias) e sem rotação de refresh
// token: é uma ferramenta interna de um time pequeno, não pede a mesma
// postura de um app público.
export interface StaffAccessTokenPayload {
  sub: string; // staff id
  role: 'staff';
}

const STAFF_TOKEN_TTL = '7d';

export function signStaffAccessToken(staffId: string): string {
  return jwt.sign({ sub: staffId, role: 'staff' }, env.jwtAccessSecret, { expiresIn: STAFF_TOKEN_TTL });
}

export function verifyStaffAccessToken(token: string): StaffAccessTokenPayload {
  const payload = jwt.verify(token, env.jwtAccessSecret) as any;
  if (payload.role !== 'staff') {
    throw new Error('Token não é de staff.');
  }
  return payload;
}

// Refresh token é opaco (não é um JWT) — só guardamos o hash dele no
// banco, então nunca fica um segredo válido gravado em texto puro.
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
