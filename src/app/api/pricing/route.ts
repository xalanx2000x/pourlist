/**
 * GET /api/pricing
 *
 * Returns the pricing manifest for PourList MCP operations.
 * Agents read this on initialization to determine which operations
 * are free vs. premium, and how to pay.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function GET() {
  const SOLANA_WALLET = process.env.CROSSMINT_WALLET_ADDRESS || 'FwVypWB9tw8UaCqKiLLA2Qh6TdNZRJ1cfvb1dHncrCb8'

  return NextResponse.json({
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    currency: 'USDC',
    network: 'solana',
    paymentAddress: SOLANA_WALLET,
    paymentInstructions: `Send the specified amount of USDC to ${SOLANA_WALLET} on Solana. Provide the transaction signature (base58) as the 'transactionId' parameter in your MCP tool call.`,
    operations: [
      // Free
      {
        operation: 'find_venues',
        params: { detail: 'summary' },
        priceUsd: '0.00',
        priceDisplay: 'Free',
        description: 'Basic venue list with HH status',
        premium: false,
      },
      {
        operation: 'get_active_happy_hours',
        params: {},
        priceUsd: '0.00',
        priceDisplay: 'Free',
        description: 'Currently active HH venues (time-aware)',
        premium: false,
      },
      {
        operation: 'get_venue_details',
        params: { detail: 'summary' },
        priceUsd: '0.00',
        priceDisplay: 'Free',
        description: 'Basic venue info (name, address, status)',
        premium: false,
      },
      {
        operation: 'submit_menu_update',
        params: {},
        priceUsd: '0.00',
        priceDisplay: 'Free',
        description: 'Submit or update menu text (grows the database)',
        premium: false,
      },
      // Premium: $0.0004 USDC (GPT base cost + 10%)
      {
        operation: 'get_venue_details',
        params: { detail: 'full' },
        priceUsd: '0.0004',
        priceDisplay: '$0.0004 USDC',
        description: 'Full menu text + all venue details',
        premium: true,
      },
      // Premium: $0.011 USDC ($0.01 base + 10%)
      {
        operation: 'find_venues',
        params: { includeHistorical: true },
        priceUsd: '0.011',
        priceDisplay: '$0.011 USDC',
        description: 'Historical HH data for market research',
        premium: true,
      },
    ],
    examples: {
      freeCall: {
        tool: 'get_venue_details',
        params: { venueId: '<uuid>', detail: 'summary' },
        note: 'Returns basic venue info without charge',
      },
      premiumCall: {
        tool: 'get_venue_details',
        params: { venueId: '<uuid>', detail: 'full', transactionId: '<solana-tx-signature>' },
        note: 'Agent must provide transactionId proving payment',
      },
      paymentFlow: {
        step1: 'Call GET /api/pricing to see operation costs',
        step2: 'Agent determines payment is required',
        step3: 'Agent prompts user to approve USDC payment to Solana address',
        step4: 'User signs transaction (wallet, dApp, or exchange)',
        step5: 'Agent receives transaction signature (base58)',
        step6: 'Agent retries MCP tool call with transactionId parameter',
        step7: 'PourList verifies on-chain payment via CrossMint → returns premium data',
      },
    },
  })
}