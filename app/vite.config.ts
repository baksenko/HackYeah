import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    // @coral-xyz/anchor and @solana/web3.js expect Node's Buffer/process to
    // exist. Without these shims the app fails at runtime in the browser.
    nodePolyfills({ include: ['buffer', 'process', 'crypto', 'stream', 'util', 'vm'], globals: { Buffer: true, process: true } }),
  ],
})
