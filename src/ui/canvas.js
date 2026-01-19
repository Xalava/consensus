/**
 * Canvas-based visualization for the consensus simulation
 */

export class CanvasRenderer {
  constructor(canvas, simulation) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.simulation = simulation
    
    // Rendering state
    this.width = canvas.width
    this.height = canvas.height
    
    // Interaction state
    this.dragging = null
    this.dragOffset = { x: 0, y: 0 }
    this.connecting = null
    this.hovering = null
    this.selected = null
    
    // Mode
    this.mode = 'select'
    
    // Visual settings
    this.nodeRadius = 40
    this.walletSize = { w: 70, h: 45 }
    
    // Color palette - more vibrant and modern
    this.colors = {
      node: {
        fill: '#3B82F6',
        stroke: '#1D4ED8',
        text: '#FFFFFF',
        selected: '#FBBF24',
        glow: 'rgba(59, 130, 246, 0.4)'
      },
      wallet: {
        fill: '#10B981',
        stroke: '#059669',
        text: '#FFFFFF',
        selected: '#FBBF24',
        glow: 'rgba(16, 185, 129, 0.4)'
      },
      connection: {
        peer: 'rgba(148, 163, 184, 0.6)',
        rpc: 'rgba(148, 163, 184, 0.4)'
      },
      message: {
        TX_GOSSIP: '#10B981',
        BLOCK_PROPOSE: '#3B82F6',
        BLOCK_VOTE: '#8B5CF6',
        RAFT_REQUEST_VOTE: '#EF4444',
        RAFT_VOTE: '#F97316',
        RAFT_APPEND_ENTRIES: '#06B6D4',
        RAFT_APPEND_ACK: '#14B8A6',
        RAFT_HEARTBEAT: '#FBBF24',
        PBFT_PRE_PREPARE: '#EF4444',
        PBFT_PREPARE: '#F97316',
        PBFT_COMMIT: '#22C55E',
        default: '#6B7280'
      },
      role: {
        Leader: '#FBBF24',
        Miner: '#EF4444',
        Validator: '#8B5CF6',
        Primary: '#EF4444',
        Replica: '#3B82F6',
        Follower: '#6B7280',
        Candidate: '#F97316',
        Observer: '#9CA3AF',
        Node: '#6B7280'
      },
      background: '#0F172A',
      grid: 'rgba(51, 65, 85, 0.3)'
    }
    
    // Legend configuration per consensus type
    this.legendConfig = {
      pow: [
        { color: '#10B981', label: 'Transaction', shape: 'circle' },
        { color: '#3B82F6', label: 'Block', shape: 'square' }
      ],
      pos: [
        { color: '#10B981', label: 'Transaction', shape: 'circle' },
        { color: '#3B82F6', label: 'Block', shape: 'square' },
        { color: '#8B5CF6', label: 'Vote', shape: 'circle' }
      ],
      raft: [
        { color: '#10B981', label: 'Transaction', shape: 'circle' },
        { color: '#EF4444', label: 'Vote Request', shape: 'circle' },
        { color: '#F97316', label: 'Vote', shape: 'circle' },
        { color: '#06B6D4', label: 'Append', shape: 'square' },
        { color: '#FBBF24', label: 'Heartbeat', shape: 'circle' }
      ],
      pbft: [
        { color: '#10B981', label: 'Transaction', shape: 'circle' },
        { color: '#EF4444', label: 'Pre-Prepare', shape: 'square' },
        { color: '#F97316', label: 'Prepare', shape: 'circle' },
        { color: '#22C55E', label: 'Commit', shape: 'circle' }
      ]
    }
    
    // Animation time (updated each frame)
    this.time = 0

    // Wallet transaction messages (for visualization)
    this.walletMessages = []

    // Setup event listeners
    this.setupEvents()

    // Selection callback
    this.onSelect = null

