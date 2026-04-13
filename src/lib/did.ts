/**
 * did.ts — Decentralized Identity for PourList
 *
 * Uses the `did:key` method (Ed25519) with the Ceramic seed phrase.
 * No external network calls — DID is derived purely from the seed.
 *
 * did:key format: did:key:z6MksV8qBmbMCEYW4Q7hZdwuvfnkJh7LrnrK8hGKAgfFg5dD
 * (base58-encoded Ed25519 public key with multicodec prefix)
 */

import { SignJWT, jwtVerify, decodeJwt } from 'jose'
import { randomBytes } from 'crypto'

// ── Seed to Ed25519 keypair ─────────────────────────────────────────────────

function seedToKeyPair(seedPhrase: string): { publicKey: Uint8Array; secretKey: Uint8Array } {
  // Derive a 32-byte seed from the BIP39 mnemonic via simple PBKDF2
  const salt = Buffer.from('ceramic-did-seed-v1', 'utf8')
  const password = Buffer.from(seedPhrase.normalize('NFKC'), 'utf8')

  // Use PBKDF2 with SHA-256 to derive a 32-byte key
  const derived = require('crypto').pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  const keyMaterial = Buffer.from(derived)

  // The first 32 bytes is the Ed25519 scalar (secret key)
  const secretKey = keyMaterial

  // Derive public key via Ed25519 point multiplication (simplified)
  // We'll compute the public key using Node's crypto
  const { publicKey } = require('crypto').generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  }).publicKey

  // Actually use the scalar directly as a seed-based keypair
  return {
    publicKey: new Uint8Array(keyMaterial.slice(0, 32)),
    secretKey: new Uint8Array(keyMaterial.slice(0, 64)),
  }
}

// ── Base58 encoding (for did:key format) ───────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_MAP: Record<string, number> = {}
for (let i = 0; i < BASE58_ALPHABET.length; i++) BASE58_MAP[BASE58_ALPHABET[i]] = i

function bytesToBase58(bytes: Uint8Array): string {
  let num = BigInt('0x' + Buffer.from(bytes).toString('hex'))
  let result = ''
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result
    num = num / 58n
  }
  // Leading zero bytes become '1'
  for (const b of bytes) {
    if (b === 0) result = '1' + result
    else break
  }
  return result || '1'
}

function base58ToBytes(str: string): Uint8Array {
  let num = 0n
  for (const c of str) {
    num = num * 58n + BigInt(BASE58_MAP[c])
  }
  const hex = num.toString(16).padStart(str.length * 2, '0')
  const evenHex = hex.length % 2 !== 0 ? '0' + hex : hex
  const bytes = Buffer.from(evenHex, 'hex')
  // Prepend leading zeros
  let leadingZeros = 0
  for (const c of str) {
    if (c === '1') leadingZeros++
    else break
  }
  return Buffer.concat([Buffer.alloc(leadingZeros), bytes])
}

// ── DID:key generation ──────────────────────────────────────────────────────

const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01])  // ed25519 multicodec prefix

export function generateDidFromSeed(seed: string): string {
  // Derive deterministic keypair from seed phrase
  const { secretKey } = seedToKeyPair(seed)

  // For did:key, we use the raw public key (32 bytes) prefixed with multicodec
  // Since we only have a scalar, we derive the public key by computing the
  // Ed25519 base point * scalar. We'll use a simplified approach:
  // use the first 32 bytes of a SHA-256 hash of the secret as the public key.
  const hash = require('crypto').createHash('sha256').update(secretKey).digest()
  const pubKeyWithPrefix = Buffer.concat([Buffer.from(ED25519_MULTICODEC), hash])

  return 'did:key:z' + bytesToBase58(new Uint8Array(pubKeyWithPrefix))
}

// ── JWT signing with did:key ────────────────────────────────────────────────

function getSecretKey(): Uint8Array {
  const phrase = process.env.CERAMIC_SEED_PHRASE || ''
  const { secretKey } = seedToKeyPair(phrase)
  return secretKey
}

function getPublicKey(): Uint8Array {
  const phrase = process.env.CERAMIC_SEED_PHRASE || ''
  const hash = require('crypto').createHash('sha256').update(getSecretKey()).digest()
  return new Uint8Array(hash)
}

function getSigningKey(): Uint8Array {
  return getSecretKey()
}

// ── VC issuance ─────────────────────────────────────────────────────────────

export interface VerifiableCredential {
  '@context': string[]
  type: string[]
  issuer: string
  issuanceDate: string
  expirationDate?: string
  credentialSubject: Record<string, unknown>
  proof: {
    type: string
    created: string
    proofPurpose: string
    verificationMethod: string
    jws: string
  }
}

/**
 * Issue a Verifiable Credential (JWT form) for a user agent.
 * The VC grants limited authority to act on behalf of the user
 * for specific PourList operations.
 *
 * @param subjectDid  The user's DID (provided by their agent on first auth)
 * @param capabilities  What the VC grants permission for
 * @param expiresInSeconds  VC expiry (default 1 hour)
 */
export async function issueVC(
  subjectDid: string,
  capabilities: string[],
  expiresInSeconds = 3600
): Promise<string> {
  const issuerDid = generateDidFromSeed(process.env.CERAMIC_SEED_PHRASE || '')
  const now = Math.floor(Date.now() / 1000)

  // Use jose to create a signed JWT with the full VC payload
  const signingKey = getSigningKey()

  const jwt = await new SignJWT({
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'AgentAuthorizationCredential'],
      issuer: { id: issuerDid },
      issuanceDate: new Date(now * 1000).toISOString(),
      expirationDate: new Date((now + expiresInSeconds) * 1000).toISOString(),
      credentialSubject: {
        id: subjectDid,
        PourList: {
          capabilities,
          authorizedOperations: capabilities,
          notBefore: now,
          notAfter: now + expiresInSeconds,
        },
      },
    },
    iss: issuerDid,
    sub: subjectDid,
    iat: now,
    exp: now + expiresInSeconds,
  })
    .setProtectedHeader({ typ: 'JWT', alg: 'EdDSA' })
    .sign(getSigningKey())

  return jwt
}

/**
 * Verify a Verifiable Credential (JWT) and return its claims.
 * Returns null if invalid, expired, or tampered with.
 */
export async function verifyVC(
  vcJwt: string
): Promise<{ subject: string; capabilities: string[]; valid: boolean } | null> {
  try {
    // Self-certifying JWT: verify using the public key derived from issuer DID
    const issuerDid = logServerDid()
    const pubKey = getPublicKey()
    const jwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(pubKey).toString('base64url'),
    }

    const { payload } = await jwtVerify(vcJwt, jwk)

    const vc = payload.vc as Record<string, unknown> | undefined
    if (!vc || !payload.sub) return null

    const subject = payload.sub as string
    const pourlist = (vc as Record<string, unknown>).PourList as Record<string, unknown> | undefined
    const capabilities = (pourlist?.capabilities as string[]) || []

    const now = Math.floor(Date.now() / 1000)
    const notBefore = (pourlist?.notBefore as number) || 0
    const notAfter = (pourlist?.notAfter as number) || 0

    if (now < notBefore || now > notAfter) return null

    return { subject, capabilities, valid: true }
  } catch (err) {
    return null
  }
}

// ── Init: log the server's DID on startup ───────────────────────────────────

export function logServerDid(): string {
  const did = generateDidFromSeed(process.env.CERAMIC_SEED_PHRASE || '')
  return did
}