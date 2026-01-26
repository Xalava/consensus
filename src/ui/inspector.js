/**
 * Inspector panel for displaying node/wallet details
 */

import { TxState } from '../core/transaction.js'

export class Inspector {
  constructor(container, simulation) {
    this.container = container
    this.simulation = simulation
    this.selected = null

    // Action callbacks
    this.onSendTransaction = null
    this.onDeleteNode = null
    this.onDeleteWallet = null
    this.onDisconnectPeer = null
    this.onDisconnectWallet = null
  }

  setSelected(selection) {
    this.selected = selection
    this.render()
  }

  render() {
    if (!this.selected) {
      this.container.innerHTML = `
        <div class="inspector-empty">
          <p>Select a node or wallet to view details</p>
          <p class="hint">Double-click canvas to add a node</p>
        </div>
      `
      return
    }

    if (this.selected.type === 'node') {
      this.renderNodeInspector()
    } else if (this.selected.type === 'wallet') {
      this.renderWalletInspector()
    }
  }

  renderNodeInspector() {
    const node = this.simulation.nodes.get(this.selected.id)
    if (!node) return

    const state = this.simulation.getState()
    const nodeState = state.nodes.find(n => n.id === node.id)
    if (!nodeState) return

    const consensusType = this.simulation.consensusType
    const consensusState = nodeState.consensusState || {}

    // Get mempool transactions
    const mempoolTxs = Array.from(node.mempool.values()).slice(0, 5)

    // Get head block info
    const headBlock = node.getHead()
    const finalizedBlock = node.getFinalized()

    // Build main chain set (for identifying orphans)
    const mainChainIds = new Set()
    let walkBlock = headBlock
    while (walkBlock && walkBlock.height > 0) {
      mainChainIds.add(walkBlock.id)
      walkBlock = node.getBlock(walkBlock.parentId)
    }

    // Group all blocks by height (excluding genesis), max 1 orphan per height
    const blocksByHeight = new Map()
    for (const [blockId, block] of node.blockStore) {
      if (block.height === 0) continue
      if (!blocksByHeight.has(block.height)) {
        blocksByHeight.set(block.height, { main: null, orphan: null })
      }
      const entry = blocksByHeight.get(block.height)
      if (mainChainIds.has(blockId)) {
        entry.main = block
      } else if (!entry.orphan) {
        entry.orphan = block  // Keep only first orphan
      }
    }

    // Get top 5 heights, sorted descending
    const heights = Array.from(blocksByHeight.keys()).sort((a, b) => b - a).slice(0, 5)

    let consensusPanel = ''

    switch (consensusType) {
      case 'pow':
        consensusPanel = this.renderPoWPanel(node, consensusState)
        break
      case 'pos':
        consensusPanel = this.renderPoSPanel(node, consensusState)
        break
      case 'raft':
        consensusPanel = this.renderRaftPanel(node, consensusState)
        break
      case 'pbft':
        consensusPanel = this.renderPBFTPanel(node, consensusState)
        break
    }

    this.container.innerHTML = `
      <div class="inspector-content">
        <h3>
          ⚪ ${node.name}
          <span class="badge role-${nodeState.role.toLowerCase()}">${nodeState.role}</span>
        </h3>

        ${consensusPanel}

        <div class="inspector-section">
          <h4>Mempool (${node.mempool.size})</h4>
          <div class="tx-list">
            ${mempoolTxs.length > 0 ? mempoolTxs.map(tx => `
              <div class="tx-item pending">
                <span class="tx-id">${tx.id}</span>
                <span class="tx-amount">${tx.amount}</span>
                <span class="tx-state">PENDING</span>
              </div>
            `).join('') : '<div class="empty">No pending transactions</div>'}
          </div>
        </div>

        <div class="inspector-section">
          <h4>📦 Recent Blocks</h4>
          <div class="block-list-rows">
            ${heights.length > 0 ? heights.map(height => {
      const { main, orphan } = blocksByHeight.get(height)
      const isFinalized = height <= nodeState.finalizedHeight

      const renderChip = (block, isOrphan) => {
        if (!block) return ''
        const txCount = block.transactions?.length || block.txIds?.length || 0
        const status = isOrphan ? 'orphan' : (isFinalized ? 'finalized' : 'unconfirmed')
        const icon = isOrphan ? '✗' : (isFinalized ? '✓' : '⏳')
        const txList = (block.transactions || []).map(tx => '• ' + tx.id + '\n   (' + tx.from.slice(0, 6) + '→' + tx.to.slice(0, 6) + ': ' + tx.amount + ')').join('\n')
        const blockTooltip = 'ID: ' + block.id + '&#10;Producer: N' + block.producerId + '&#10;Status: ' + status + '&#10;Txs: ' + '\n' + (txList ? txList : '') + '&#10;Parent: ' + block.parentId + '&#10;Nonce: ' + block.proof.nonce
        return '<span class="block-chip ' + status + '" title="' + blockTooltip + '">' + block.id.slice(0, 8) + ' ' + icon + '</span>'
      }

      return '<div class="block-row"><span class="block-height">#' + height + '</span><div class="block-chips">' + renderChip(main, false) + renderChip(orphan, true) + '</div></div>'
    }).join('') : '<div class="empty">No blocks yet</div>'}
          </div>
        </div>

        <div class="inspector-section">
          <h4>Peers (${node.peers.size})</h4>
          <div class="peer-list">
            ${Array.from(node.peers).map(peerId => `
              <span class="peer-badge" data-peer-id="${peerId}">
                N${peerId}
                <button class="peer-disconnect" data-peer-id="${peerId}" title="Disconnect">×</button>
              </span>
            `).join('')}
            ${node.peers.size === 0 ? '<div class="empty">No peers connected</div>' : ''}
          </div>
        </div>

        <div class="inspector-section inspector-actions">
          <button id="delete-node-btn" class="btn btn-danger btn-small">Delete Node</button>
        </div>
      </div>
    `

    // Attach event handlers
    this.attachNodeEventHandlers(node)
  }

