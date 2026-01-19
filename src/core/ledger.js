export class Ledger {
  constructor() {
    this.balances = new Map()
        this.nonces = new Map()
        this.appliedBlocks = new Set()
        this.initialBalances = new Map()  // Track initial balances separately
    }

  clone() {
    const ledger = new Ledger()
        ledger.balances = new Map(this.balances)
        ledger.nonces = new Map(this.nonces)
        ledger.appliedBlocks = new Set(this.appliedBlocks)
        ledger.initialBalances = new Map(this.initialBalances)
        return ledger
    }

  getBalance(address) {
    return this.balances.get(address) || 0
    }

  getNonce(address) {
    return this.nonces.get(address) || 0
    }

  setBalance(address, amount) {
    this.balances.set(address, amount)
    // Also track as initial balance for recomputation
    this.initialBalances.set(address, amount)
    }

  // Apply a single transaction
  applyTransaction(tx) {
    const fromBalance = this.getBalance(tx.from)
        const toBalance = this.getBalance(tx.to)
    
    this.balances.set(tx.from, fromBalance - tx.amount)
        this.balances.set(tx.to, toBalance + tx.amount)
        this.nonces.set(tx.from, (this.nonces.get(tx.from) || 0) + 1)
    }

  // Apply a block's transactions
  applyBlock(block) {
    if (this.appliedBlocks.has(block.id)) return
    
    for (const tx of block.transactions) {
      this.applyTransaction(tx)
        }
    this.appliedBlocks.add(block.id)
    }

  // Compute ledger state by applying chain from genesis to given block
  static computeFromChain(blockStore, targetBlockId, genesisId, initialBalances = null) {
    const ledger = new Ledger()

    // Start with initial balances if provided
    if (initialBalances) {
      for (const [address, balance] of initialBalances) {
        ledger.balances.set(address, balance)
        ledger.initialBalances.set(address, balance)
      }
    }

    // Build the chain from target back to genesis
    const chain = []
        let currentId = targetBlockId

    while (currentId && currentId !== genesisId) {
      const block = blockStore.get(currentId)
            if (!block) break
            chain.unshift(block)
              currentId = block.parentId
        }

    // Apply blocks in order
    for (const block of chain) {
      ledger.applyBlock(block)
        }

    return ledger
    }
}
