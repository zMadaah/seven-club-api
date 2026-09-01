import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Nenhuma validação de senha existia aqui antes — o backend confiava
// cegamente no frontend (MIN_PASSWORD_LENGTH nas telas). Qualquer
// requisição direta à API (sem passar pelo app) podia criar conta com
// senha de 1 caractere. Agora a regra vive aqui, e as duas rotas que
// definem senha (signup e reset) chamam isso antes de fazer o hash.
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (!/[A-Z]/.test(password)) return 'A senha precisa ter pelo menos 1 letra maiúscula.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'A senha precisa ter pelo menos 1 caractere especial.';
  return null;
}
