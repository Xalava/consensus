import { ConsensusEngine } from './interface.js'
import { Block } from '../core/block.js'
import { Transaction } from '../core/transaction.js'
import { MessageType } from '../network/message.js'

/**
 * Raft Consensus (simplified)
 *
 * Features:
 * - Leader election with term-based voting
 * - Log replication via AppendEntries
 * - Majority commit for finality
 */

const RaftRole = {
  FOLLOWER: 'Follower',
  CANDIDATE: 'Candidate',
  LEADER: 'Leader'
}

export class RaftConsensus extends ConsensusEngine {
  constructor() {
    super('raft')

    // Global settings
    this.electionTimeoutMin = 4000  // ms (should be > 2x heartbeat round-trip)
    this.electionTimeoutMax = 6000  // ms
    this.heartbeatInterval = 1500   // ms (slightly higher than max network delay)
    this.maxTxPerBlock = 5
  }

  init(node, network, globals = {}) {
    if (globals.electionTimeoutMin !== undefined) this.electionTimeoutMin = globals.electionTimeoutMin
    if (globals.electionTimeoutMax !== undefined) this.electionTimeoutMax = globals.electionTimeoutMax
    
    node.consensusState = {
      role: RaftRole.FOLLOWER,
      term: 0,
      votedFor: null,         // NodeId voted for in current term
      leaderId: null,

      // Election timing
      electionTimeout: this.randomElectionTimeout(),
      lastHeartbeat: Date.now(),

      // Leader state
      heartbeatEnabled: true,
      lastHeartbeatSent: 0,

      // Replication tracking (leader only)
      nextIndex: new Map(),   // nodeId -> next log index to send
      matchIndex: new Map(),  // nodeId -> highest replicated index

      // Votes received (candidate only)
      votesReceived: new Set(),

      // Commit tracking
      commitIndex: 0,         // Highest committed entry
      lastApplied: 0,         // Highest applied entry
    }
    
    node.consensus = this
  }

  randomElectionTimeout() {
    return this.electionTimeoutMin +
           Math.random() * (this.electionTimeoutMax - this.electionTimeoutMin)
          }

  onTx(node, tx, network) {
    if (node.addToMempool(tx)) {
      // Only leader handles client requests, followers redirect
      if (node.consensusState.role === RaftRole.LEADER) {
        // Tx will be batched into next AppendEntries
      } else if (node.consensusState.leaderId) {
        // Forward to leader (simplified: just gossip)
        network.send(node.id, node.consensusState.leaderId, MessageType.TX_GOSSIP, {
          tx: tx.toJSON()
        })
      }

      // Gossip for visualization
      network.broadcast(node.id, MessageType.TX_GOSSIP, { tx: tx.toJSON() })
    }
  }

  onMessage(node, msg, network) {
    switch (msg.type) {
      case MessageType.TX_GOSSIP:
        this.handleTxGossip(node, msg, network)
        break
        case MessageType.RAFT_REQUEST_VOTE:
        this.handleRequestVote(node, msg, network)
        break
        case MessageType.RAFT_VOTE:
        this.handleVote(node, msg, network)
        break
        case MessageType.RAFT_APPEND_ENTRIES:
        this.handleAppendEntries(node, msg, network)
        break
        case MessageType.RAFT_APPEND_ACK:
        this.handleAppendAck(node, msg, network)
        break
        case MessageType.RAFT_HEARTBEAT:
        this.handleHeartbeat(node, msg, network)
        break
      }
  }

  handleTxGossip(node, msg, network) {
    const tx = Transaction.fromData(msg.payload.tx)
    node.addToMempool(tx)
  }

  handleRequestVote(node, msg, network) {
    const { term, candidateId, lastLogIndex, lastLogTerm } = msg.payload
    const state = node.consensusState
    
    // Update term if needed
    if (term > state.term) {
      state.term = term
      state.role = RaftRole.FOLLOWER
      state.votedFor = null
      state.leaderId = null
    }

    let voteGranted = false
    
    // Grant vote if:
    // 1. Candidate's term >= our term
    // 2. We haven't voted or voted for this candidate
    // 3. Candidate's log is at least as up-to-date
    if (term >= state.term &&
        (state.votedFor === null || state.votedFor === candidateId)) {

      const ourLastIndex = node.getHead().height
      const ourLastTerm = state.term
      
      if (lastLogTerm > ourLastTerm ||
          (lastLogTerm === ourLastTerm && lastLogIndex >= ourLastIndex)) {
        voteGranted = true
        state.votedFor = candidateId
        state.lastHeartbeat = Date.now(); // Reset election timeout
        console.log(`Node ${node.id}: Voted for ${candidateId} in term ${term}`)
      }
    }

    // Send vote response
    network.send(node.id, candidateId, MessageType.RAFT_VOTE, {
      term: state.term,
      voteGranted,
      voterId: node.id
    })
  }

