// Admin Authorization Middleware for PRISM Backend
// Verifies requesting wallet against Solana on-chain PRISM config authority

const KNOWN_PRISM_AUTHORITY = 'Ea3TNJEQs4HDaY5xdsJHnQWG4XdfsWMBqNYTeASW1mj7';
const CONFIG_PDA_ADDRESS = 'Dmjps57FvuB9xE6NvXmdYhiC5EJE7ZpYsAyqbpszAUSs';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

let cachedAuthority = KNOWN_PRISM_AUTHORITY;
let lastAuthorityCheckTs = 0;

async function fetchOnChainAuthority() {
  const now = Date.now();
  if (now - lastAuthorityCheckTs < 60000 && cachedAuthority) {
    return cachedAuthority;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [CONFIG_PDA_ADDRESS, { encoding: 'base64' }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const accountData = data?.result?.value?.data?.[0];
      if (accountData) {
        const rawBuffer = Buffer.from(accountData, 'base64');
        if (rawBuffer.length >= 40) {
          const authorityBytes = rawBuffer.subarray(8, 40);
          try {
            const bs58Module = require('bs58');
            const base58Str = bs58Module.encode ? bs58Module.encode(authorityBytes) : bs58Module.default.encode(authorityBytes);
            if (base58Str) {
              cachedAuthority = base58Str;
              lastAuthorityCheckTs = now;
              return cachedAuthority;
            }
          } catch {
            // Fallback
          }
        }
      }
    }
  } catch (err) {
    // Ignore RPC timeout/fetch error
  }

  return KNOWN_PRISM_AUTHORITY;
}

async function verifyAdminAuth(req, res, next) {
  const adminWallet =
    req.headers['x-admin-wallet'] ||
    req.headers['x-admin-address'] ||
    req.query.admin_wallet;

  if (!adminWallet || typeof adminWallet !== 'string') {
    return res.status(401).json({
      error: 'Unauthorized: Missing admin wallet identity in x-admin-wallet header',
    });
  }

  const trimmedWallet = adminWallet.trim();

  // Fast-path: If requesting wallet is the known on-chain PRISM admin, authorize immediately
  if (trimmedWallet === KNOWN_PRISM_AUTHORITY) {
    req.adminWallet = trimmedWallet;
    return next();
  }

  // Otherwise check dynamically loaded on-chain authority
  const onChainAuthority = await fetchOnChainAuthority();

  if (trimmedWallet !== onChainAuthority) {
    return res.status(403).json({
      error: 'Forbidden: Requesting wallet is not an authorized PRISM admin',
    });
  }

  req.adminWallet = trimmedWallet;
  next();
}

module.exports = {
  verifyAdminAuth,
  KNOWN_PRISM_AUTHORITY,
};
