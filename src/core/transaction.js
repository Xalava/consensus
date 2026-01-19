import { hash, sign, verify } from './crypto.js'

// Transaction states
export const TxState = {
  PENDING: 'PENDING',      // In mempool
  IN_BLOCK: 'IN_BLOCK',    // Included in a block
  FINALIZED: 'FINALIZED'   // Considered final
}

export class Transaction {
  constructor({ from, to, amount, nonce, privateKey }) {
    this.from = from
        this.to = to
        this.amount = amount
        this.nonce = nonce
        this.timestamp = Date.now()
    
    // Generate ID and signature
    const txData = { from, to, amount, nonce, timestamp: this.timestamp }
        this.id = hash(txData)
        this.signature = privateKey ? sign(txData, privateKey) : null
    }

  static fromData(data) {
    const tx = Object.create(Transaction.prototype)
        Object.assign(tx, data)
        return tx
    }

  isValid(balances, nonces) {
    // Check signature exists
    if (!this.signature) return { valid: false, reason: 'Missing signature' }
    
    // Check balance
    const balance = balances.get(this.from) || 0
        if (balance < this.amount) {
      return { valid: false, reason: 'Insufficient balance' }
        }

    // Check nonce
    const expectedNonce = nonces.get(this.from) || 0
        if (this.nonce !== expectedNonce) {
      return { valid: false, reason: `Invalid nonce: expected ${expectedNonce}, got ${this.nonce}` }
        }

    return { valid: true }
    }

  toJSON() {
    return {
      id: this.id,
      from: this.from,
      to: this.to,
      amount: this.amount,
      nonce: this.nonce,
      timestamp: this.timestamp,
      signature: this.signature
    }
    }

  shortId() {
    return this.id.slice(0, 8)
    }
}
