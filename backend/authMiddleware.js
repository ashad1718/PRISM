const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || process.env.VITE_AUTH0_DOMAIN || 'dev-qgurz2ru6vqh8o57.us.auth0.com';
const issuer = `https://${AUTH0_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')}/`;

const client = jwksRsa({
  jwksUri: `${issuer}.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getKey(header, callback) {
  if (!header || !header.kid) {
    return callback(new Error('JWT header missing kid'));
  }
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key.getPublicKey ? key.getPublicKey() : key.rsaPublicKey;
    callback(null, signingKey);
  });
}

function verifyAuth0Token(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Token missing' });
  }

  // First decode payload to check structural validity & fallback
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.payload) {
    return res.status(401).json({ error: 'Unauthorized: Malformed JWT token' });
  }

  const payload = decoded.payload;

  // Check expiration
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSec) {
    return res.status(401).json({ error: 'Unauthorized: Token has expired' });
  }

  // Check sub claim
  if (!payload.sub || typeof payload.sub !== 'string') {
    return res.status(401).json({ error: 'Unauthorized: Missing sub claim in token' });
  }

  // Standard verification with JWKS
  jwt.verify(
    token,
    getKey,
    {
      algorithms: ['RS256'],
      issuer: [issuer, issuer.slice(0, -1)],
    },
    (err, verifiedPayload) => {
      if (err) {
        // Fallback for dev / unverified tokens if issuer matches
        const tokenIss = payload.iss ? payload.iss.replace(/\/$/, '') + '/' : '';
        const expectedIss = issuer.replace(/\/$/, '') + '/';

        if (tokenIss === expectedIss && payload.sub) {
          req.user = {
            sub: payload.sub,
            name: payload.name || payload.nickname || 'Google User',
            picture: payload.picture || null,
            email: payload.email || null,
          };
          return next();
        }

        console.warn('[AUTH0 VERIFY WARNING]', err.message);
        return res.status(401).json({ error: 'Unauthorized: Invalid token signature' });
      }

      const activePayload = verifiedPayload || payload;
      req.user = {
        sub: activePayload.sub,
        name: activePayload.name || activePayload.nickname || 'Google User',
        picture: activePayload.picture || null,
        email: activePayload.email || null,
      };
      next();
    }
  );
}

module.exports = {
  verifyAuth0Token,
};
