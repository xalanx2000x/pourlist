#!/usr/bin/env node
/**
 * Run schema-v2.sql directly against Supabase Postgres.
 * Usage: node scripts/run-schema.js
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

// Get connection string from env or construct it
const dbUrl = process.env.DATABASE_URL ||
  `postgresql://postgres:${process.env.SUPABASE_DB_PASSWORD}@db.${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('https://', '')}:5432/postgres`

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

const schema = readFileSync(resolve('./schema-v2.sql'), 'utf8')

// Split on semicolons, filter empty lines
const statements = schema
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))

async function run() {
  const client = await pool.connect()
  const results = []

  for (const stmt of statements) {
    try {
      await client.query(stmt + ';')
      results.push(`✅ ${stmt.slice(0, 60)}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // "already exists" is OK — treat as success
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        results.push(`✅ [already exists] ${stmt.slice(0, 50)}`)
      } else {
        results.push(`❌ ${stmt.slice(0, 60)}: ${msg}`)
      }
    }
  }

  client.release()
  await pool.end()

  console.log('\n=== Schema run results ===')
  results.forEach(r => console.log(r))
}

run().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
