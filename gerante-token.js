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

const user1 = {
  user_id: 1,
  domain: 'minhaempresa.com',
  tenant: 'minhaempresa',
  canais: [2],
  departamentos: [5],
  operador_id: 1,
};

const tokenUser1 = geranteToken(
  {
    iat: Math.floor(Date.now() / 1000), // emitido em
    sub: user1.user_id, // assunto
    aud: user1.tenant, // audiência
    iss: user1.domain, // emissor
    jti: `${user1.user_id}-${Date.now()}`, // ID do token
    tenant: user1.tenant,
    canais: user1.canais,
    departamentos: user1.departamentos,
    operador_id: user1.operador_id,
  },
  JWT_SECRET
);

console.log('Token gerado para User 1:');
console.log(tokenUser1);

const user2 = {
  user_id: 2,
  domain: 'minhaempresa.com',
  tenant: 'minhaempresa',
  canais: [1, 2, 3, 4, 5],
  departamentos: [1, 2],
  operador_id: 2,
};

const tokenUser2 = geranteToken(
  {
    iat: Math.floor(Date.now() / 1000),
    sub: user2.user_id,
    aud: user2.tenant,
    iss: user2.domain,
    jti: `${user2.user_id}-${Date.now()}`,
    tenant: user2.tenant,
    canais: user2.canais,
    departamentos: user2.departamentos,
    operador_id: user2.operador_id,
  },
  JWT_SECRET
);

console.log('\nToken gerado para User 2:');
console.log(tokenUser2);