  renderPoWPanel(node, state) {
    const miningStatus = state.isMiningActive ? '⚡ Mining' : (state.mining ? '⏳ Waiting' : '⏸ Paused')
    return `
      <div class="inspector-section consensus-panel">
        <h4>⛏️ Proof of Work</h4>

        <div class="stat-row" title="Level of challenge of the cryptographic puzzle" >
          <span class="stat-label">Difficulty:</span>
          <span class="stat-value">${state.difficulty}</span>
        </div>
        <div class="stat-row" title="Number of blocks waited before considering a transaction final">
          <span class="stat-label">Confirmations:</span>
          <span class="stat-value">${state.confirmations}</span>
        </div>
        
        <h5>Node status</h5>
        <div class="stat-row">
          <span class="stat-label">Mining:</span>
          <label class="switch">
          <input type="checkbox" id="mining-toggle" ${state.mining ? 'checked' : ''}>
          <span class="slider"></span>
          </label>
        </div>
        <div class="stat-row">
          <span class="stat-label">Status:</span>
          <span class="stat-value ${state.isMiningActive ? 'highlight' : ''}">${miningStatus}</span>
        </div>
        <div class="stat-row" title="Number of hash calculated per cycle">
          <span class="stat-label">Hash Power:</span>
          <span class="stat-value mono">${state.hashPower}</span>
        </div>    
      </div>
    `
  }

  renderPoSPanel(node, state) {
    return `
      <div class="inspector-section consensus-panel">
        <h4>🪙 Proof of Stake (WIP)</h4>
        <div class="stat-row">
          <span class="stat-label">Validator:</span>
          <label class="switch">
            <input type="checkbox" id="validator-toggle" ${state.isValidator ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="stat-row">
          <span class="stat-label">Stake:</span>
          <input type="range" id="stake-slider" min="0" max="500" value="${state.stake}" class="slider-input">
          <span class="stat-value">${state.stake}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Current Slot:</span>
          <span class="stat-value">${state.currentSlot}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Is Leader:</span>
          <span class="stat-value ${state.isLeader ? 'highlight' : ''}">${state.isLeader ? 'Yes' : 'No'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Current Leader:</span>
          <span class="stat-value">${state.currentLeader != null ? 'N' + state.currentLeader : '-'}</span>
        </div>
      </div>
    `
  }

