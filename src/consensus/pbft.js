import { ConsensusEngine } from './interface.js'
import { Block } from '../core/block.js'
import { Transaction } from '../core/transaction.js'
import { MessageType } from '../network/message.js'

/**
 * PBFT Consensus (simplified)
 *
 * Features:
 * - Primary proposes blocks
 * - Three-phase commit: Pre-prepare → Prepare → Commit
 * - 2f+1 quorum for finality (tolerates f Byzantine faults)
 */

const PBFTPhase = {
  IDLE: 'IDLE',
  PRE_PREPARED: 'PRE_PREPARED',
  PREPARED: 'PREPARED',
  COMMITTED: 'COMMITTED'
}

export class PBFTConsensus extends ConsensusEngine {
  constructor() {
    super('pbft')

    // Global settings
    this.proposalInterval = 5000 // ms between proposals (needs time for 3-phase commit with network delays)
    this.maxTxPerBlock = 5
  }

  init(node, network, globals = {}) {
    if (globals.proposalInterval !== undefined) this.proposalInterval = globals.proposalInterval
    
    node.consensusState = {
      view: 0,                    // View number
      sequence: 0,                // Sequence number (block height)

      // Message logs
      prePrepareLog: new Map(),   // seq -> PrePrepare message
      prepareLog: new Map(),      // seq -> Map(nodeId -> Prepare)
      commitLog: new Map(),       // seq -> Map(nodeId -> Commit)

      // Phase tracking per sequence
      phases: new Map(),          // seq -> PBFTPhase

      // Timing
      lastProposal: 0,
    }
    
    node.consensus = this
  }

  // Get number of nodes
  getN(network) {
    return network.nodes.size
  }

  // Get max faulty nodes: f = floor((n-1)/3)
  getF(network) {
    const n = this.getN(network)
    return Math.floor((n - 1) / 3)
  }

  // Get quorum size: 2f + 1
  getQuorum(network) {
    return 2 * this.getF(network) + 1
  }

  // Get primary for current view
  getPrimary(network, view) {
    const nodeIds = Array.from(network.nodes.keys()).sort()
    const idx = view % nodeIds.length
    return nodeIds[idx]
  }