    // Connection made callback
    this.onConnectionMade = null
  }

  resize(width, height) {
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
  }

  // Add a wallet transaction message for visualization
  addWalletMessage(walletId, nodeId) {
    const wallet = this.simulation.wallets.get(walletId)
    const node = this.simulation.nodes.get(nodeId)
    if (!wallet || !node) return

    this.walletMessages.push({
      walletId,
      nodeId,
      createdAt: Date.now(),
      duration: 1500, // Wallet to node animation duration
      progress: 0
    })
  }

  // Update wallet messages progress
  updateWalletMessages() {
    const now = Date.now()
    this.walletMessages = this.walletMessages.filter(msg => {
      const elapsed = now - msg.createdAt
      msg.progress = Math.min(1, elapsed / msg.duration)
      return msg.progress < 1
    })
  }

  setupEvents() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e))
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e))
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e))
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e))
  }

  getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }

  findEntityAt(pos) {
    const state = this.simulation.getState()
    
    // Check nodes
    for (const node of state.nodes) {
      const dist = Math.hypot(pos.x - node.x, pos.y - node.y)
      if (dist <= this.nodeRadius) {
        return { type: 'node', id: node.id, entity: node }
      }
    }

    // Check wallets
    for (const wallet of state.wallets) {
      const halfW = this.walletSize.w / 2
      const halfH = this.walletSize.h / 2
      if (pos.x >= wallet.x - halfW && pos.x <= wallet.x + halfW &&
          pos.y >= wallet.y - halfH && pos.y <= wallet.y + halfH) {
        return { type: 'wallet', id: wallet.id, entity: wallet }
      }
    }

    return null
  }

  onMouseDown(e) {
    const pos = this.getMousePos(e)
    const entity = this.findEntityAt(pos)
    
    if (this.mode === 'connect' && entity) {
      this.connecting = { from: entity.id, type: entity.type, startPos: pos }
      return
    }

    if (entity) {
      this.dragging = entity
      this.dragOffset = {
        x: pos.x - entity.entity.x,
        y: pos.y - entity.entity.y
      }
      this.selected = entity
      
      if (this.onSelect) {
        this.onSelect(entity)
      }
    } else {
      this.selected = null
      if (this.onSelect) {
        this.onSelect(null)
      }
    }
  }

  onMouseMove(e) {
    const pos = this.getMousePos(e)
    
    if (this.dragging) {
      const newX = pos.x - this.dragOffset.x
      const newY = pos.y - this.dragOffset.y
      
      if (this.dragging.type === 'node') {
        const node = this.simulation.nodes.get(this.dragging.id)
        if (node) {
          node.x = newX
          node.y = newY
        }
      } else if (this.dragging.type === 'wallet') {
        const wallet = this.simulation.wallets.get(this.dragging.id)
        if (wallet) {
          wallet.x = newX
          wallet.y = newY
        }
      }
    }

    this.hovering = this.findEntityAt(pos)
  }

  onMouseUp(e) {
    const pos = this.getMousePos(e)

    if (this.connecting) {
      const target = this.findEntityAt(pos)
      let connectionMade = false

      if (target && target.id !== this.connecting.from) {
        if (this.connecting.type === 'node' && target.type === 'node') {
          this.simulation.connectNodes(this.connecting.from, target.id)
          connectionMade = true
        } else if (this.connecting.type === 'wallet' && target.type === 'node') {
          this.simulation.connectWalletToNode(this.connecting.from, target.id)
          connectionMade = true
        } else if (this.connecting.type === 'node' && target.type === 'wallet') {
          this.simulation.connectWalletToNode(target.id, this.connecting.from)
          connectionMade = true
        }
      }

      this.connecting = null

      if (connectionMade && this.onConnectionMade) {
        this.onConnectionMade()
      }
    }

    this.dragging = null
  }

  onDoubleClick(e) {
    const pos = this.getMousePos(e)
    const entity = this.findEntityAt(pos)
    
    if (!entity) {
      this.simulation.addNode(pos.x, pos.y)
    }
  }

  setMode(mode) {
    this.mode = mode
    this.canvas.style.cursor = mode === 'connect' ? 'crosshair' : 'default'
  }

  render() {
    const ctx = this.ctx
    const state = this.simulation.getState()
    this.time = performance.now()

    // Update wallet messages
    this.updateWalletMessages()

    // Clear canvas with gradient background
    const bgGradient = ctx.createLinearGradient(0, 0, 0, this.height)
    bgGradient.addColorStop(0, '#0F172A')
    bgGradient.addColorStop(1, '#1E293B')
    ctx.fillStyle = bgGradient
    ctx.fillRect(0, 0, this.width, this.height)

    // Draw subtle grid
    this.drawGrid()

    // Draw connections with glow
    this.drawConnections(state)
    this.drawWalletConnections(state)

    // Draw wallet transaction messages
    this.drawWalletMessages(state)

    // Draw messages in flight
    this.drawMessages(state)
    
    // Draw nodes
    for (const node of state.nodes) {
      this.drawNode(node)
    }

    // Draw wallets
    for (const wallet of state.wallets) {
      this.drawWallet(wallet)
    }

    // Draw connection line if connecting
    if (this.connecting) {
      const from = this.findEntityById(this.connecting.from, this.connecting.type, state)
      if (from) {
        ctx.strokeStyle = '#FBBF24'
        ctx.lineWidth = 2
        ctx.setLineDash([8, 4])
        ctx.beginPath()
        ctx.moveTo(from.x, from.y)
        const mousePos = this.canvas._mousePos || this.connecting.startPos
        ctx.lineTo(mousePos.x, mousePos.y)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // Draw legend
    this.drawLegend(state.consensusType)
  }

  drawGrid() {
    const ctx = this.ctx
    ctx.strokeStyle = this.colors.grid
    ctx.lineWidth = 1
    
    const gridSize = 40
    
    for (let x = 0; x < this.width; x += gridSize) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, this.height)
      ctx.stroke()
    }

    for (let y = 0; y < this.height; y += gridSize) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(this.width, y)
      ctx.stroke()
    }
  }

  drawConnections(state) {
    const ctx = this.ctx
    const connections = this.simulation.getConnections()
    
    for (const conn of connections) {
      const node1 = state.nodes.find(n => n.id === conn.from)
      const node2 = state.nodes.find(n => n.id === conn.to)
      
      if (node1 && node2) {
        // Draw glow
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(node1.x, node1.y)
        ctx.lineTo(node2.x, node2.y)
        ctx.stroke()
        
        // Draw line
        ctx.strokeStyle = this.colors.connection.peer
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(node1.x, node1.y)
        ctx.lineTo(node2.x, node2.y)
        ctx.stroke()
      }
    }
  }

  drawWalletConnections(state) {
    const ctx = this.ctx
    const connections = this.simulation.getWalletConnections()
    
    ctx.setLineDash([6, 4])
    
    for (const conn of connections) {
      const wallet = state.wallets.find(w => w.id === conn.wallet)
      const node = state.nodes.find(n => n.id === conn.node)
      
      if (wallet && node) {
        ctx.strokeStyle = this.colors.connection.rpc
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(wallet.x, wallet.y)
        ctx.lineTo(node.x, node.y)
        ctx.stroke()
      }
    }

    ctx.setLineDash([])
  }

  drawMessages(state) {
    const ctx = this.ctx
    
    for (const msg of state.messages) {
      const from = state.nodes.find(n => n.id === msg.from)
      const to = state.nodes.find(n => n.id === msg.to)
      
      if (!from || !to) continue
      
      const x = from.x + (to.x - from.x) * msg.progress
      const y = from.y + (to.y - from.y) * msg.progress
      
      const color = this.colors.message[msg.type] || this.colors.message.default
      const size = this.getMessageSize(msg.type)
      
      // Draw trail
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.4
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.globalAlpha = 1
      
      // Draw glow
      ctx.beginPath()
      ctx.arc(x, y, size + 4, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.3
      ctx.fill()
      ctx.globalAlpha = 1
      
      // Draw message packet
      ctx.fillStyle = color
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      
      ctx.beginPath()
      if (msg.type.includes('BLOCK') || msg.type.includes('APPEND') || msg.type.includes('PRE_PREPARE')) {
        // Rounded square for blocks/entries
        const s = size
        ctx.roundRect(x - s/2, y - s/2, s, s, 3)
      } else {
        // Circle for other messages
        ctx.arc(x, y, size/2, 0, Math.PI * 2)
      }
      ctx.fill()
      ctx.stroke()
    }
  }

  getMessageSize(type) {
    if (type.includes('BLOCK') || type.includes('PRE_PREPARE')) return 16
    if (type === 'TX_GOSSIP' || type === 'WALLET_TX') return 10
    if (type.includes('HEARTBEAT')) return 8
    if (type.includes('APPEND')) return 14
    return 12
  }

  drawWalletMessages(state) {
    const ctx = this.ctx

    for (const msg of this.walletMessages) {
      const wallet = state.wallets.find(w => w.id === msg.walletId)
      const node = state.nodes.find(n => n.id === msg.nodeId)

      if (!wallet || !node) continue

      const x = wallet.x + (node.x - wallet.x) * msg.progress
      const y = wallet.y + (node.y - wallet.y) * msg.progress

      const color = this.colors.message.TX_GOSSIP
      const size = 10

      // Draw trail
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.4
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(wallet.x, wallet.y)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.globalAlpha = 1

      // Draw glow
      ctx.beginPath()
      ctx.arc(x, y, size + 4, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.3
      ctx.fill()
      ctx.globalAlpha = 1

      // Draw message packet (circle for transactions)
      ctx.fillStyle = color
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, size / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  drawNode(node) {
    const ctx = this.ctx
    const isSelected = this.selected?.id === node.id
    const isHovered = this.hovering?.id === node.id
    const roleColor = this.colors.role[node.role] || this.colors.role.Node
    const cs = node.consensusState || {}

    const isMiningActive = cs.isMiningActive
    const blockJustMined = cs.blockJustMined
    const hashPower = cs.hashPower || 10
    const lastBlockTime = cs.lastBlockTime || 0

    // === BLOCK MINED BURST ===
    if (blockJustMined && lastBlockTime > 0) {
      const elapsed = Date.now() - lastBlockTime
      const progress = Math.min(1, elapsed / 800)
      const ease = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      const alpha = 0.6 * (1 - progress)

      ctx.beginPath()
      ctx.arc(node.x, node.y, this.nodeRadius + 10 + ease * 40, 0, Math.PI * 2)
      ctx.strokeStyle = '#FBBF24'
      ctx.lineWidth = 3 * (1 - progress) + 1
      ctx.globalAlpha = alpha
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // === MINING SPINNER ===
    if (isMiningActive && !blockJustMined) {
      const ringRadius = this.nodeRadius + 8

      // Background track
      ctx.beginPath()
      ctx.arc(node.x, node.y, ringRadius, 0, Math.PI * 2)
      ctx.strokeStyle = '#F97316'
      ctx.lineWidth = 3
      ctx.globalAlpha = 0.15
      ctx.stroke()
      ctx.globalAlpha = 1

      // Spinning dot - speed based on hashPower (one rotation every 4-8 seconds)
      const rotationPeriod = 8000 - (hashPower / 24) * 4000 // 4000-8000ms
      const angle = ((this.time % rotationPeriod) / rotationPeriod) * Math.PI * 2 - Math.PI / 2
      const dotX = node.x + Math.cos(angle) * ringRadius
      const dotY = node.y + Math.sin(angle) * ringRadius

      // Trail
      ctx.beginPath()
      ctx.arc(node.x, node.y, ringRadius, angle - Math.PI * 0.3, angle)
      ctx.strokeStyle = '#F97316'
      ctx.lineWidth = 3
      ctx.globalAlpha = 0.4
      ctx.stroke()
      ctx.globalAlpha = 1

      // Dot
      ctx.beginPath()
      ctx.arc(dotX, dotY, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#FCD34D'
      ctx.fill()
    }

    // === ROLE GLOW ===
    const breathe = 1 + Math.sin(this.time / 2000) * 0.02
    ctx.beginPath()
    ctx.arc(node.x, node.y, (this.nodeRadius + 5) * breathe, 0, Math.PI * 2)
    ctx.fillStyle = roleColor
    ctx.globalAlpha = 0.1
    ctx.fill()
    ctx.globalAlpha = 1

    // === MAIN CIRCLE ===
    ctx.beginPath()
    ctx.arc(node.x, node.y, this.nodeRadius, 0, Math.PI * 2)
    const gradient = ctx.createRadialGradient(node.x - 10, node.y - 10, 0, node.x, node.y, this.nodeRadius)
    gradient.addColorStop(0, '#60A5FA')
    gradient.addColorStop(1, this.colors.node.fill)
    ctx.fillStyle = gradient
    ctx.fill()

    // Border
    ctx.strokeStyle = blockJustMined ? '#FBBF24' : isMiningActive ? '#F97316' : isSelected ? this.colors.node.selected : isHovered ? '#60A5FA' : this.colors.node.stroke
    ctx.lineWidth = isSelected ? 4 : (blockJustMined || isMiningActive) ? 3 : 2
    ctx.stroke()

    // === LABEL ===
    ctx.fillStyle = this.colors.node.text
    ctx.font = 'bold 24px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(node.id.replace('n-', ''), node.x, node.y - 5)

    ctx.font = '10px Inter, system-ui, sans-serif'
    ctx.fillStyle = roleColor
    ctx.fillText(node.role, node.x, node.y + 14)

    // === MEMPOOL BADGE ===
    if (node.mempoolSize > 0) {
      const bx = node.x + this.nodeRadius - 8, by = node.y - this.nodeRadius + 8
      ctx.beginPath()
      ctx.arc(bx, by, 12, 0, Math.PI * 2)
      ctx.fillStyle = '#F97316'
      ctx.fill()
      ctx.strokeStyle = '#0F172A'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 10px Inter, system-ui, sans-serif'
      ctx.fillText(node.mempoolSize.toString(), bx, by + 1)
    }
  }

  drawWallet(wallet) {
    const ctx = this.ctx
    const isSelected = this.selected?.id === wallet.id
    const isHovered = this.hovering?.id === wallet.id
    
    const { w, h } = this.walletSize
    const x = wallet.x - w / 2
    const y = wallet.y - h / 2
    const r = 10
    
    // Draw glow
    if (isSelected || isHovered) {
      ctx.shadowColor = this.colors.wallet.glow
      ctx.shadowBlur = 20
    }

    // Draw rounded rectangle
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    
    // Gradient fill
    const gradient = ctx.createLinearGradient(x, y, x, y + h)
    gradient.addColorStop(0, '#34D399')
    gradient.addColorStop(1, this.colors.wallet.fill)
    ctx.fillStyle = gradient
    ctx.fill()
    
    // Border
    ctx.strokeStyle = isSelected ? this.colors.wallet.selected : this.colors.wallet.stroke
    ctx.lineWidth = isSelected ? 3 : 2
    ctx.stroke()
    
    ctx.shadowBlur = 0
    
    // User name (prominent)
    ctx.fillStyle = this.colors.wallet.text
    ctx.font = 'bold 14px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(wallet.name, wallet.x, wallet.y)
  }

  drawLegend(consensusType) {
    const ctx = this.ctx
    const items = this.legendConfig[consensusType] || this.legendConfig.pow
    
    const padding = 12
    const itemHeight = 22
    const legendWidth = 130
    const legendHeight = padding * 2 + items.length * itemHeight
    
    const x = 16
    const y = this.height - legendHeight - 16
    
    // Background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.beginPath()
    ctx.roundRect(x, y, legendWidth, legendHeight, 8)
    ctx.fill()
    
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)'
    ctx.lineWidth = 1
    ctx.stroke()
    
    // Title
    ctx.fillStyle = '#94A3B8'
    ctx.font = '10px Inter, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    
    // Items
    items.forEach((item, i) => {
      const itemY = y + padding + i * itemHeight + itemHeight / 2
      
      // Shape
      ctx.fillStyle = item.color
      if (item.shape === 'square') {
        ctx.fillRect(x + padding, itemY - 5, 10, 10)
      } else {
        ctx.beginPath()
        ctx.arc(x + padding + 5, itemY, 5, 0, Math.PI * 2)
        ctx.fill()
      }

      // Label
      ctx.fillStyle = '#E2E8F0'
      ctx.font = '11px Inter, system-ui, sans-serif'
      ctx.fillText(item.label, x + padding + 20, itemY + 1)
    })
  }

  findEntityById(id, type, state) {
    if (type === 'node') {
      return state.nodes.find(n => n.id === id)
    } else if (type === 'wallet') {
      return state.wallets.find(w => w.id === id)
    }
    return null
  }

  trackMouse(e) {
    const pos = this.getMousePos(e)
    this.canvas._mousePos = pos
  }
}
