/**
 * MCP Server Transport — Streamable HTTP
 *
 * Exposes the PourList MCP server at POST /api/mcp
 * Any AI agent that supports MCP over HTTP can connect here.
 *
 * This route handles:
 * - POST /api/mcp  — MCP JSON-RPC messages (initialize, tools/call, etc.)
 * - GET  /api/mcp  — Returns the MCP server manifest for discovery
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getVenuesByZip, getVenueById } from '@/lib/venues'
import { hasActiveHappyHour } from '@/lib/activeHH'
import { PRICING, createPaymentOrder, verifyPayment, paymentRequiredResponse } from '@/lib/payments'
import { generateDidFromSeed, logServerDid, issueVC, verifyVC } from '@/lib/did'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── MCP JSON-RPC request handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // All MCP messages are JSON-RPC 2.0
    const { method, id, params } = body

    switch (method) {
      case 'initialize':
        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: { name: 'pourlist', version: '1.0.0' },
            instructions: 'The Pour List — Portland Happy Hours MCP Server. Use find_venues to list venues, get_active_happy_hours to find currently active HH, get_venue_details for full info.',
          },
        })

      case 'tools/list': {
        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'find_venues',
                description: 'Find happy hour venues in Portland. Returns name, address, active HH status, and menu summary.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    zip: { type: 'string', default: '97209', description: 'Portland zip code to search within' },
                    radiusMi: { type: 'number', default: 1, description: 'Search radius in miles' },
                    activeHH: { type: 'boolean', default: false, description: 'Filter to only venues with active HH right now' },
                  },
                },
              },
              {
                name: 'find_venues',
                description: 'Find happy hour venues in Portland. Returns name, address, active HH status, and menu summary.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    zip: { type: 'string', default: '97209', description: 'Portland zip code to search within' },
                    radiusMi: { type: 'number', default: 1, description: 'Search radius in miles' },
                    activeHH: { type: 'boolean', default: false, description: 'Filter to only venues with active HH right now' },
                    includeHistorical: { type: 'boolean', default: false, description: 'Include historical HH data (premium — requires payment)' },
                    transactionId: { type: 'string', description: 'Solana transaction signature proving payment (required for premium operations)' },
                  },
                },
              },
              {
                name: 'get_venue_details',
                description: 'Get full details for a specific venue including full menu text, address, coordinates, and HH status.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    venueId: { type: 'string', description: 'UUID of the venue to look up' },
                    detail: { type: 'string', enum: ['summary', 'full'], default: 'summary', description: "'summary' is free. 'full' returns the complete menu text (premium — requires payment)." },
                    transactionId: { type: 'string', description: 'Solana transaction signature proving payment (required for premium operations)' },
                  },
                  required: ['venueId'],
                },
              },
              {
                name: 'get_active_happy_hours',
                description: 'Returns all venues with currently active happy hour windows.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    zip: { type: 'string', default: '97209', description: 'Portland zip code' },
                    limit: { type: 'number', default: 20, description: 'Maximum venues to return' },
                  },
                },
              },
              {
                name: 'submit_menu_update',
                description: 'Submit or update menu text for a venue. Creates a new venue if venueId is omitted.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    venueId: { type: 'string', description: 'UUID of existing venue to update (omit to create new venue)' },
                    menuText: { type: 'string', description: 'The extracted menu text content' },
                    venueName: { type: 'string', description: 'Venue name (required for new venues)' },
                    address: { type: 'string', description: 'Venue address (required for new venues)' },
                    lat: { type: 'number', description: 'Latitude of venue or photo location' },
                    lng: { type: 'number', description: 'Longitude of venue or photo location' },
                    imageUrl: { type: 'string', description: 'Optional URL of uploaded reference photo' },
                  },
                  required: ['menuText'],
                },
              },
              {
                name: 'get_issuer_did',
                description: 'Returns the PourList server DID. Use this to get the issuer DID for VC verification.',
                inputSchema: { type: 'object', properties: {} },
              },
              {
                name: 'authorize_agent',
                description: 'Exchange an agent DID for a Verifiable Credential granting operational authority. The VC is a short-lived JWT (1 hour) issued by the PourList server DID.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    agentDid: { type: 'string', description: "The agent's DID (did:key or did:pkh)" },
                    requestedCapabilities: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Requested capabilities: find_venues, get_venue_details, get_active_happy_hours, submit_menu_update, premium_data',
                    },
                    expiresIn: { type: 'number', description: 'Desired VC expiry in seconds (default 3600, max 86400)' },
                  },
                  required: ['agentDid', 'requestedCapabilities'],
                },
              },
            ],
          },
        })
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {}

        switch (name) {
          case 'find_venues': {
            const zip = (args as Record<string, unknown>)?.zip as string || '97209'
            const activeHH = (args as Record<string, unknown>)?.activeHH as boolean || false
            const includeHistorical = (args as Record<string, unknown>)?.includeHistorical as boolean || false
            const transactionId = (args as Record<string, unknown>)?.transactionId as string | undefined

            // Premium check: historical data
            if (includeHistorical && !transactionId) {
              const order = await createPaymentOrder('find_venues', { includeHistorical: true })
              return NextResponse.json(paymentRequiredResponse(order, id))
            }
            if (includeHistorical && transactionId) {
              const verification = await verifyPayment(`find_venues-historical`, transactionId)
              if (!verification.confirmed) {
                return NextResponse.json({
                  jsonrpc: '2.0', id,
                  error: { code: 403, message: verification.error || 'Payment not verified' },
                })
              }
            }

            const venues = await getVenuesByZip(zip)
            let filtered = venues
            if (activeHH) filtered = venues.filter(v => hasActiveHappyHour(v.menu_text))

            const results = filtered.slice(0, 50).map(v => ({
              id: v.id,
              name: v.name,
              address: v.address,
              status: v.status,
              hasActiveHH: hasActiveHappyHour(v.menu_text),
              menuExcerpt: v.menu_text ? v.menu_text.slice(0, 300) + (v.menu_text.length > 300 ? '…' : '') : null,
              menuTextUpdatedAt: v.menu_text_updated_at,
              latestMenuImageUrl: v.latest_menu_image_url,
              lat: v.lat,
              lng: v.lng,
              ...(includeHistorical ? { menuText: v.menu_text } : {}),
            }))

            return NextResponse.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ count: results.length, queriedZip: zip, activeHHFilter: activeHH, venues: results }, null, 2),
                  },
                ],
              },
            })
          }

          case 'get_venue_details': {
            const venueId = (args as Record<string, unknown>)?.venueId as string
            const detail = (args as Record<string, unknown>)?.detail as string || 'summary'
            const transactionId = (args as Record<string, unknown>)?.transactionId as string | undefined

            const venue = await getVenueById(venueId)
            if (!venue) {
              return NextResponse.json({
                jsonrpc: '2.0',
                id,
                result: { content: [{ type: 'text', text: `Venue not found: ${venueId}` }], isError: true },
              })
            }

            // Premium check: full detail
            if (detail === 'full' && !transactionId) {
              const order = await createPaymentOrder('get_venue_details', { detail: 'full' })
              return NextResponse.json(paymentRequiredResponse(order, id))
            }
            if (detail === 'full' && transactionId) {
              const verification = await verifyPayment(`get_venue_details-${venueId}`, transactionId)
              if (!verification.confirmed) {
                return NextResponse.json({
                  jsonrpc: '2.0', id,
                  error: { code: 403, message: verification.error || 'Payment not verified' },
                })
              }
            }

            const response = {
              id: venue.id,
              name: venue.name,
              address: venue.address,
              phone: venue.phone,
              website: venue.website,
              type: venue.type,
              status: venue.status,
              hasActiveHH: hasActiveHappyHour(venue.menu_text),
              ...(detail === 'full'
                ? {
                    menuText: venue.menu_text,
                    menuTextUpdatedAt: venue.menu_text_updated_at,
                    latestMenuImageUrl: venue.latest_menu_image_url,
                  }
                : { menuExcerpt: venue.menu_text ? venue.menu_text.slice(0, 300) + '…' : null }),
              lat: venue.lat,
              lng: venue.lng,
              lastVerified: venue.last_verified,
            }

            return NextResponse.json({
              jsonrpc: '2.0',
              id,
              result: { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] },
            })
          }

          case 'get_active_happy_hours': {
            const zip = (args as Record<string, unknown>)?.zip as string || '97209'
            const limit = (args as Record<string, unknown>)?.limit as number || 20

            const venues = await getVenuesByZip(zip)
            const active = venues
              .filter(v => hasActiveHappyHour(v.menu_text))
              .slice(0, limit)
              .map(v => ({
                name: v.name,
                address: v.address,
                menuText: v.menu_text,
                lat: v.lat,
                lng: v.lng,
              }))

            return NextResponse.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ activeNow: active.length, asOf: new Date().toISOString(), venues: active }, null, 2),
                  },
                ],
              },
            })
          }

          case 'submit_menu_update': {
            const { menuText, venueId, venueName, address, lat, lng, imageUrl } = args as Record<string, unknown>

            const res = await fetch(
              `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/submit-menu`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  menuText,
                  venueId: venueId || undefined,
                  venueName: venueName || 'Unknown Venue',
                  address: address || '',
                  lat,
                  lng,
                  imageUrl,
                  deviceHash: 'mcp-agent',
                }),
              }
            )

            const data = await res.json()
            if (!res.ok) {
              return NextResponse.json({
                jsonrpc: '2.0',
                id,
                result: { content: [{ type: 'text', text: `Submit failed: ${data.error}` }], isError: true },
              })
            }

            return NextResponse.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ success: true, venueId: data.venueId }),
                  },
                ],
              },
            })
          }

          case 'get_issuer_did': {
            const serverDid = logServerDid()
            return NextResponse.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      did: serverDid,
                      method: 'did:key',
                      algorithm: 'Ed25519',
                      issuer: 'PourList MCP Server',
                    }),
                  },
                ],
              },
            })
          }

          case 'authorize_agent': {
            const agentDid = (args as Record<string, unknown>)?.agentDid as string
            const requestedCapabilities = (args as Record<string, unknown>)?.requestedCapabilities as string[]
            const expiresIn = Math.min((args as Record<string, unknown>)?.expiresIn as number || 3600, 86400)

            if (!agentDid || !requestedCapabilities?.length) {
              return NextResponse.json({
                jsonrpc: '2.0',
                id,
                error: { code: -32602, message: 'agentDid and requestedCapabilities are required' },
              })
            }

            try {
              const vcJwt = await issueVC(agentDid, requestedCapabilities, expiresIn)
              return NextResponse.json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        credential: vcJwt,
                        issuer: logServerDid(),
                        subject: agentDid,
                        capabilities: requestedCapabilities,
                        expiresIn,
                        message: 'Present this JWT as authorization when calling premium operations.',
                      }),
                    },
                  ],
                },
              })
            } catch (err) {
              return NextResponse.json({
                jsonrpc: '2.0',
                id,
                error: { code: -32603, message: `VC issuance failed: ${err}` },
              })
            }
          }

          default:
            return NextResponse.json({
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Unknown tool: ${name}` },
            })
        }
      }

      case 'resources/list':
        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          result: {
            resources: [
              {
                uri: 'pourlist://schema',
                name: 'Venue Schema',
                description: 'The Pour List venue record schema',
                mimeType: 'application/json',
              },
              {
                uri: 'pourlist://info',
                name: 'Server Info',
                description: 'PourList MCP server capabilities',
                mimeType: 'application/json',
              },
            ],
          },
        })

      case 'resources/read': {
        const uri = (params as Record<string, unknown>)?.uri as string
        if (uri === 'pourlist://info') {
          return NextResponse.json({
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  text: JSON.stringify({
                    name: 'pourlist',
                    version: '1.0.0',
                    description: 'The Pour List — Portland Happy Hours MCP Server',
                    tools: ['find_venues', 'get_venue_details', 'get_active_happy_hours', 'submit_menu_update'],
                    transport: 'streamable HTTP',
                  }),
                },
              ],
            },
          })
        }
        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Unknown resource' },
        })
      }

      case 'ping':
        return NextResponse.json({ jsonrpc: '2.0', id, result: {} })

      default:
        return NextResponse.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        })
    }
  } catch (err) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: String(err) } },
      { status: 500 }
    )
  }
}

// ── GET: return OpenAPI spec for agent discovery ──────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format')

  if (format === 'openapi') {
    return NextResponse.json({
      openapi: '3.0.0',
      info: {
        title: 'The Pour List MCP Server',
        version: '1.0.0',
        description: 'MCP (Model Context Protocol) server for The Pour List happy hour directory. Exposes tools for AI agents to query Portland happy hour venues.',
      },
      servers: [{ url: process.env.NEXT_PUBLIC_BASE_URL || 'https://pourlist.com' }],
      paths: {
        '/api/mcp': {
          post: {
            summary: 'MCP JSON-RPC endpoint',
            description: 'All MCP protocol messages (initialize, tools/call, resources/read, etc.)',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'MCP JSON-RPC response' } },
          },
        },
      },
      components: {
        schemas: {
          Venue: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              address: { type: 'string' },
              lat: { type: 'number' },
              lng: { type: 'number' },
              status: { type: 'string', enum: ['unverified', 'verified', 'stale', 'closed'] },
              hasActiveHH: { type: 'boolean' },
              menuExcerpt: { type: 'string' },
              menuTextUpdatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    })
  }

  // Default: return MCP server manifest
  return NextResponse.json({
    name: 'pourlist',
    version: '1.0.0',
    description: 'The Pour List — Portland Happy Hours MCP Server',
    protocol: 'MCP 1.x',
    transport: 'streamable HTTP',
    endpoint: '/api/mcp',
    tools: ['find_venues', 'get_venue_details', 'get_active_happy_hours', 'submit_menu_update'],
    resources: ['venue-schema', 'server-info'],
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
    },
  })
}