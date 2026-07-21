import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const KEY_LENGTH = 64
const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1
const MAX_MEMORY = 64 * 1024 * 1024

export function isPasswordHash(value: string) {
  return value.startsWith('scrypt$')
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEMORY,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString('base64url')}`
}

export function verifyPassword(password: string, encoded: string) {
  try {
    const [scheme, n, r, p, salt, expectedValue] = encoded.split('$')
    if (scheme !== 'scrypt' || !salt || !expectedValue) return false
    const expected = Buffer.from(expectedValue, 'base64url')
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEMORY,
    })
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export function passwordPolicyError(password: string) {
  if (password.length < 12) return 'Password must be at least 12 characters'
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, and a number'
  }
  return null
}
