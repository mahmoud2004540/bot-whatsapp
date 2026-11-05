const encoder = new TextEncoder();

function hexToBytes(hex: string) {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Checks a "sha256=<hex>" HMAC header. subtle.verify compares in constant time. */
export async function verifyHmacSha256(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const signature = hexToBytes(header.slice("sha256=".length));
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(body));
}

/** Compares two strings without leaking where they differ. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i]! ^ bytesB[i]!;
  return diff === 0;
}