  handleVote(node, msg, network) {
    const { term, voteGranted, voterId } = msg.payload
    const state = node.consensusState
    
    if (state.role !== RaftRole.CANDIDATE) return
    if (term !== state.term) return
    
    if (voteGranted) {
      state.votesReceived.add(voterId)
      console.log(`Node ${node.id}: Received vote from ${voterId} (${state.votesReceived.size} total)`)
      
      // Check if we have majority
      const totalNodes = network.nodes.size
      const majority = Math.floor(totalNodes / 2) + 1
      
      if (state.votesReceived.size >= majority) {
        this.becomeLeader(node, network)
      }
    }
  }

  handleAppendEntries(node, msg, network) {
    const { term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit } = msg.payload
    const state = node.consensusState
    
    // Update term if needed
    if (term > state.term) {
      state.term = term
      state.role = RaftRole.FOLLOWER
      state.votedFor = null
    }

    // Reject if term is old
    if (term < state.term) {
      network.send(node.id, leaderId, MessageType.RAFT_APPEND_ACK, {
        term: state.term,
        success: false,
        matchIndex: 0,
        followerId: node.id
      })
      return
    }

    // Accept leader
    state.leaderId = leaderId
    state.lastHeartbeat = Date.now()
    
    if (state.role === RaftRole.CANDIDATE) {
      state.role = RaftRole.FOLLOWER
    }

    // Process entries (simplified: just add blocks)
    let success = true
    let lastMatchIndex = prevLogIndex
    
    for (const entry of entries) {
      const block = Block.fromData(entry)
      
      // Check if we have the parent
      if (node.blockStore.has(block.parentId) || block.parentId === node.genesisId) {
        node.appendBlock(block)
        node.setHead(block.id)
        lastMatchIndex = block.height
        
        // Remove included txs from mempool
        for (const txId of block.txIds) {
          node.mempool.delete(txId)
        }
      } else {
        success = false
        break
      }
    }

    // Update commit index
    if (leaderCommit > state.commitIndex) {
      state.commitIndex = Math.min(leaderCommit, lastMatchIndex)
      this.applyCommitted(node)
    }

    // Send ack
    network.send(node.id, leaderId, MessageType.RAFT_APPEND_ACK, {
      term: state.term,
      success,
      matchIndex: lastMatchIndex,
      followerId: node.id
    })
  }

  handleAppendAck(node, msg, network) {
    const { term, success, matchIndex, followerId } = msg.payload
    const state = node.consensusState
    
    if (state.role !== RaftRole.LEADER) return
    if (term !== state.term) return
    
    if (success) {
      state.matchIndex.set(followerId, matchIndex)
      state.nextIndex.set(followerId, matchIndex + 1)
      
      // Check for new commits
      this.updateCommitIndex(node, network)
    } else {
      // Decrement nextIndex and retry
      const nextIdx = state.nextIndex.get(followerId) || 1
      state.nextIndex.set(followerId, Math.max(1, nextIdx - 1))
    }
  }

  handleHeartbeat(node, msg, network) {
    const { term, leaderId, leaderCommit } = msg.payload
    const state = node.consensusState
    
    if (term >= state.term) {
      state.term = term
      state.leaderId = leaderId
      state.lastHeartbeat = Date.now()
      
      if (state.role !== RaftRole.FOLLOWER) {
        state.role = RaftRole.FOLLOWER
        state.votedFor = null
      }

      // Update commit index
      if (leaderCommit > state.commitIndex) {
        const headHeight = node.getHead().height
        state.commitIndex = Math.min(leaderCommit, headHeight)
        this.applyCommitted(node)
      }
    }
  }

  becomeLeader(node, network) {
    const state = node.consensusState
    state.role = RaftRole.LEADER
    state.leaderId = node.id
    
    console.log(`Node ${node.id}: Became LEADER for term ${state.term}`)
    
    // Initialize leader state
    const lastLogIndex = node.getHead().height
    for (const [nodeId] of network.nodes) {
      if (nodeId !== node.id) {
        state.nextIndex.set(nodeId, lastLogIndex + 1)
        state.matchIndex.set(nodeId, 0)
      }
    }

    // Send initial heartbeat
    this.sendHeartbeat(node, network)
  }

