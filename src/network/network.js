import { Message } from './message.js'

export class Network {
  constructor() {
    // Network settings
    this.minDelay = 1000  // ms
    this.maxDelay = 2000  // ms
    this.packetLoss = 0  // 0 to 1

    // Messages in flight
    this.messages = []
    
    // Node registry
    this.nodes = new Map() // nodeId -> Node

    // Callbacks for visualization
    this.onMessageCreated = null
    this.onMessageDelivered = null
    this.onMessageDropped = null
  }

  // Register a node
  registerNode(node) {
    this.nodes.set(node.id, node)
  }

  // Unregister a node
  unregisterNode(nodeId) {
    this.nodes.delete(nodeId)
  }

  // Get a node by ID
  getNode(nodeId) {
    return this.nodes.get(nodeId)
  }

  // Calculate random delay
  getDelay() {
    return this.minDelay + Math.random() * (this.maxDelay - this.minDelay)
  }

  // Check if packet should be dropped
  shouldDrop() {
    return Math.random() < this.packetLoss
  }

  // Send message to a specific node
  send(from, to, type, payload) {
    if (this.shouldDrop()) {
      if (this.onMessageDropped) {
        this.onMessageDropped({ type, from, to, payload })
      }
      return null
    }

    const msg = Message.create(type, from, to, payload)
    const delay = this.getDelay()
    msg.deliverAt = Date.now() + delay
    msg.totalDelay = delay
    
    this.messages.push(msg)
    
    if (this.onMessageCreated) {
      this.onMessageCreated(msg)
    }

    return msg
  }

  // Broadcast message to all peers of a node
  broadcast(fromId, type, payload) {
    const fromNode = this.nodes.get(fromId)
    if (!fromNode) return []

    const messages = []
    for (const peerId of fromNode.peers) {
      const msg = this.send(fromId, peerId, type, payload)
      if (msg) messages.push(msg)
    }

    return messages
  }

  // Broadcast to all nodes (not just peers)
  broadcastToAll(fromId, type, payload) {
    const messages = []
    for (const [nodeId] of this.nodes) {
      if (nodeId !== fromId) {
        const msg = this.send(fromId, nodeId, type, payload)
        if (msg) messages.push(msg)
      }
    }
    return messages
  }

  // Process messages due for delivery
  tick(now) {
    const delivered = []
    const remaining = []
    
    for (const msg of this.messages) {
      // Update progress for visualization
      const elapsed = now - msg.createdAt
      msg.progress = Math.min(1, elapsed / msg.totalDelay)
      
      if (now >= msg.deliverAt) {
        // Deliver message
        const node = this.nodes.get(msg.to)
        if (node && node.consensus) {
          node.consensus.onMessage(node, msg, this)
        }

        if (this.onMessageDelivered) {
          this.onMessageDelivered(msg)
        }

        delivered.push(msg)
      } else {
        remaining.push(msg)
      }
    }

    this.messages = remaining
    return delivered
  }

  // Get all messages currently in flight
  getInFlightMessages() {
    return [...this.messages]
  }

  // Clear all messages
  clearMessages() {
    this.messages = []
  }

  // Get messages for visualization (with progress)
  getMessagesForVisualization() {
    return this.messages.map(msg => ({
      id: msg.id,
      type: msg.type,
      from: msg.from,
      to: msg.to,
      progress: msg.progress,
      payload: msg.payload
    }))
  }
}
