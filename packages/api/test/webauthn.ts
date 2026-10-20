/**
 * A software passkey for tests: makes WebAuthn registration and sign-in responses the way a password
 * manager would (ES256, "none" attestation), so the server's real verification runs end to end.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'

const b64url = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString('base64url')
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest()

/** Just enough CBOR for an attestation object and a COSE key: maps, ints, text and byte strings. */
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>
function cbor(value: Cbor): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n])
    if (n < 256) return Buffer.from([(major << 5) | 24, n])
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255])
    const b = Buffer.alloc(5)
    b[0] = (major << 5) | 26
    b.writeUInt32BE(n, 1)
    return b
  }
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8')
    return Buffer.concat([head(3, text.length), text])
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)])
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])])
}

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_AT = 0x40

export class SoftPasskey {
  readonly credentialId = randomBytes(16)
  private readonly privateKey: KeyObject
  private readonly publicJwk: { x: string; y: string }
  private counter = 0
  userHandle: string | null = null

  constructor(
    private readonly rpId = 'localhost',
    private readonly origin = 'http://localhost',
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    this.privateKey = privateKey
    this.publicJwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }))
  }

  /** The response to `navigator.credentials.create()` for these registration options. */
  register(options: { challenge: string; user: { id: string } }) {
    this.userHandle = options.user.id
    const cose = cbor(
      new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(this.publicJwk.x, 'base64url')],
        [-3, Buffer.from(this.publicJwk.y, 'base64url')],
      ]),
    )
    const length = Buffer.alloc(2)
    length.writeUInt16BE(this.credentialId.length)
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([FLAG_UP | FLAG_UV | FLAG_AT]),
      Buffer.alloc(4), // counter 0
      Buffer.alloc(16), // aaguid
      length,
      this.credentialId,
      cose,
    ])
    const attestationObject = cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  /** The response to `navigator.credentials.get()`; `verified: false` leaves out user verification. */
  authenticate(options: { challenge: string }, verified = true) {
    this.counter++
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(this.counter)
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([FLAG_UP | (verified ? FLAG_UV : 0)]), counter])
    const clientDataJSON = this.clientData('webauthn.get', options.challenge)
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey)
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: this.userHandle ?? undefined,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }
}
