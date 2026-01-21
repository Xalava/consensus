import { generateKeyPair, addressFromPublicKey } from './crypto.js';
import { Transaction } from './transaction.js';

// Known user names for wallets
export const KNOWN_USERS = [
  '',
  'Alice', 'Bob', 'Carmen', 'Denis', 'Emma',
  'Fatou', 'Gal', 'Hikari',
];

export class Wallet {
  constructor(id, initialBalance = 1000) {
    this.id = id;
    this.name = KNOWN_USERS[id] || `User ${id}`;
    const keys = generateKeyPair();
    this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey;
    this.address = addressFromPublicKey(this.publicKey);
    this.initialBalance = initialBalance;

    // UI positioning
    this.x = 100;
    this.y = 100;

    // Connected node
    this.connectedNodeId = null;

    // Local nonce tracking
    this.nonce = 0;

    // Pending transactions (sent but not yet confirmed)
    this.pendingTxs = new Map();
  }

  connect(nodeId) {
    this.connectedNodeId = nodeId;
  }

  disconnect() {
    this.connectedNodeId = null;
  }

  createTransaction(to, amount) {
    const tx = new Transaction({
      from: this.address,
      to,
      amount,
      nonce: this.nonce,
      privateKey: this.privateKey
    });
    this.nonce++;
    this.pendingTxs.set(tx.id, tx);
    return tx;
  }

  // Called when a transaction is finalized
  confirmTransaction(txId) {
    this.pendingTxs.delete(txId);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      address: this.address,
      x: this.x,
      y: this.y,
      connectedNodeId: this.connectedNodeId
    };
  }
}
