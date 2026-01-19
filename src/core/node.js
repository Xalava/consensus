import { Block } from './block.js'
import { Ledger } from './ledger.js'
import { TxState } from './transaction.js'

export class Node {
  constructor(id) {
    this.id = id
        this.name = `Node ${id}`
    
    // UI positioning
    this.x = 200
        this.y = 200
    
    // Block storage
    this.blockStore = new Map();  // blockId -> Block
    this.headId = null;           // Current best/committed head
    this.finalizedId = null;      // Last finalized block id

    // Genesis block
    const genesis = Block.genesis()
        this.blockStore.set(genesis.id, genesis)
        this.headId = genesis.id
        this.finalizedId = genesis.id
        this.genesisId = genesis.id
    
    // Mempool
    this.mempool = new Map();  // txId -> tx

    // Transaction states (tracked per node)
    this.txStates = new Map();  // txId -> TxState

    // Ledger (computed from chain)
    this.ledger = new Ledger()
    
    // Connected peers
    this.peers = new Set()
    
    // Consensus-specific state (set by consensus engine)
    this.consensus = null
        this.consensusState = {}
    
    // Event callbacks
    this.onBlockAdded = null
        this.onHeadChanged = null
        this.onFinalizedChanged = null
        this.onTxStateChanged = null
    }

  // Get current head block
  getHead() {
    return this.blockStore.get(this.headId)
    }

  // Get finalized block
  getFinalized() {
    return this.blockStore.get(this.finalizedId)
    }

  // Get block by ID
  getBlock(blockId) {
    return this.blockStore.get(blockId)
    }

  // Add a block to storage
  appendBlock(block) {
    if (this.blockStore.has(block.id)) return false

    this.blockStore.set(block.id, block)

    // Update tx states for included transactions and remove from mempool
    for (const tx of block.transactions) {
      if (this.txStates.get(tx.id) !== TxState.FINALIZED) {
        this.txStates.set(tx.id, TxState.IN_BLOCK)
        // Remove from mempool once included in a block
        this.mempool.delete(tx.id)
        if (this.onTxStateChanged) {
          this.onTxStateChanged(tx.id, TxState.IN_BLOCK)
        }
      }
    }

    if (this.onBlockAdded) {
      this.onBlockAdded(block)
    }

    return true
    }

  // Set the head (best chain tip)
  setHead(blockId) {
    if (this.headId === blockId) return
    
    this.headId = blockId
        this.recomputeLedger()
    
    if (this.onHeadChanged) {
      this.onHeadChanged(blockId)
        }
  }

  // Set the finalized block
  setFinalized(blockId) {
    if (this.finalizedId === blockId) return
    
    this.finalizedId = blockId
    
    // Mark all transactions in finalized chain as FINALIZED
    const chain = this.getChain(blockId)
        for (const block of chain) {
      for (const tx of block.transactions) {
        if (this.txStates.get(tx.id) !== TxState.FINALIZED) {
          this.txStates.set(tx.id, TxState.FINALIZED)
                    // Remove from mempool
          this.mempool.delete(tx.id)
                    if (this.onTxStateChanged) {
            this.onTxStateChanged(tx.id, TxState.FINALIZED)
                    }
        }
      }
    }

    if (this.onFinalizedChanged) {
      this.onFinalizedChanged(blockId)
        }
  }

  // Add transaction to mempool
  addToMempool(tx) {
    if (this.mempool.has(tx.id)) return false
    // Don't re-add if already in a block or finalized
    const currentState = this.txStates.get(tx.id)
    if (currentState === TxState.IN_BLOCK || currentState === TxState.FINALIZED) return false

    this.mempool.set(tx.id, tx)
    this.txStates.set(tx.id, TxState.PENDING)
    
    if (this.onTxStateChanged) {
      this.onTxStateChanged(tx.id, TxState.PENDING)
        }

    return true
    }

  // Get pending transactions from mempool (up to limit)
  getPendingTxs(limit = 10) {
    const txs = []
        for (const [id, tx] of this.mempool) {
      if (txs.length >= limit) break
      
      // Validate transaction
      const validation = tx.isValid(this.ledger.balances, this.ledger.nonces)
            if (validation.valid) {
        txs.push(tx)
            }
    }
    return txs
    }

  // Recompute ledger state from finalized chain
  recomputeLedger() {
    // Pass initial balances so they're preserved during recomputation
    this.ledger = Ledger.computeFromChain(
      this.blockStore,
      this.headId,
      this.genesisId,
      this.ledger.initialBalances
    )
    }

  // Get chain from genesis to given block
  getChain(blockId) {
    const chain = []
        let currentId = blockId
    
    while (currentId && currentId !== this.genesisId) {
      const block = this.blockStore.get(currentId)
            if (!block) break
            chain.unshift(block)
              currentId = block.parentId
        }

    return chain
    }

  // Get block height
  getHeight(blockId) {
    const block = this.blockStore.get(blockId)
        return block ? block.height : 0
    }

  // Get depth of a block (how many blocks are built on top of it)
  getDepth(blockId) {
    const headHeight = this.getHeight(this.headId)
        const blockHeight = this.getHeight(blockId)
        return headHeight - blockHeight
    }

  // Add peer connection
  addPeer(peerId) {
    this.peers.add(peerId)
    }

  // Remove peer connection
  removePeer(peerId) {
    this.peers.delete(peerId)
    }

  // Get role (set by consensus)
  getRole() {
    if (this.consensus && this.consensus.getRole) {
      return this.consensus.getRole(this)
        }
    return 'Node'
    }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      headId: this.headId,
      finalizedId: this.finalizedId,
      mempoolSize: this.mempool.size,
      role: this.getRole()
    }
    }
}
