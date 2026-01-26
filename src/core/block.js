import { hash } from './crypto.js'
import { Transaction } from './transaction.js'

export class Block {
  constructor({
    parentId,
    height,
    producerId,
    round = 0,
    txIds = [],
    proof = {},
    transactions = []
  }) {
    this.parentId = parentId
    this.height = height
    this.producerId = producerId
    this.round = round // term/view/slot depending on consensus
    this.txIds = txIds
    this.transactions = transactions // Full transaction objects
    this.proof = proof // Model-specific: nonce, signature, quorum certificates
    this.timestamp = Date.now()
    
    // Generate block ID from header
    this.id = hash({
      parentId,
      height,
      producerId,
      round,
      txIds,
      proof,
      timestamp: this.timestamp
    })
  }

  static genesis() {
    const genesis = new Block({
      parentId: '0'.repeat(8),
      height: 0,
      producerId: 'genesis',
      round: 0,
      txIds: [],
      proof: { type: 'genesis' }
    })
    genesis.id = '0'.repeat(8)
    genesis.timestamp = 0
    return genesis
  }

  static fromData(data) {
    const block = Object.create(Block.prototype)
    Object.assign(block, data)

    // Reconstruct transaction objects if they exist
    if (data.transactions && Array.isArray(data.transactions)) {
      block.transactions = data.transactions.map(tx =>
        tx instanceof Transaction ? tx : Transaction.fromData(tx)
      )
    } else {
      block.transactions = []
    }

    return block
  }

  toJSON() {
    return {
      id: this.id,
      parentId: this.parentId,
      height: this.height,
      producerId: this.producerId,
      round: this.round,
      txIds: this.txIds,
      transactions: this.transactions.map(tx => tx.toJSON ? tx.toJSON() : tx),
      proof: this.proof,
      timestamp: this.timestamp
    }
  }

  shortId() {
    return this.id.slice(0, 8)
  }

  // Check if this block has valid PoW
  hasValidPoW(difficulty) {
    const prefix = '0'.repeat(difficulty)
    return this.id.startsWith(prefix)
  }
}
