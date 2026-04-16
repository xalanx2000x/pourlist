'use client'

import { useState } from 'react'

interface SupportScreenProps {
  onClose: () => void
}

const CASHAPP = '$heretothere23'
const VENMO = 'tymyry'

// Crypto addresses
const SOLANA_USDC = 'FwVypWB9tw8UaCqKiLLA2Qh6TdNZRJ1cfvb1dHncrCb8'
const ETHEREUM = '0xBBD2f38BE6B6C38B8286632e7a6449DabE9Ea265'
const BITCOIN = 'bc1qhfz8ztjgfh2kgdvl36n0sps0gdvq5qk8u5ezu8'
const SUI = '0x390e39e9fd82481f961714dc7e6b8d34c55163c730df7a2bf300754be4971977'

type CryptoId = 'solana' | 'ethereum' | 'bitcoin' | 'sui'

export default function SupportScreen({ onClose }: SupportScreenProps) {
  const [copied, setCopied] = useState<CryptoId | null>(null)

  const copyAddress = (address: string, id: CryptoId) => {
    navigator.clipboard.writeText(address)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-end justify-center">
      <div className="bg-white w-full max-w-md rounded-t-3xl shadow-2xl overflow-hidden">
        {/* Accent bar */}
        <div className="h-1 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Enjoying the happy hour?</h2>
              <p className="text-sm text-gray-500 mt-1">Tip the developers — even $1 keeps the servers running.</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1"
            >
              ×
            </button>
          </div>

          {/* Message */}
          <p className="text-gray-700 text-center text-sm mb-6 leading-relaxed">
            The Pour List is built and maintained by Tyler and Alan who believe local knowledge is living knowledge and rely on your reports.
          </p>

          {/* Payment options */}
          <div className="space-y-3">
            {/* Cash App */}
            <a
              href={`https://cash.app/${CASHAPP}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 w-full p-4 border-2 border-green-500 rounded-2xl hover:bg-green-50 transition-colors active:bg-green-100"
            >
              <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-xs">$</span>
              </div>
              <div className="text-left flex-1">
                <p className="font-semibold text-gray-900">Cash App</p>
                <p className="text-green-600 font-mono text-sm">{CASHAPP}</p>
              </div>
              <span className="text-green-500 text-sm font-semibold">→</span>
            </a>

            {/* Venmo */}
            <a
              href={`https://venmo.com/${VENMO}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 w-full p-4 border-2 border-blue-500 rounded-2xl hover:bg-blue-50 transition-colors active:bg-blue-100"
            >
              <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-xs">V</span>
              </div>
              <div className="text-left flex-1">
                <p className="font-semibold text-gray-900">Venmo</p>
                <p className="text-blue-600 font-mono text-sm">@{VENMO}</p>
              </div>
              <span className="text-blue-500 text-sm font-semibold">→</span>
            </a>
          </div>

          {/* Crypto section */}
          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center mb-3">Crypto preferred?</p>
            <div className="space-y-2">
              {/* Solana USDC */}
              <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                <span className="text-lg">⚡</span>
                <div className="flex-1 text-left">
                  <p className="text-xs font-semibold text-gray-700">Solana <span className="text-gray-400 font-normal">USDC</span></p>
                  <p className="text-xs text-gray-500 font-mono truncate">{SOLANA_USDC}</p>
                </div>
                <div className="flex gap-1">
                  <a
                    href={`solana:${SOLANA_USDC}?token=EPjFWdd5AufqSSqeM2qNksxNasVMfx3EGbNJAfDqEpump`}
                    className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-gray-600 transition-colors"
                    title="Open in wallet"
                  >
                    →
                  </a>
                  <button
                    onClick={() => copyAddress(SOLANA_USDC, 'solana')}
                    className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-gray-600 transition-colors"
                  >
                    {copied === 'solana' ? '✓' : 'copy'}
                  </button>
                </div>
              </div>

              {/* Ethereum */}
              <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                <span className="text-lg">Ξ</span>
                <div className="flex-1 text-left">
                  <p className="text-xs font-semibold text-gray-700">Ethereum <span className="text-gray-400 font-normal">ETH</span></p>
                  <p className="text-xs text-gray-500 font-mono truncate">{ETHEREUM}</p>
                </div>
                <div className="flex gap-1">
                  <a
                    href={`ethereum:${ETHEREUM}`}
                    className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-gray-600 transition-colors"
                    title="Open in wallet"
                  >
                    →
                  </a>
                  <button
                    onClick={() => copyAddress(ETHEREUM, 'ethereum')}
                    className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-gray-600 transition-colors"
                  >
                    {copied === 'ethereum' ? '✓' : 'copy'}
                  </button>
                </div>
              </div>

              {/* Bitcoin */}
              <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                <span className="text-lg">₿</span>
                <div className="flex-1 text-left">
                  <p className="text-xs font-semibold text-gray-700">Bitcoin <span className="text-gray-400 font-normal">BTC</span></p>
                  <p className="text-xs text-gray-500 font-mono truncate">{BITCOIN}</p>
                </div>
                <button
                  onClick={() => copyAddress(BITCOIN, 'bitcoin')}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-gray-600 transition-colors"
                >
                  {copied === 'bitcoin' ? '✓' : 'copy'}
                </button>
              </div>

              {/* Sui */}
              <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                <span className="text-lg">◇</span>
                <div className="flex-1 text-left">
                  <p className="text-xs font-semibold text-gray-700">Sui <span className="text-gray-400 font-normal">SUI</span></p>
                  <p className="text-xs text-gray-500 font-mono truncate">{SUI}</p>
                </div>
                <button
                  onClick={() => copyAddress(SUI, 'sui')}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-gray-600 transition-colors"
                >
                  {copied === 'sui' ? '✓' : 'copy'}
                </button>
              </div>
            </div>
          </div>

          {/* $1 suggestion */}
          <div className="mt-4 text-center">
            <p className="text-xs text-gray-400">Suggested tip: <span className="font-semibold text-gray-600">$1</span></p>
          </div>
        </div>
      </div>
    </div>
  )
}
