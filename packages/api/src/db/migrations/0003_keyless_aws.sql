-- 0003: keyless AWS access. cf-dam signs short-lived OIDC tokens; AWS swaps them for temporary keys.

-- Token signing keys. The private half is sealed (AES-GCM, storage/secret-box.ts); the public half is
-- published at /.well-known/jwks.json. Retired keys stop being published.
CREATE TABLE IF NOT EXISTS signing_keys (
  kid             TEXT PRIMARY KEY,
  alg             TEXT NOT NULL,
  public_jwk      TEXT NOT NULL,
  private_sealed  TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  retired_at      TEXT
);

-- The issuer URL a keyless connection's tokens carry. It must stay the URL the AWS account trusts,
-- so it is fixed when the connection is created rather than taken from each request.
CREATE TABLE IF NOT EXISTS connection_oidc (
  connection_id  TEXT PRIMARY KEY REFERENCES storage_connections(id) ON DELETE CASCADE,
  issuer         TEXT NOT NULL,
  account_id     TEXT NOT NULL
);
