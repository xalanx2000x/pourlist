/**
 * CrossMint payment integration for PourList MCP server.
 * Handles payment verification for premium data operations.
 *
 * Docs: https://docs.crossmint.com
 */

const CROSSMINT_API_KEY = process.env.CROSSMINT_API_KEY
const CROSSMINT_BASE_URL = 'https://www.crossmint.com/api'
const CROSSMINT_WALLET_ADDRESS = process.env.CROSSMINT_WALLET_ADDRESS

// ── Pricing manifest ──────────────────────────────────────────────────────────
// Amounts stored as USDC millicents: 1 = $0.0001, 10 = $0.001, 100 = $0.01, 1000 = $0.10
// Premium prices set at GPT base cost ($0.0003/photo) + 10%
// Historical data at $0.01 base + 10%

export interface PriceEntry {
  amount: number       // USDC millicents
  description: string
}

export const PRICING: PriceEntry[] = [
  // Free operations
  {
    amount: 0,
    description: 'Basic venue list with HH status',
  },
  {
    amount: 0,
    description: 'Currently active HH venues (time-aware)',
  },
  {
    amount: 0,
    description: 'Basic venue info (name, address, status)',
  },
  {
    amount: 0,
    description: 'Submit or update menu text (free — grows the database)',
  },
  // Premium: full menu text — $0.0004 USDC (GPT parse base + 10%)
  {
    amount: 4,
    description: 'Full menu text + all venue details',
  },
  // Premium: historical data — $0.011 USDC ($0.01 base + 10%)
  {
    amount: 110,
    description: 'Venue with historical HH data (market research)',
  },
]

// ── CrossMint API client ──────────────────────────────────────────────────────

async function crossmintRequest(path: string, options: RequestInit = {}) {
  const res = await fetch(`${CROSSMINT_BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-API-KEY': CROSSMINT_API_KEY!,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(`CrossMint ${res.status}: ${err.message || JSON.stringify(err)}`)
  }

  return res.json()
}

// ── Payment operations ───────────────────────────────────────────────────────

export interface PaymentOrder {
  orderId: string
  paymentAddress: string
  amount: number       // USDC millicents
  displayAmount: string
  description: string
  expiresAt: string
}

/**
 * Create a payment order for a premium operation.
 * Returns order details including where to send payment.
 */
export async function createPaymentOrder(
  operation: string,
  params: Record<string, unknown>
): Promise<PaymentOrder> {
  const entry = lookupPrice(operation, params)

  if (entry.amount === 0) {
    return { orderId: 'free', paymentAddress: '', amount: 0, displayAmount: '$0.00', description: '', expiresAt: '' }
  }

  const walletAddr = CROSSMINT_WALLET_ADDRESS || 'FwVypWB9tw8UaCqKiLLA2Qh6TdNZRJ1cfvb1dHncrCb8'
  const displayAmt = (entry.amount / 10000).toFixed(4)

  return {
    orderId: `pourlist-${operation}-${Date.now()}`,
    paymentAddress: walletAddr,
    amount: entry.amount,
    displayAmount: `$${displayAmt} USDC`,
    description: entry.description,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }
}

export interface PaymentVerification {
  confirmed: boolean
  orderId: string
  amount?: number
  fromAddress?: string
  error?: string
}

/**
 * Verify a payment by transaction ID via CrossMint Wallet API.
 */
export async function verifyPayment(
  orderId: string,
  transactionId: string
): Promise<PaymentVerification> {
  if (orderId === 'free') return { confirmed: true, orderId }

  try {
    const walletAddr = CROSSMINT_WALLET_ADDRESS || 'FwVypWB9tw8UaCqKiLLA2Qh6TdNZRJ1cfvb1dHncrCb8'
    const tx = await crossmintRequest(
      `/2025-06-09/wallets/${walletAddr}/transactions/${transactionId}`
    )

    const status = tx?.status || tx?.state || 'unknown'
    const confirmed = status === 'confirmed' || status === 'completed' || status === 'success'

    return {
      confirmed,
      orderId,
      amount: parseFloat(tx?.amount || '0'),
      fromAddress: tx?.from || tx?.sender || undefined,
      error: confirmed ? undefined : `Transaction status: ${status}`,
    }
  } catch (err) {
    const msg = String(err)
    if (msg.includes('404') || msg.includes('not found')) {
      return { confirmed: false, orderId, error: 'Transaction not found in CrossMint. If you paid on-chain directly, provide the transaction ID for manual verification.' }
    }
    return { confirmed: false, orderId, error: msg }
  }
}

/**
 * Look up price for an operation + params combo.
 * Returns null if operation/params combo not found (defaults to free).
 */
function lookupPrice(operation: string, params: Record<string, unknown>): PriceEntry {
  const exact = PRICING.find(
    p => JSON.stringify({ operation, params }) === JSON.stringify({ operation, params })
  )
  if (exact) return exact

  const free = PRICING.find(p => p.amount === 0)
  return free || { amount: 0, description: 'Free operation' }
}

/**
 * Build a 402 payment required response for the MCP layer.
 */
export function paymentRequiredResponse(order: PaymentOrder, requestId: string | number) {
  return {
    jsonrpc: '2.0',
    id: requestId,
    error: {
      code: 402,
      message: 'Payment required',
      data: {
        orderId: order.orderId,
        paymentAddress: order.paymentAddress,
        amount: order.amount,
        displayAmount: order.displayAmount,
        asset: 'USDC',
        network: 'solana',
        description: order.description,
        expiresAt: order.expiresAt,
        paymentInstructions: `Send ${order.displayAmount} to ${order.paymentAddress} on Solana. Provide the transaction signature (base58) as 'transactionId' in your retry request.`,
      },
    },
  }
}