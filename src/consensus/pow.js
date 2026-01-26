import { ConsensusEngine } from './interface.js'
import { Block } from '../core/block.js'
import { Transaction } from '../core/transaction.js'
import { MessageType} from '../network/message.js'
import { hash } from '../core/crypto.js'

/**
 * Proof of Work Consensus
 *
 * Features:
 * - Mining race with configurable difficulty
 * - Fork handling with longest chain rule
 * - Confirmation-based finality
 */

export class PoWConsensus extends ConsensusEngine {
  constructor() {
    super('pow')

    // Global settings
    this.difficulty = 2       // Number of leading zeros required (2 = ~1/256 chance)
    this.confirmations = 1    // Blocks needed for finality (1 = next block confirms)
    this.maxTxPerBlock = 5    // Max transactions per block
  }

  init(node, network, globals = {}) {
    // Apply global settings
    if (globals.difficulty !== undefined) this.difficulty = globals.difficulty
    if (globals.confirmations !== undefined) this.confirmations = globals.confirmations

    // Node-specific state - randomize starting nonce so different nodes find blocks
    node.consensusState = {
      mining: true,           // Whether this node is mining
      hashPower: Math.floor(Math.random() * 12) + 1, // Number of hash attempts per tick 
      nativeNonce: Math.floor(Math.random() * 1000), // entropy to ensure different starting points, constant
      currentNonce: 0,
      miningHeight: 1,        // Height currently mining at
      lastBlockTime: 0,       // Timestamp of last mined block (for animation)
      blockJustMined: false,  // Flag for block mined animation
    }

    node.consensus = this
  }

  // ** The user interfaces API **
  onTx(node, tx, network) {
    // Add to mempool
    if (node.addToMempool(tx)) {
      // Gossip to peers (network handles transmission delay)
      network.broadcast(node.id, MessageType.TX_GOSSIP, { tx: tx.toJSON() })
      return
    }
  }

  // ** The node to node API **
  onMessage(node, msg, network) {
    switch (msg.type) {
      case MessageType.TX_GOSSIP:
        this.handleTxGossip(node, msg, network)
        break
        case MessageType.BLOCK_PROPOSE:
        this.handleBlockPropose(node, msg, network)
        break
      }
  }



  handleTxGossip(node, msg, network) {
    const tx = Transaction.fromData(msg.payload.tx)

    // Add to mempool and re-gossip if new
    if (node.addToMempool(tx)) {
      network.broadcast(node.id, MessageType.TX_GOSSIP, { tx: tx.toJSON() }, msg.from)
    }
  }

  handleBlockPropose(node, msg, network) {
    const blockData = msg.payload.block
    const block = Block.fromData(blockData)

    // Validate PoW
    if (!this.isValidPoW(block)) {
      console.log(`N${node.id}: Invalid PoW for block ${block.shortId()}`)
      return
    }

    // Check if we have the parent
    if (!node.blockStore.has(block.parentId)) {
      console.log(`N${node.id}: Missing parent ${block.parentId.slice(0, 8)} for block ${block.shortId()}`)
      return
    }

    // Add block
    const isNew = node.appendBlock(block)

    if (isNew) {
      const currentHead = node.headId
      const currentHeight = node.getHeight(currentHead)

      // Check if this creates a competing fork at the same height
      if (block.height === currentHeight && block.parentId === node.getBlock(currentHead).parentId) {
        console.log(`N${node.id}: 🍴 Competing block ${block.shortId()} at height ${block.height} (keeping current head ${currentHead.slice(0, 8)})`)
      } else {
        console.log(`N${node.id}: Added block ${block.shortId()} at height ${block.height}`)
      }

      // Apply fork choice rule (longest chain)
      this.applyForkChoice(node)

      if (node.headId !== currentHead) {
        console.log(`N${node.id}: ⚡ Switched to longer chain, new head: ${node.headId.slice(0, 8)} at height ${node.getHeight(node.headId)}`)
      }

      // Reset mining progress if this block is at or above our current mining height
      const state = node.consensusState
      if (block.height >= state.miningHeight) {
        state.currentNonce = 0
        state.miningHeight = node.getHeight(node.headId) + 1
      }

      // Update finality
      this.updateFinality(node)

      // Re-gossip the block (exclude the sender)
      network.broadcast(node.id, MessageType.BLOCK_PROPOSE, { block: block.toJSON() }, msg.from)
    }
  }

