const jwt = require('jsonwebtoken');
require('dotenv').config();

function geranteToken(payload, secret, options = {}) {
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: '1h',
    ...options,
  });
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não definido no .env');
}

const user = {
  user_id: 2,
  domain: 'minhaempresa.com',
  tenant: 'minhaempresa',
  canais: [1, 2],
  departamentos: [5],
  operador_id: 42,
};

const token = geranteToken(
  {
    iat: Math.floor(Date.now() / 1000), // emitido em
    sub: user.user_id, // assunto
    aud: user.tenant, // audiência
    iss: user.domain, // emissor
    jti: `${user.user_id}-${Date.now()}`, // ID do token
    tenant: user.tenant,
    canais: user.canais,
    departamentos: user.departamentos,
    operador_id: user.operador_id,
  },
  JWT_SECRET
);

console.log('Token gerado:');
console.log(token);