  isPrimary(node, network) {
    return this.getPrimary(network, node.consensusState.view) === node.id
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
        case MessageType.PBFT_PRE_PREPARE:
        this.handlePrePrepare(node, msg, network)
        break
        case MessageType.PBFT_PREPARE:
        this.handlePrepare(node, msg, network)
        break
        case MessageType.PBFT_COMMIT:
        this.handleCommit(node, msg, network)
        break
      }
  }

  handleTxGossip(node, msg, network) {
    const tx = Transaction.fromData(msg.payload.tx)
    node.addToMempool(tx)
  }

  handlePrePrepare(node, msg, network) {
    const { view, sequence, block, primaryId } = msg.payload
    const state = node.consensusState
    
    // Validate view
    if (view !== state.view) {
      console.log(`Node ${node.id}: PrePrepare from wrong view ${view}, current ${state.view}`)
      return
    }

    // Validate primary
    const expectedPrimary = this.getPrimary(network, view)
    if (primaryId !== expectedPrimary) {
      console.log(`Node ${node.id}: PrePrepare from wrong primary ${primaryId}`)
      return
    }

    // Check if we already have a pre-prepare for this sequence
    if (state.prePrepareLog.has(sequence)) {
      return
    }

    // Store pre-prepare
    state.prePrepareLog.set(sequence, { view, sequence, block, primaryId })
    
    // Add block to store
    const blockObj = Block.fromData(block)
    if (!node.blockStore.has(blockObj.id)) {
      if (node.blockStore.has(blockObj.parentId) || blockObj.parentId === node.genesisId) {
        node.appendBlock(blockObj)
      }
    }

    // Initialize prepare/commit logs
    if (!state.prepareLog.has(sequence)) {
      state.prepareLog.set(sequence, new Map())
    }
    if (!state.commitLog.has(sequence)) {
      state.commitLog.set(sequence, new Map())
    }

    // Update phase
    state.phases.set(sequence, PBFTPhase.PRE_PREPARED)
    
    console.log(`Node ${node.id}: Received PRE-PREPARE for seq ${sequence}, block ${block.id.slice(0, 8)}`)
    
    // Broadcast PREPARE
    network.broadcast(node.id, MessageType.PBFT_PREPARE, {
      view,
      sequence,
      blockId: block.id,
      nodeId: node.id
    })
    
    // Add own prepare
    state.prepareLog.get(sequence).set(node.id, { view, sequence, blockId: block.id })
    
    // Check if prepared
    this.checkPrepared(node, sequence, network)
  }

  handlePrepare(node, msg, network) {
    const { view, sequence, blockId, nodeId } = msg.payload
    const state = node.consensusState
    
    // Validate view
    if (view !== state.view) return
    
    // Initialize logs if needed
    if (!state.prepareLog.has(sequence)) {
      state.prepareLog.set(sequence, new Map())
    }

    // Store prepare
    state.prepareLog.get(sequence).set(nodeId, { view, sequence, blockId })
    
    console.log(`Node ${node.id}: Received PREPARE from ${nodeId} for seq ${sequence} (${state.prepareLog.get(sequence).size} total)`)
    
    // Check if prepared
    this.checkPrepared(node, sequence, network)
  }

  checkPrepared(node, sequence, network) {
    const state = node.consensusState
    const quorum = this.getQuorum(network)
    
    const prepares = state.prepareLog.get(sequence)
    if (!prepares) return
    
    const phase = state.phases.get(sequence)
    if (phase === PBFTPhase.PREPARED || phase === PBFTPhase.COMMITTED) return
    
    // Need pre-prepare + 2f prepares (including self)
    if (!state.prePrepareLog.has(sequence)) return
    
    if (prepares.size >= quorum) {
      const prePrepare = state.prePrepareLog.get(sequence)
      
      console.log(`Node ${node.id}: PREPARED for seq ${sequence} with ${prepares.size} prepares`)
      state.phases.set(sequence, PBFTPhase.PREPARED)
      
      // Initialize commit log
      if (!state.commitLog.has(sequence)) {
        state.commitLog.set(sequence, new Map())
      }

      // Broadcast COMMIT
      network.broadcast(node.id, MessageType.PBFT_COMMIT, {
        view: state.view,
        sequence,
        blockId: prePrepare.block.id,
        nodeId: node.id
      })
      
      // Add own commit
      state.commitLog.get(sequence).set(node.id, {
        view: state.view,
        sequence,
        blockId: prePrepare.block.id
      })
      
      // Check if committed
      this.checkCommitted(node, sequence, network)
    }
  }

  handleCommit(node, msg, network) {
    const { view, sequence, blockId, nodeId } = msg.payload
    const state = node.consensusState
    
    // Validate view
    if (view !== state.view) return
    
    // Initialize logs if needed
    if (!state.commitLog.has(sequence)) {
      state.commitLog.set(sequence, new Map())
    }

    // Store commit
    state.commitLog.get(sequence).set(nodeId, { view, sequence, blockId })
    
    console.log(`Node ${node.id}: Received COMMIT from ${nodeId} for seq ${sequence} (${state.commitLog.get(sequence).size} total)`)
    
    // Check if committed
    this.checkCommitted(node, sequence, network)
  }

  checkCommitted(node, sequence, network) {
    const state = node.consensusState
    const quorum = this.getQuorum(network)
    
    const commits = state.commitLog.get(sequence)
    if (!commits) return
    
    const phase = state.phases.get(sequence)
    if (phase === PBFTPhase.COMMITTED) return
    
    if (commits.size >= quorum) {
      const prePrepare = state.prePrepareLog.get(sequence)
      if (!prePrepare) return
      
      console.log(`Node ${node.id}: COMMITTED for seq ${sequence} with ${commits.size} commits`)
      state.phases.set(sequence, PBFTPhase.COMMITTED)
      
      // Finalize block
      const blockId = prePrepare.block.id
      node.setHead(blockId)
      node.setFinalized(blockId)
      
      // Update sequence
      if (sequence >= state.sequence) {
        state.sequence = sequence + 1
      }

      // Remove included txs from mempool
      for (const txId of prePrepare.block.txIds) {
        node.mempool.delete(txId)
      }
    }
  }

  onTick(node, now, network) {
    const state = node.consensusState
    
    // Only primary proposes
    if (!this.isPrimary(node, network)) return
    
    // Check if enough time has passed
    if (now - state.lastProposal < this.proposalInterval) return
    
    // Check if we have pending transactions
    const pendingTxs = node.getPendingTxs(this.maxTxPerBlock)
    if (pendingTxs.length === 0) return
    
    // Create and propose block
    this.proposeBlock(node, pendingTxs, network)
  }

  proposeBlock(node, pendingTxs, network) {
    const state = node.consensusState
    const head = node.getHead()
    
    const sequence = state.sequence
    const block = new Block({
      parentId: head.id,
      height: sequence + 1,
      producerId: node.id,
      round: state.view,
      txIds: pendingTxs.map(tx => tx.id),
      transactions: pendingTxs,
      proof: {
        type: 'pbft',
        view: state.view,
        sequence
      }
    })
    
    console.log(`Node ${node.id} (Primary): Proposing block ${block.shortId()} for seq ${sequence}`)
    
    // Add block locally
    node.appendBlock(block)
    
    // Store pre-prepare
    state.prePrepareLog.set(sequence, {
      view: state.view,
      sequence,
      block: block.toJSON(),
      primaryId: node.id
    })
    
    // Initialize logs
    if (!state.prepareLog.has(sequence)) {
      state.prepareLog.set(sequence, new Map())
    }
    if (!state.commitLog.has(sequence)) {
      state.commitLog.set(sequence, new Map())
    }

    // Update phase
    state.phases.set(sequence, PBFTPhase.PRE_PREPARED)
    
    // Broadcast PRE-PREPARE
    network.broadcast(node.id, MessageType.PBFT_PRE_PREPARE, {
      view: state.view,
      sequence,
      block: block.toJSON(),
      primaryId: node.id
    })
    
    // Add own prepare
    state.prepareLog.get(sequence).set(node.id, {
      view: state.view,
      sequence,
      blockId: block.id
    })
    
    // Update timing
    state.lastProposal = Date.now()
    state.sequence++
  }

  getRole(node) {
    const state = node.consensusState
    // We need network to determine primary, but for display we use a simpler check
    return 'Replica'// Will be updated by UI
  }

  getRoleWithNetwork(node, network) {
    return this.isPrimary(node, network) ? 'Primary' : 'Replica'
  }

  isFinalized(node, blockId) {
    const block = node.getBlock(blockId)
    if (!block) return false
    
    const finalizedBlock = node.getFinalized()
    if (!finalizedBlock) return false
    
    // Check if block is in finalized chain
    let currentId = node.finalizedId
    while (currentId && currentId !== node.genesisId) {
      if (currentId === blockId) return true
      const b = node.getBlock(currentId)
      if (!b) break
      currentId = b.parentId
    }

    return false
  }

  getUIState(node) {
    const state = node.consensusState
    
    // Calculate current phase info
    let currentPhase = 'IDLE'
    let prepareCount = 0
    let commitCount = 0
    
    // Find the most recent active sequence
    for (const [seq, phase] of state.phases) {
      if (phase !== PBFTPhase.COMMITTED) {
        currentPhase = phase
        prepareCount = state.prepareLog.get(seq)?.size || 0
        commitCount = state.commitLog.get(seq)?.size || 0
      }
    }

    return {
      view: state.view,
      sequence: state.sequence,
      currentPhase,
      prepareCount,
      commitCount,
      role: 'Replica' // Updated by UI with network context
    }
  }

  // UI actions
  changeView(network) {
    // Simplified view change - just increment view for all nodes
    for (const [_, node] of network.nodes) {
      if (node.consensus === this) {
        node.consensusState.view++
        node.consensusState.lastProposal = 0
      }
    }
  }
}

export { PBFTPhase }
