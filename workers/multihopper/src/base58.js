const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    let carry = ALPHABET.indexOf(text[i]);
    if (carry < 0) return null;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros += 1;
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i];
  return out;
}

export function isSolanaAddress(value) {
  const decoded = base58Decode(value);
  return !!decoded && decoded.length === 32;
}

export function isSignature(value) {
  const decoded = base58Decode(value);
  return !!decoded && decoded.length === 64;
}
