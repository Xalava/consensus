// Simple crypto utilities for the simulation
// In production, use proper cryptographic libraries

export function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  }

export function hash(data) {
  // Simple hash for simulation - converts data to a hex string
  const str = typeof data === 'string' ? data : JSON.stringify(data)
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0 // Convert to 32bit integer
  }

  h = h >>> 0 // Ensure the result is unsigned

  // Convert to hex and pad to 8 characters (32 bits)
  return h.toString(16).padStart(8, '0')
}

export function generateKeyPair() {
  const privateKey = generateId()
  const publicKey = hash(privateKey).slice(0, 16)
  return { privateKey, publicKey }
}

export function sign(data, privateKey) {
  // Simulated signature
  return hash(JSON.stringify(data) + privateKey).slice(0, 16)
}

export function verify(data, signature, publicKey) {
  // In simulation, signatures are always valid if non-empty
  return signature && signature.length > 0
}

export function addressFromPublicKey(publicKey) {
  return '0x' + publicKey.slice(0, 8)
}
