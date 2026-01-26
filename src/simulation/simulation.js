import { Node, Wallet, Transaction } from '../core/index.js'
import { Network } from '../network/index.js'
import { PoWConsensus } from '../consensus/pow.js'
import { PoSConsensus } from '../consensus/pos.js'
import { RaftConsensus } from '../consensus/raft.js'
import { PBFTConsensus } from '../consensus/pbft.js'

export class Simulation {
  constructor() {
    this.network = new Network()
    this.nodes = new Map()
    this.wallets = new Map()

    // Handle wallet transaction delivery from network
    this.network.onWalletTxDelivery = (tx, nodeId) => {
      const node = this.nodes.get(nodeId)
      if (node && this.consensus) {
        this.consensus.onTx(node, tx, this.network)
      }
    }

    // Consensus engine (shared across all nodes)
    this.consensus = null
    this.consensusType = 'pow'

    // Simulation state
    this.running = false
    this.tickTimer = null
    this.startTime = 0

    // Speed control - base values at 1x speed
    this.speedMultiplier = 1.0
    this.baseTickInterval = 500   // ms between ticks at 1x
    this.baseNetworkMinDelay = 1000  // min network delay at 1x
    this.baseNetworkMaxDelay = 2000  // max network delay at 1x

    // Counters for ID generation
    this.nodeCounter = 0
    this.walletCounter = 0

    // Event callbacks
    this.onTick = null
    this.onNodeAdded = null
    this.onWalletAdded = null
    this.onConnectionAdded = null
    this.onMessageCreated = null
    this.onMessageDelivered = null
    this.onBlockMined = null  // Called when a node mines/proposes a block
  }

  // Initialize with a consensus type
  setConsensusType(type) {
    this.consensusType = type
    
    switch (type) {
      case 'pow':
        this.consensus = new PoWConsensus()
        break
        case 'pos':
        this.consensus = new PoSConsensus()
        break
        case 'raft':
        this.consensus = new RaftConsensus()
        break
        case 'pbft':
        this.consensus = new PBFTConsensus()
        break
        default:
        throw new Error(`Unknown consensus type: ${type}`)
      }

    // Clear in-flight messages from old consensus
    this.network.clearMessages()

    // Re-initialize all nodes with new consensus
    for (const [_, node] of this.nodes) {
      this.consensus.init(node, this.network, {})
    }
  }

  // Add a new node
  addNode(x = 300, y = 300) {
    const id = `${++this.nodeCounter}`
    const node = new Node(id)
    node.x = x
    node.y = y
    
    this.nodes.set(id, node)
    this.network.registerNode(node)

    // Listen for transaction state changes to update wallet pendingTxs
    node.onTxStateChanged = (txId, newState) => {
      if (newState === 'FINALIZED' || newState === 'IN_BLOCK') {
        // Find the wallet that sent this transaction and clear it from pendingTxs
        for (const [, wallet] of this.wallets) {
          if (wallet.pendingTxs.has(txId)) {
            wallet.confirmTransaction(txId)
          }
        }
      }
    }

    // Initialize consensus
    if (this.consensus) {
      this.consensus.init(node, this.network, {})
    }

    if (this.onNodeAdded) {
      this.onNodeAdded(node)
    }

    return node
  }

  // Remove a node
  removeNode(nodeId) {
    const node = this.nodes.get(nodeId)
    if (!node) return
    
    // Remove peer connections
    for (const peerId of node.peers) {
      const peer = this.nodes.get(peerId)
      if (peer) {
        peer.removePeer(nodeId)
      }
    }

    // Disconnect wallets
    for (const [_, wallet] of this.wallets) {
      if (wallet.connectedNodeId === nodeId) {
        wallet.disconnect()
      }
    }

    this.nodes.delete(nodeId)
    this.network.unregisterNode(nodeId)
  }

  // Add a new wallet
  addWallet(x = 100, y = 100, initialBalance = 1000) {
    const id = ++this.walletCounter
    const wallet = new Wallet(id, initialBalance)
    wallet.x = x
    wallet.y = y
    
    this.wallets.set(id, wallet)
    
    // Initialize balance in all nodes' ledgers
    for (const [_, node] of this.nodes) {
      node.ledger.setBalance(wallet.address, initialBalance)
    }

    if (this.onWalletAdded) {
      this.onWalletAdded(wallet)
    }

    return wallet
  }

  // Remove a wallet
  removeWallet(walletId) {
    this.wallets.delete(walletId)
  }

  // Connect two nodes
  connectNodes(nodeId1, nodeId2) {
    const node1 = this.nodes.get(nodeId1)
    const node2 = this.nodes.get(nodeId2)
    
    if (!node1 || !node2) return false
    
    node1.addPeer(nodeId2)
    node2.addPeer(nodeId1)
    
    if (this.onConnectionAdded) {
      this.onConnectionAdded(nodeId1, nodeId2)
    }

    return true
  }

  // Disconnect two nodes
  disconnectNodes(nodeId1, nodeId2) {
    const node1 = this.nodes.get(nodeId1)
    const node2 = this.nodes.get(nodeId2)

    if (node1) node1.removePeer(nodeId2)
    if (node2) node2.removePeer(nodeId1)
  }

