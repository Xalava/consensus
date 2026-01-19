/**
 * DLT Consensus Sandbox - Main Application Entry Point
 */

import { Simulation } from './simulation/simulation.js'
import { CanvasRenderer } from './ui/canvas.js'
import { Inspector } from './ui/inspector.js'

class App {
  constructor() {
    this.simulation = new Simulation()
    this.canvas = null
    this.renderer = null
    this.inspector = null
    this.animationFrame = null
    
    // UI element references
    this.elements = {}
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init())
    } else {
      this.init()
    }
  }

  init() {
    console.log('🚀 Protocol Box initializing...')
    
    // Get DOM elements
    this.elements = {
      canvas: document.getElementById('simulation-canvas'),
      inspector: document.getElementById('inspector-panel'),
      quickstart: document.getElementById('quickstart'),
      playPauseBtn: document.getElementById('play-pause-btn'),
      resetBtn: document.getElementById('reset-btn'),
      addNodeBtn: document.getElementById('add-node-btn'),
      addWalletBtn: document.getElementById('add-wallet-btn'),
      connectModeBtn: document.getElementById('connect-mode-btn'),
      dismissQuickstartBtn: document.getElementById('dismiss-quickstart-btn'),
      consensusSelect: document.getElementById('consensus-select'),
      speedSlider: document.getElementById('speed-slider'),
      speedValue: document.getElementById('speed-value'),
      statusIndicator: document.getElementById('status-indicator'),
      consensusInfo: document.getElementById('consensus-info')
    }
    
    // Setup canvas
    this.setupCanvas()
    
    // Setup inspector
    this.setupInspector()
    
    // Setup controls
    this.setupControls()
    
    // Initialize with default consensus
    this.simulation.setConsensusType('pow')
    
    // Create initial network
    this.createInitialNetwork()

    // Start render loop
    this.startRenderLoop()

    // Auto-start simulation
    this.simulation.start()
    this.updatePlayPauseButton(true)

    console.log('✅ Protocol Box ready!')
  }

  setupCanvas() {
    this.canvas = this.elements.canvas

    // Set initial size
    this.resizeCanvas()

    // Create renderer
    this.renderer = new CanvasRenderer(this.canvas, this.simulation)

    // Handle selection
    this.renderer.onSelect = (selection) => {
      this.inspector.setSelected(selection)
    }

    // Handle connection completed - exit connect mode
    this.renderer.onConnectionMade = () => {
      const btn = this.elements.connectModeBtn
      if (btn && btn.classList.contains('active')) {
        btn.classList.remove('active')
        this.renderer.setMode('select')
      }
    }

    // Handle window resize
    window.addEventListener('resize', () => this.resizeCanvas())

    // Track mouse for connection drawing
    this.canvas.addEventListener('mousemove', (e) => this.renderer.trackMouse(e))
  }

  resizeCanvas() {
    const container = this.canvas.parentElement
    const width = container.clientWidth
    const height = container.clientHeight
    
    this.canvas.width = width
    this.canvas.height = height
    
    if (this.renderer) {
      this.renderer.resize(width, height)
    }
  }

  setupInspector() {
    this.inspector = new Inspector(this.elements.inspector, this.simulation)

    this.inspector.onSendTransaction = (tx, walletId, nodeId) => {
      // Visualize the transaction leaving the wallet
      if (walletId && nodeId) {
        this.renderer.addWalletMessage(walletId, nodeId)
      }
      this.showNotification(`Transaction ${tx.id.slice(0, 8)}... sent!`)
    }

    this.inspector.onDeleteNode = (nodeId) => {
      const node = this.simulation.nodes.get(nodeId)
      if (node) {
        this.simulation.removeNode(nodeId)
        this.inspector.setSelected(null)
        this.showNotification(`Removed ${node.name}`)
      }
    }

    this.inspector.onDeleteWallet = (walletId) => {
      const wallet = this.simulation.wallets.get(walletId)
      if (wallet) {
        this.simulation.removeWallet(walletId)
        this.inspector.setSelected(null)
        this.showNotification(`Removed ${wallet.name}`)
      }
    }

    this.inspector.onDisconnectPeer = (nodeId, peerId) => {
      this.simulation.disconnectNodes(nodeId, peerId)
      this.inspector.render()
      this.showNotification(`Disconnected ${nodeId} from ${peerId}`)
    }

    this.inspector.onDisconnectWallet = (walletId) => {
      const wallet = this.simulation.wallets.get(walletId)
      if (wallet) {
        wallet.disconnect()
        this.inspector.render()
        this.showNotification(`Disconnected ${wallet.name}`)
      }
    }
  }

  setupControls() {
    // Play/Pause button
    this.elements.playPauseBtn?.addEventListener('click', () => {
      const running = this.simulation.toggle()
      this.updatePlayPauseButton(running)
    })
    
    // Reset button
    this.elements.resetBtn?.addEventListener('click', () => {
      this.simulation.reset()
      this.createInitialNetwork()
      this.inspector.setSelected(null)
      this.updatePlayPauseButton(false)
    })
    
    // Add Node button
    this.elements.addNodeBtn?.addEventListener('click', () => {
      const x = 100 + Math.random() * (this.canvas.width - 200)
      const y = 100 + Math.random() * (this.canvas.height - 200)
      const node = this.simulation.addNode(x, y)
      this.showNotification(`Added ${node.name}`)
    })
    
    // Add Wallet button
    this.elements.addWalletBtn?.addEventListener('click', () => {
      const x = 50 + Math.random() * 150
      const y = 100 + Math.random() * (this.canvas.height - 200)
      const wallet = this.simulation.addWallet(x, y)
      this.showNotification(`Added ${wallet.name}`)
    })
    
    // Connect Mode button
    this.elements.connectModeBtn?.addEventListener('click', () => {
      const btn = this.elements.connectModeBtn
      const isActive = btn.classList.toggle('active')
      this.renderer.setMode(isActive ? 'connect' : 'select')
    })
    
    // Consensus select
    this.elements.consensusSelect?.addEventListener('change', (e) => {
      const type = e.target.value
      this.changeConsensus(type)
    })

    // Speed slider (controls tick interval)
    this.elements.speedSlider?.addEventListener('input', (e) => {
      const value = parseInt(e.target.value)
      this.simulation.setTickInterval(value)
      // Display as speed multiplier (100ms = 1x, 50ms = 2x, 200ms = 0.5x)
      const speedMultiplier = (100 / value).toFixed(1)
      if (this.elements.speedValue) {
        this.elements.speedValue.textContent = `${speedMultiplier}x`
      }
    })
    
    // Dismiss quickstart button
    this.elements.dismissQuickstartBtn?.addEventListener('click', () => {
      const quickstartEl = this.elements.quickstart || document.getElementById('quickstart')
      if (quickstartEl) {
        quickstartEl.remove()
        this.showNotification('Quickstart dismissed')
      }
    })
  }

  changeConsensus(type) {
    // Pause simulation during change
    const wasRunning = this.simulation.running
    if (wasRunning) {
      this.simulation.pause()
    }

    // Set new consensus
    this.simulation.setConsensusType(type)
    
    // Update UI
    this.updateConsensusInfo(type)
    
    // Resume if was running
    if (wasRunning) {
      this.simulation.start()
    }

    this.showNotification(`Switched to ${type.toUpperCase()} consensus`)
  }

  updateConsensusInfo(type) {
    const info = this.elements.consensusInfo
    if (!info) return
    
    const descriptions = {
      pow: 'Mining race → Longest chain → Confirmation finality',
      pos: 'Leader selection → Voting → Quorum finality',
      raft: 'Leader election → Log replication → Majority commit',
      pbft: 'Primary proposes → Prepare/Commit → 2f+1 quorum'
    }
    
    info.textContent = descriptions[type] || ''
  }

  updatePlayPauseButton(running) {
    const btn = this.elements.playPauseBtn
    if (!btn) return
    
    btn.textContent = running ? '⏸ Pause' : '▶ Play'
    btn.classList.toggle('running', running)
    
    if (this.elements.statusIndicator) {
      this.elements.statusIndicator.className = `status-indicator ${running ? 'running' : 'paused'}`
      this.elements.statusIndicator.textContent = running ? 'Running' : 'Paused'
    }
  }

  createInitialNetwork() {
    // Create some initial nodes in a nice arrangement
    const centerX = this.canvas.width / 2
    const centerY = this.canvas.height / 2
    const radius = 180
    
    // Create 4 nodes
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI * 2) / 4 - Math.PI / 1.5
      const x = centerX + Math.cos(angle) * radius
      const y = centerY + Math.sin(angle) * radius
      this.simulation.addNode(x, y)
    }

    // Connect nodes in a ring with cross connections
    const nodeIds = Array.from(this.simulation.nodes.keys())
    for (let i = 0; i < nodeIds.length; i++) {
      // Connect to next node (ring)
      this.simulation.connectNodes(nodeIds[i], nodeIds[(i + 1) % nodeIds.length])
      // Connect across (full mesh)
      if (nodeIds.length >= 4) {
        this.simulation.connectNodes(nodeIds[i], nodeIds[(i + 2) % nodeIds.length])
      }
    }

    // Create 2 wallets
    const wallet1 = this.simulation.addWallet(centerX / 2, centerY / 3, 1000)
    const wallet2 = this.simulation.addWallet(this.canvas.width - centerX / 2, centerY / 2, 500)
    
    // Connect wallets to nodes
    this.simulation.connectWalletToNode(wallet1.id, nodeIds[0])
    this.simulation.connectWalletToNode(wallet2.id, nodeIds[1])
    
    // Initialize ledger with wallet balances
    for (const [_, node] of this.simulation.nodes) {
      node.ledger.setBalance(wallet1.address, wallet1.initialBalance)
      node.ledger.setBalance(wallet2.address, wallet2.initialBalance)
    }

    // Set initial network delay (default: 1000ms with 1500ms max)
    this.simulation.setNetworkDelay(1000, 1500)

    // Update consensus info
    this.updateConsensusInfo(this.simulation.consensusType)
  }

  startRenderLoop() {
    const render = () => {
      this.renderer.render()
      this.animationFrame = requestAnimationFrame(render)
    }
    render()
  }

  showNotification(message) {
    // Create notification element
    const notification = document.createElement('div')
    notification.className = 'notification'
    notification.textContent = message
    
    // Add to container
    let container = document.querySelector('.notification-container')
    if (!container) {
      container = document.createElement('div')
      container.className = 'notification-container'
      document.body.appendChild(container)
    }

    container.appendChild(notification)
    
    // Animate in
    setTimeout(() => notification.classList.add('show'), 10)
    
    // Remove after delay
    setTimeout(() => {
      notification.classList.remove('show')
      setTimeout(() => notification.remove(), 300)
    }, 2000)
  }
}

// Create and export app instance
const app = new App()
export { app }
