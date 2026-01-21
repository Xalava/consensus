import { ConsensusEngine } from './interface.js'
import { Block } from '../core/block.js'
import { Transaction } from '../core/transaction.js'
import { MessageType } from '../network/message.js'
import { hash } from '../core/crypto.js'

/**
 * Proof of Stake Consensus (simplified slot-based)
 *
 * Features:
 * - Slot-based leader selection weighted by stake
 * - Voting/attestation for blocks
 * - Quorum-based finality (>2/3 stake)
 */
export class PoSConsensus extends ConsensusEngine {
  constructor() {
    super('pos')

    // Global settings
    this.slotDuration = 4000    // ms per slot (allows time for block propagation and voting)
    this.maxTxPerBlock = 5
    this.quorumThreshold = 2/3  // Votes needed for finality

    // Validator stakes (nodeId -> stake)
    this.stakes = new Map()
    
    // Slot tracking
    this.currentSlot = 0
    this.slotStartTime = 0
  }

  init(node, network, globals = {}) {
    if (globals.slotDuration !== undefined) this.slotDuration = globals.slotDuration
    
    // Default stake
    const defaultStake = globals.defaultStake || 100
    if (!this.stakes.has(node.id)) {
      this.stakes.set(node.id, defaultStake)
    }

    node.consensusState = {
      isValidator: true,
      stake: this.stakes.get(node.id) || defaultStake,
      votes: new Map(),           // blockId -> Set of voter ids
      votedSlots: new Set(),      // Slots this node has voted in
      pendingBlocks: new Map(),   // blockId -> block (awaiting finalization)
    }
    
    node.consensus = this
  }

  getTotalStake() {
    let total = 0
    for (const [_, stake] of this.stakes) {
      total += stake
    }
    return total
  }

  getValidatorStake(nodeId) {
    return this.stakes.get(nodeId) || 0
  }

  setValidatorStake(nodeId, stake) {
    this.stakes.set(nodeId, stake)
  }

  // Select leader for a given slot using weighted random selection
  selectLeader(slot, validators) {
    const totalStake = this.getTotalStake()
    if (totalStake === 0) return null
    
    // Deterministic seed from slot
    const seed = hash(`slot-${slot}`)
    const seedNum = parseInt(seed.slice(0, 8), 16)
    const target = seedNum % totalStake
    
    let cumulative = 0
    for (const nodeId of validators) {
      const stake = this.stakes.get(nodeId) || 0
      cumulative += stake
      if (cumulative > target) {
        return nodeId
      }
    }

    return validators[0] // Fallback
  }

  onTx(node, tx, network) {
    if (node.addToMempool(tx)) {
      network.broadcast(node.id, MessageType.TX_GOSSIP, { tx: tx.toJSON() })
    }
  }

  onMessage(node, msg, network) {
    switch (msg.type) {
      case MessageType.TX_GOSSIP:
        this.handleTxGossip(node, msg, network)
        break
        case MessageType.BLOCK_PROPOSE:
        this.handleBlockPropose(node, msg, network)
        break
        case MessageType.BLOCK_VOTE:
        this.handleBlockVote(node, msg, network)
        break
      }
  }

  handleTxGossip(node, msg, network) {
    const tx = Transaction.fromData(msg.payload.tx)
    if (node.addToMempool(tx)) {
      network.broadcast(node.id, MessageType.TX_GOSSIP, { tx: tx.toJSON() }, msg.from)
    }
  }

  handleBlockPropose(node, msg, network) {
    const blockData = msg.payload.block
    const block = Block.fromData(blockData)
    
    // Validate slot
    if (block.round !== this.currentSlot) {
      console.log(`Node ${node.id}: Block ${block.shortId()} from wrong slot ${block.round}, current ${this.currentSlot}`)
      return
    }

    // Validate leader
    const validators = Array.from(this.stakes.keys())
    const expectedLeader = this.selectLeader(block.round, validators)
    if (block.producerId !== expectedLeader) {
      console.log(`Node ${node.id}: Block ${block.shortId()} from wrong leader ${block.producerId}, expected ${expectedLeader}`)
      return
    }

    // Check parent exists
    if (!node.blockStore.has(block.parentId)) {
      console.log(`Node ${node.id}: Missing parent for block ${block.shortId()}`)
      return
    }

    // Store block
    const isNew = node.appendBlock(block)
    
    if (isNew) {
      // Initialize vote tracking
      if (!node.consensusState.votes.has(block.id)) {
        node.consensusState.votes.set(block.id, new Set())
      }

      // Store pending block
      node.consensusState.pendingBlocks.set(block.id, block)
      
      // Update head (tentatively accept)
      node.setHead(block.id)
      
      // Vote for this block if validator
      if (node.consensusState.isValidator && !node.consensusState.votedSlots.has(block.round)) {
        this.castVote(node, block, network)
      }

      // Re-gossip block (exclude the sender)
      network.broadcast(node.id, MessageType.BLOCK_PROPOSE, { block: block.toJSON() }, msg.from)
    }
  }