  renderRaftPanel(node, state) {
    return `
      <div class="inspector-section consensus-panel">
        <h4>📋 Raft</h4>
        <div class="stat-row">
          <span class="stat-label">Role:</span>
          <span class="stat-value badge role-${state.role?.toLowerCase()}">${state.role}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Term:</span>
          <span class="stat-value">${state.term}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Leader:</span>
          <span class="stat-value">${state.leaderId != null ? 'N' + state.leaderId : 'None'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Commit Index:</span>
          <span class="stat-value">${state.commitIndex}</span>
        </div>
        ${state.role === 'Leader' ? `
          <div class="stat-row">
            <span class="stat-label">Heartbeats:</span>
            <label class="switch">
              <input type="checkbox" id="heartbeat-toggle" ${state.heartbeatEnabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
        ` : ''}
        ${state.role === 'Follower' ? `
          <button id="trigger-election" class="btn btn-small">Trigger Election</button>
        ` : ''}
      </div>
    `
  }

  renderPBFTPanel(node, state) {
    return `
      <div class="inspector-section consensus-panel">
        <h4>🔐 PBFT</h4>
        <div class="stat-row">
          <span class="stat-label">View:</span>
          <span class="stat-value">${state.view}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Sequence:</span>
          <span class="stat-value">${state.sequence}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Phase:</span>
          <span class="stat-value badge phase-${state.currentPhase?.toLowerCase()}">${state.currentPhase}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Prepares:</span>
          <span class="stat-value">${state.prepareCount}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Commits:</span>
          <span class="stat-value">${state.commitCount}</span>
        </div>
        <button id="change-view" class="btn btn-small">Change View</button>
      </div>
    `
  }

  attachNodeEventHandlers(node) {
    const consensus = this.simulation.consensus
    if (!consensus) return

    // Mining toggle (PoW)
    const miningToggle = document.getElementById('mining-toggle')
    if (miningToggle) {
      miningToggle.addEventListener('change', () => {
        consensus.toggleMining(node)
        this.render()
      })
    }

    // Validator toggle (PoS)
    const validatorToggle = document.getElementById('validator-toggle')
    if (validatorToggle) {
      validatorToggle.addEventListener('change', () => {
        consensus.toggleValidator(node)
        this.render()
      })
    }

    // Stake slider (PoS)
    const stakeSlider = document.getElementById('stake-slider')
    if (stakeSlider) {
      stakeSlider.addEventListener('input', (e) => {
        consensus.setStake(node, parseInt(e.target.value))
        this.render()
      })
    }

    // Heartbeat toggle (Raft)
    const heartbeatToggle = document.getElementById('heartbeat-toggle')
    if (heartbeatToggle) {
      heartbeatToggle.addEventListener('change', () => {
        consensus.toggleHeartbeat(node)
        this.render()
      })
    }

    // Trigger election (Raft)
    const triggerElection = document.getElementById('trigger-election')
    if (triggerElection) {
      triggerElection.addEventListener('click', () => {
        consensus.triggerElection(node, this.simulation.network)
        this.render()
      })
    }

    // Change view (PBFT)
    const changeView = document.getElementById('change-view')
    if (changeView) {
      changeView.addEventListener('click', () => {
        consensus.changeView(this.simulation.network)
        this.render()
      })
    }

    // Delete node button
    const deleteNodeBtn = document.getElementById('delete-node-btn')
    if (deleteNodeBtn) {
      deleteNodeBtn.addEventListener('click', () => {
        if (this.onDeleteNode) {
          this.onDeleteNode(node.id)
        }
      })
    }

    // Peer disconnect buttons
    const peerDisconnectBtns = document.querySelectorAll('.peer-disconnect')
    peerDisconnectBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const peerId = btn.dataset.peerId
        if (this.onDisconnectPeer && peerId) {
          this.onDisconnectPeer(node.id, peerId)
        }
      })
    })
  }

  renderWalletInspector() {
    const wallet = this.simulation.wallets.get(this.selected.id)
    if (!wallet) return

    // Get balance from connected node
    let balance = wallet.initialBalance
    if (wallet.connectedNodeId) {
      const node = this.simulation.nodes.get(wallet.connectedNodeId)
      if (node) {
        balance = node.ledger.getBalance(wallet.address)
      }
    }

    // Get other wallet addresses for transaction form
    const otherAddresses = this.simulation.getAddresses()
      .filter(a => a.id !== wallet.id)

    this.container.innerHTML = `
      <div class="inspector-content">
        <h3>💰 ${wallet.name}</h3>

        <div class="inspector-section">
          <h4>Account</h4>
          <div class="stat-row">
            <span class="stat-label">Address:</span>
            <span class="stat-value mono">${wallet.address}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Balance:</span>
            <span class="stat-value highlight">${balance}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Nonce:</span>
            <span class="stat-value">${wallet.nonce}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Connected to:</span>
            <span class="stat-value">${wallet.connectedNodeId != null ? 'Node ' + wallet.connectedNodeId : 'Not connected'}</span>
          </div>
        </div>

        <div class="inspector-section">
          <h4>Send Transaction</h4>
          ${wallet.connectedNodeId ? `
            <form id="send-tx-form">
              <div class="form-group">
                <label>To:</label>
                <select id="tx-to" required>
                  ${otherAddresses.map(a => `
                    <option value="${a.address}">${a.name} (${a.address})</option>
                  `).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Amount:</label>
                <input type="number" id="tx-amount" min="1" max="${balance}" value="10" required>
              </div>
              <button type="submit" class="btn btn-primary">Send</button>
            </form>
          ` : `
            <div class="empty">Connect wallet to a node first</div>
          `}
        </div>

        <div class="inspector-section">
          <h4>Pending Transactions (${wallet.pendingTxs.size})</h4>
          <div class="tx-list">
            ${Array.from(wallet.pendingTxs.values()).slice(0, 5).map(tx => `
              <div class="tx-item pending">
                <span class="tx-id">${tx.id.slice(0, 8)}...</span>
                <span class="tx-to">→ ${tx.to}</span>
                <span class="tx-amount">${tx.amount}</span>
              </div>
            `).join('') || '<div class="empty">No pending transactions</div>'}
          </div>
        </div>

        <div class="inspector-section inspector-actions">
          ${wallet.connectedNodeId ? `
            <button id="disconnect-wallet-btn" class="btn btn-small">Disconnect</button>
          ` : ''}
          <button id="delete-wallet-btn" class="btn btn-danger btn-small">Delete Wallet</button>
        </div>
      </div>
    `

    // Attach send form handler
    const form = document.getElementById('send-tx-form')
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const to = document.getElementById('tx-to').value
        const amount = parseInt(document.getElementById('tx-amount').value)

        if (to && amount > 0) {
          const tx = this.simulation.sendTransaction(wallet.id, to, amount)
          if (tx && this.onSendTransaction) {
            this.onSendTransaction(tx, wallet.id, wallet.connectedNodeId)
          }
          this.render()
        }
      })
    }

    // Disconnect wallet button
    const disconnectWalletBtn = document.getElementById('disconnect-wallet-btn')
    if (disconnectWalletBtn) {
      disconnectWalletBtn.addEventListener('click', () => {
        if (this.onDisconnectWallet) {
          this.onDisconnectWallet(wallet.id)
        }
      })
    }

    // Delete wallet button
    const deleteWalletBtn = document.getElementById('delete-wallet-btn')
    if (deleteWalletBtn) {
      deleteWalletBtn.addEventListener('click', () => {
        if (this.onDeleteWallet) {
          this.onDeleteWallet(wallet.id)
        }
      })
    }
  }
}
