import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (!/[A-Z]/.test(password)) return 'A senha precisa ter pelo menos 1 letra maiúscula.';
  if (!/[0-9]/.test(password)) return 'A senha precisa ter pelo menos 1 número.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'A senha precisa ter pelo menos 1 caractere especial.';
  return null;
}
