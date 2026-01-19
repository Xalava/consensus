/**
 * Consensus Interface
 *
 * Every consensus engine must implement these methods:
 *
 * - name: string - The consensus name ("pow" | "pos" | "raft" | "pbft")
 * - init(node, network, globals) - Initialize consensus state for a node
 * - onTx(node, tx, network) - Called when a new transaction arrives
 * - onMessage(node, msg, network) - Called when a network message is received
 * - onTick(node, now, network) - Called every simulation tick
 * - getRole(node) - Returns the node's current role for UI display
 * - isFinalized(node, blockId) - Check if a block is finalized
 */

export class ConsensusEngine {
  constructor(name) {
    this.name = name
  }

  /**
   * Initialize consensus state for a node
   * @param {Node} node
   * @param {Network} network
   * @param {Object} globals - Global settings (difficulty, slot duration, etc.)
   */
  init(node, network, globals) {
    throw new Error('Not implemented')
  }

  /**
   * Handle incoming transaction
   * @param {Node} node
   * @param {Transaction} tx
   * @param {Network} network
   */
  onTx(node, tx, network) {
    throw new Error('Not implemented')
  }

  /**
   * Handle incoming network message
   * @param {Node} node
   * @param {Message} msg
   * @param {Network} network
   */
  onMessage(node, msg, network) {
    throw new Error('Not implemented')
  }

  /**
   * Called every simulation tick
   * @param {Node} node
   * @param {number} now - Current timestamp
   * @param {Network} network
   */
  onTick(node, now, network) {
    throw new Error('Not implemented')
  }

  /**
   * Get the node's current role for UI display
   * @param {Node} node
   * @returns {string}
   */
  getRole(node) {
    return 'Node'
  }

  /**
   * Check if a block is finalized
   * @param {Node} node
   * @param {string} blockId
   * @returns {boolean}
   */
  isFinalized(node, blockId) {
    return false
  }

  /**
   * Get consensus-specific UI state
   * @param {Node} node
   * @returns {Object}
   */
  getUIState(node) {
    return {}
  }
}