  onTick(node, now, network) {
    
    const state = node.consensusState

    // Clear block mined flag after animation duration (800ms)
    if (state.blockJustMined && now - state.lastBlockTime > 800) {
      state.blockJustMined = false
    }

    if (!state.mining) {
      return
    }

    // Try to mine a block
    const head = node.getHead()

    // Ensure miningHeight is in sync with head
    const expectedMiningHeight = head.height + 1
    if (state.miningHeight !== expectedMiningHeight) {
      state.miningHeight = expectedMiningHeight
      state.currentNonce = 0
    }

    // Exclude transactions that are already present in the local block store/chain
    const pendingTxs = node.getPendingTxs(this.maxTxPerBlock)
      .filter(tx => !this.isTxInChain(node, tx.id))

    // Only mine if there are pending transactions
    if (pendingTxs.length === 0) {
      return
    }

    // Try multiple nonces per tick (based on this node's hash power)
    for (let i = 0; i < state.hashPower; i++) {
      const nonce = state.currentNonce++ + state.nativeNonce

      const block = new Block({
        parentId: head.id,
        height: state.miningHeight,
        producerId: node.id,
        round: 0,
        txIds: pendingTxs.map(tx => tx.id),
        transactions: pendingTxs,
        proof: { nonce, difficulty: this.difficulty }
      })

      // Check if valid PoW
      if (this.isValidPoW(block)) {
        console.log(`N${node.id}: ⛏️ Mined block ${block.shortId()} at height ${block.height} (${state.currentNonce} attempts)`)

        // Add block locally
        node.appendBlock(block)
        this.applyForkChoice(node)
        this.updateFinality(node)

        // Broadcast block (do not remove txs from mempool yet — wait until finality)
        network.broadcast(node.id, MessageType.BLOCK_PROPOSE, {
          block: block.toJSON()
        })

        // Reset for next block and set animation flag
        state.currentNonce = 0
        state.miningHeight++
        state.lastBlockTime = now
        state.blockJustMined = true
        break
      }
    }
  }

  isValidPoW(block) {
    const prefix = '0'.repeat(this.difficulty)
    return block.id.startsWith(prefix)
  }

  applyForkChoice(node) {
    // Longest chain rule - only switch if a chain is strictly longer
    let bestId = node.headId
    let bestHeight = node.getHeight(bestId)

    for (const [blockId, block] of node.blockStore) {
      // Check if this is a chain tip (no children)
      let isHead = true
      for (const [otherId, otherBlock] of node.blockStore) {
        if (otherBlock.parentId === blockId) {
          isHead = false
          break
        }
      }

      if (!isHead) continue

      // Only switch if this chain is strictly longer
      if (block.height > bestHeight) {
        bestId = blockId
        bestHeight = block.height
      }
    }

    node.setHead(bestId)
  }

  updateFinality(node) {
    // Walk back from head to find block with enough confirmations
    const headHeight = node.getHeight(node.headId)
    const finalizedHeight = headHeight - this.confirmations
    
    if (finalizedHeight <= 0) return
    
    // Find block at finalized height in current chain
    let currentId = node.headId
    while (currentId) {
      const block = node.getBlock(currentId)
      if (!block) break
      
      if (block.height === finalizedHeight) {
        node.setFinalized(currentId)

        // Remove transactions included in this newly-finalized block from the mempool
        try {
          const finalizedBlock = node.getBlock(currentId)
          if (finalizedBlock && finalizedBlock.txIds && finalizedBlock.txIds.length) {
            for (const txId of finalizedBlock.txIds) {
              node.mempool.delete(txId)
            }
          }
        } catch (e) {
          // Defensive: if mempool manipulation fails, ignore — it's non-fatal for the simulation
        }

        break
      }
      currentId = block.parentId
    }
  }

  // Helper: check whether a tx id already appears in any block in the local block store
  isTxInChain(node, txId) {
    for (const [, block] of node.blockStore) {
      if (block.txIds && block.txIds.includes(txId)) return true
    }
    return false
  }

  getRole(node) {
    return node.consensusState.mining ? 'Miner 👷' : ''
  }

  isFinalized(node, blockId) {
    const block = node.getBlock(blockId)
    if (!block) return false
    
    const headHeight = node.getHeight(node.headId)
    return block.height <= headHeight - this.confirmations
  }

  getUIState(node) {
    const state = node.consensusState

    // Check if we have pending transactions
    const pendingTxs = node.getPendingTxs(this.maxTxPerBlock)
      .filter(tx => !this.isTxInChain(node, tx.id))
    const hasPendingTxs = pendingTxs.length > 0

    // Estimate expected trials based on difficulty (16^difficulty)
    const expectedTrials = Math.pow(16, this.difficulty)
    // Normalize progress to 0-1 range (capped at 1.0)
    const progress = Math.min(1.0, state.currentNonce / expectedTrials)

    return {
      mining: state.mining,
      difficulty: this.difficulty,
      confirmations: this.confirmations,
      trials: state.currentNonce,
      progress: progress,
      hashPower: state.hashPower || 0,
      blockJustMined: state.blockJustMined || false,
      isMiningActive: state.mining && hasPendingTxs,
    }
  }

  // UI actions
  toggleMining(node) {
    node.consensusState.mining = !node.consensusState.mining
  }

  setDifficulty(value) {
    this.difficulty = Math.max(1, Math.min(4, value))
  }

  setConfirmations(value) {
    this.confirmations = Math.max(1, Math.min(10, value))
  }
}