  startElection(node, network) {
    const state = node.consensusState
    state.term++
    state.role = RaftRole.CANDIDATE
    state.votedFor = node.id
    state.votesReceived = new Set([node.id])
    state.lastHeartbeat = Date.now()
    state.electionTimeout = this.randomElectionTimeout()
    
    console.log(`Node ${node.id}: Starting election for term ${state.term}`)
    
    // Request votes from all peers
    const head = node.getHead()
    network.broadcast(node.id, MessageType.RAFT_REQUEST_VOTE, {
      term: state.term,
      candidateId: node.id,
      lastLogIndex: head.height,
      lastLogTerm: state.term - 1
    })
  }

  sendHeartbeat(node, network) {
    const state = node.consensusState
    
    network.broadcast(node.id, MessageType.RAFT_HEARTBEAT, {
      term: state.term,
      leaderId: node.id,
      leaderCommit: state.commitIndex
    })
    
    state.lastHeartbeatSent = Date.now()
  }

  replicateEntries(node, network) {
    const state = node.consensusState
    const head = node.getHead()
    
    // Get pending transactions and create a block
    const pendingTxs = node.getPendingTxs(this.maxTxPerBlock)
    if (pendingTxs.length === 0) return
    
    const block = new Block({
      parentId: head.id,
      height: head.height + 1,
      producerId: node.id,
      round: state.term,
      txIds: pendingTxs.map(tx => tx.id),
      transactions: pendingTxs,
      proof: { type: 'raft', term: state.term }
    })
    
    // Add locally
    node.appendBlock(block)
    node.setHead(block.id)
    
    // Remove from mempool
    for (const tx of pendingTxs) {
      node.mempool.delete(tx.id)
    }

    console.log(`Node ${node.id}: Created block ${block.shortId()} at height ${block.height}`)
    
    // Send to all followers
    for (const [nodeId] of network.nodes) {
      if (nodeId !== node.id) {
        const nextIdx = state.nextIndex.get(nodeId) || 1
        const prevBlock = node.getBlock(head.id)
        
        network.send(node.id, nodeId, MessageType.RAFT_APPEND_ENTRIES, {
          term: state.term,
          leaderId: node.id,
          prevLogIndex: prevBlock ? prevBlock.height : 0,
          prevLogTerm: state.term,
          entries: [block.toJSON()],
          leaderCommit: state.commitIndex
        })
      }
    }
  }

  updateCommitIndex(node, network) {
    const state = node.consensusState
    const totalNodes = network.nodes.size
    const majority = Math.floor(totalNodes / 2) + 1
    
    // Find highest index replicated on majority
    const head = node.getHead()
    
    for (let n = head.height; n > state.commitIndex; n--) {
      let replicatedCount = 1// Leader has it

      for (const [nodeId, matchIdx] of state.matchIndex) {
        if (matchIdx >= n) {
          replicatedCount++
        }
      }

      if (replicatedCount >= majority) {
        state.commitIndex = n
        console.log(`Node ${node.id}: Committed index ${n}`)
        this.applyCommitted(node)
        break
      }
    }
  }

  applyCommitted(node) {
    const state = node.consensusState
    
    // Find block at commit index and finalize
    let currentId = node.headId
    while (currentId && currentId !== node.genesisId) {
      const block = node.getBlock(currentId)
      if (!block) break
      
      if (block.height <= state.commitIndex) {
        node.setFinalized(currentId)
        break
      }
      currentId = block.parentId
    }
  }

  onTick(node, now, network) {
    const state = node.consensusState
    
    switch (state.role) {
      case RaftRole.FOLLOWER:
      case RaftRole.CANDIDATE:
        // Check election timeout
        if (now - state.lastHeartbeat > state.electionTimeout) {
          this.startElection(node, network)
        }
        break
        
      case RaftRole.LEADER:
        // Send heartbeats
        if (state.heartbeatEnabled && now - state.lastHeartbeatSent > this.heartbeatInterval) {
          this.sendHeartbeat(node, network)
        }

        // Replicate new entries
        if (node.mempool.size > 0) {
          this.replicateEntries(node, network)
        }
        break
      }
  }

  getRole(node) {
    return node.consensusState.role
  }

  isFinalized(node, blockId) {
    const block = node.getBlock(blockId)
    if (!block) return false
    return block.height <= node.consensusState.commitIndex
  }

  getUIState(node) {
    const state = node.consensusState
    return {
      role: state.role,
      term: state.term,
      leaderId: state.leaderId,
      commitIndex: state.commitIndex,
      votedFor: state.votedFor,
      heartbeatEnabled: state.heartbeatEnabled,
      votesReceived: state.votesReceived?.size || 0
    }
  }

  // UI actions
  triggerElection(node, network) {
    this.startElection(node, network)
  }

  toggleHeartbeat(node) {
    node.consensusState.heartbeatEnabled = !node.consensusState.heartbeatEnabled
  }
}

export { RaftRole }