  castVote(node, block, network) {
    node.consensusState.votedSlots.add(block.round)
    
    // Add own vote
    const votes = node.consensusState.votes.get(block.id)
    if (votes) {
      votes.add(node.id)
    }

    // Broadcast vote
    network.broadcast(node.id, MessageType.BLOCK_VOTE, {
      blockId: block.id,
      slot: block.round,
      voterId: node.id,
      stake: node.consensusState.stake
    })
    
    console.log(`Node ${node.id}: Voted for block ${block.shortId()}`)
    
    // Check if quorum reached
    this.checkQuorum(node, block.id)
  }

  handleBlockVote(node, msg, network) {
    const { blockId, slot, voterId, stake } = msg.payload
    
    // Initialize vote set if needed
    if (!node.consensusState.votes.has(blockId)) {
      node.consensusState.votes.set(blockId, new Set())
    }

    const votes = node.consensusState.votes.get(blockId)
    if (!votes.has(voterId)) {
      votes.add(voterId)
      console.log(`Node ${node.id}: Received vote from ${voterId} for block ${blockId.slice(0, 8)}`)
      
      // Check if quorum reached
      this.checkQuorum(node, blockId)
    }
  }

  checkQuorum(node, blockId) {
    const votes = node.consensusState.votes.get(blockId)
    if (!votes) return
    
    // Calculate voted stake
    let votedStake = 0
    for (const voterId of votes) {
      votedStake += this.stakes.get(voterId) || 0
    }

    const totalStake = this.getTotalStake()
    const voteRatio = votedStake / totalStake
    
    console.log(`Node ${node.id}: Block ${blockId.slice(0, 8)} has ${(voteRatio * 100).toFixed(1)}% votes (${votes.size} validators)`)
    
    // Check if quorum reached
    if (voteRatio >= this.quorumThreshold) {
      console.log(`Node ${node.id}: Block ${blockId.slice(0, 8)} FINALIZED with ${(voteRatio * 100).toFixed(1)}% votes`)
      node.setFinalized(blockId)
      
      // Clean up
      node.consensusState.pendingBlocks.delete(blockId)
    }
  }

  onTick(node, now, network) {
    // Update slot
    const newSlot = Math.floor(now / this.slotDuration)
    
    if (newSlot !== this.currentSlot) {
      this.currentSlot = newSlot
      this.slotStartTime = now
      
      // Check if this node is the leader for this slot
      const validators = Array.from(this.stakes.keys())
      const leader = this.selectLeader(this.currentSlot, validators)
      
      if (leader === node.id && node.consensusState.isValidator) {
        // Propose a block
        this.proposeBlock(node, network)
      }
    }
  }

  proposeBlock(node, network) {
    const head = node.getHead()
    const pendingTxs = node.getPendingTxs(this.maxTxPerBlock)
    
    const block = new Block({
      parentId: head.id,
      height: head.height + 1,
      producerId: node.id,
      round: this.currentSlot,
      txIds: pendingTxs.map(tx => tx.id),
      transactions: pendingTxs,
      proof: {
        type: 'pos',
        slot: this.currentSlot,
        stake: node.consensusState.stake
      }
    })
    
    console.log(`Node ${node.id}: Proposing block ${block.shortId()} for slot ${this.currentSlot}`)
    
    // Add block locally
    node.appendBlock(block)
    
    // Initialize vote tracking
    node.consensusState.votes.set(block.id, new Set())
    node.consensusState.pendingBlocks.set(block.id, block)
    
    // Update head
    node.setHead(block.id)
    
    // Remove included txs from mempool
    for (const tx of pendingTxs) {
      node.mempool.delete(tx.id)
    }

    // Vote for own block
    this.castVote(node, block, network)
    
    // Broadcast block
    network.broadcast(node.id, MessageType.BLOCK_PROPOSE, {
      block: block.toJSON()
    })
  }

  getRole(node) {
    if (!node.consensusState.isValidator) return 'Observer'
    
    const validators = Array.from(this.stakes.keys())
    const leader = this.selectLeader(this.currentSlot, validators)
    
    return leader === node.id ? 'Leader' : 'Validator'
  }

  isFinalized(node, blockId) {
    const finalizedId = node.finalizedId
    if (!finalizedId) return false
    
    // Check if blockId is in the finalized chain
    let currentId = finalizedId
    while (currentId) {
      if (currentId === blockId) return true
      const block = node.getBlock(currentId)
      if (!block) break
      currentId = block.parentId
    }

    return false
  }

  getUIState(node) {
    const validators = Array.from(this.stakes.keys())
    const leader = this.selectLeader(this.currentSlot, validators)
    
    return {
      isValidator: node.consensusState.isValidator,
      stake: node.consensusState.stake,
      currentSlot: this.currentSlot,
      isLeader: leader === node.id,
      currentLeader: leader,
      pendingBlocks: node.consensusState.pendingBlocks?.size || 0,
      quorumThreshold: this.quorumThreshold * 100
    }
  }

  // UI actions
  toggleValidator(node) {
    node.consensusState.isValidator = !node.consensusState.isValidator
  }

  setStake(node, stake) {
    node.consensusState.stake = Math.max(0, stake)
    this.stakes.set(node.id, node.consensusState.stake)
  }
}
