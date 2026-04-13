'use client'

import { useState } from 'react'

interface SupportScreenProps {
  onClose: () => void
}

const CASHAPP = '$PourListPDX'
const VENMO = '@PourListPDX'

export default function SupportScreen({ onClose }: SupportScreenProps) {
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
            The Pour List is built and maintained by a small team who believes every Portland happy hour deserves to be documented. If this app helped you find a good deal tonight, we'd genuinely appreciate the support.
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

          {/* Crypto notice */}
          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center">
              Crypto preferred? USDC, BTC, ETH, Sui → check the app settings for wallet addresses.
            </p>
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