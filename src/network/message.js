import { generateId } from '../core/crypto.js'

// Message types
export const MessageType = {
  // Wallet to node
  WALLET_TX: 'WALLET_TX',

  // Common
  TX_GOSSIP: 'TX_GOSSIP',
  BLOCK_PROPOSE: 'BLOCK_PROPOSE',
  BLOCK_VOTE: 'BLOCK_VOTE',

  // Raft specific
  RAFT_REQUEST_VOTE: 'RAFT_REQUEST_VOTE',
  RAFT_VOTE: 'RAFT_VOTE',
  RAFT_APPEND_ENTRIES: 'RAFT_APPEND_ENTRIES',
  RAFT_APPEND_ACK: 'RAFT_APPEND_ACK',
  RAFT_HEARTBEAT: 'RAFT_HEARTBEAT',

  // PBFT specific
  PBFT_PRE_PREPARE: 'PBFT_PRE_PREPARE',
  PBFT_PREPARE: 'PBFT_PREPARE',
  PBFT_COMMIT: 'PBFT_COMMIT'
}

export class Message {
  constructor(type, from, to, payload) {
    this.id = generateId()
    this.type = type
    this.from = from
    this.to = to
    this.payload = payload
    this.createdAt = Date.now()
    this.deliverAt = null  // Set by network

    // For visualization
    this.progress = 0  // 0 to 1
  }

  static create(type, from, to, payload) {
    return new Message(type, from, to, payload)
  }
}