  // Connect wallet to node
  connectWalletToNode(walletId, nodeId) {
    const wallet = this.wallets.get(walletId)
    const node = this.nodes.get(nodeId)
    
    if (!wallet || !node) return false
    
    wallet.connect(nodeId)
    
    // Ensure node's ledger has wallet's balance
    const currentBalance = node.ledger.getBalance(wallet.address)
    if (currentBalance === 0) {
      node.ledger.setBalance(wallet.address, wallet.initialBalance)
    }

    return true
  }

  // Send a transaction from a wallet
  sendTransaction(walletId, toAddress, amount) {
    const wallet = this.wallets.get(walletId)
    if (!wallet) return null

    const node = this.nodes.get(wallet.connectedNodeId)
    if (!node) return null

    // Create transaction
    const tx = wallet.createTransaction(toAddress, amount)

    // Queue for delivery via network (respects network delay)
    this.network.sendWalletTx(walletId, wallet.connectedNodeId, tx)

    return tx
  }

  // Start simulation
  start() {
    if (this.running) return

    this.running = true
    this.startTime = Date.now()

    const interval = this.getTickInterval()
    this.tickTimer = setInterval(() => {
      this.tick()
    }, interval)
  }

  // Get current tick interval based on speed
  getTickInterval() {
    return Math.round(this.baseTickInterval / this.speedMultiplier)
  }

  // Pause simulation
  pause() {
    this.running = false
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  // Toggle simulation
  toggle() {
    if (this.running) {
      this.pause()
    } else {
      this.start()
    }
    return this.running
  }

  // Perform one simulation tick
  tick() {
    const now = Date.now()

    // Deliver messages
    this.network.tick(now)

    // Tick each node's consensus
    if (this.consensus) {
      for (const [_, node] of this.nodes) {
        // Track head before tick to detect new blocks
        const headBefore = node.headId

        this.consensus.onTick(node, now, this.network)

        // Check if this node mined/proposed a new block
        if (node.headId !== headBefore && this.onBlockMined) {
          const block = node.getHead()
          if (block && block.producerId === node.id) {
            this.onBlockMined(node, block)
          }
        }
      }
    }

    if (this.onTick) {
      this.onTick(now)
    }
  }

  // Reset simulation
  reset() {
    this.pause()
    
    // Clear nodes and wallets
    this.nodes.clear()
    this.wallets.clear()
    this.network.clearMessages()
    
    // Reset counters
    this.nodeCounter = 0
    this.walletCounter = 0
    
    // Re-create network
    this.network = new Network()
    
    // Re-initialize consensus
    if (this.consensusType) {
      this.setConsensusType(this.consensusType)
    }
  }

  // Get simulation state for rendering
  getState() {
    return {
      running: this.running,
      consensusType: this.consensusType,
      nodes: Array.from(this.nodes.values()).map(n => ({
        ...n.toJSON(),
        peers: Array.from(n.peers),
        mempoolSize: n.mempool.size,
        headHeight: n.getHeight(n.headId),
        finalizedHeight: n.getHeight(n.finalizedId),
        role: this.consensus ? this.consensus.getRoleWithNetwork?.(n, this.network) || this.consensus.getRole(n) : 'Node',
        consensusState: this.consensus ? this.consensus.getUIState(n) : {}
      })),
      wallets: Array.from(this.wallets.values()).map(w => w.toJSON()),
      messages: this.network.getMessagesForVisualization(),
      networkSettings: {
        minDelay: this.network.minDelay,
        maxDelay: this.network.maxDelay,
        packetLoss: this.network.packetLoss
      }
    }
  }

  // Get node connections for rendering
  getConnections() {
    const connections = []
    const seen = new Set()
    
    for (const [nodeId, node] of this.nodes) {
      for (const peerId of node.peers) {
        const key = [nodeId, peerId].sort().join('-')
        if (!seen.has(key)) {
          seen.add(key)
          connections.push({ from: nodeId, to: peerId })
        }
      }
    }

    return connections
  }

  // Get wallet-to-node connections
  getWalletConnections() {
    const connections = []
    
    for (const [walletId, wallet] of this.wallets) {
      if (wallet.connectedNodeId) {
        connections.push({
          wallet: walletId,
          node: wallet.connectedNodeId
        })
      }
    }

    return connections
  }

  // Set network delay
  setNetworkDelay(min, max) {
    this.network.minDelay = min
    this.network.maxDelay = max
  }

  // Set speed multiplier (affects tick interval and network delays)
  setSpeedMultiplier(multiplier) {
    this.speedMultiplier = Math.max(0.1, Math.min(5, multiplier))

    // Update network delays
    this.network.minDelay = Math.round(this.baseNetworkMinDelay / this.speedMultiplier)
    this.network.maxDelay = Math.round(this.baseNetworkMaxDelay / this.speedMultiplier)

    // Restart timer if running
    if (this.running) {
      clearInterval(this.tickTimer)
      const interval = this.getTickInterval()
      this.tickTimer = setInterval(() => {
        this.tick()
      }, interval)
    }
  }

  // Set packet loss
  setPacketLoss(rate) {
    this.network.packetLoss = rate
  }

  // Get all wallet addresses
  getAddresses() {
    const addresses = []
    for (const [_, wallet] of this.wallets) {
      addresses.push({
        id: wallet.id,
        name: wallet.name,
        address: wallet.address
      })
    }
    return addresses
  }
}
