# Safe Socket

Projeto de estudo focado em **segurança e isolamento de sockets** usando Socket.IO, JWT e multi-tenancy.

## Objetivo

Treinar e implementar boas práticas de segurança em aplicações real-time:

- **Autenticação JWT** no handshake
- **Isolamento por tenant** (multi-tenancy seguro)
- **Rooms namespaced** para evitar vazamento de dados
- **Rate limiting** por socket
- **Validação de permissões** antes de enviar eventos

## Arquitetura

### Servidor (`server.js`)

- Valida JWT no handshake e extrai `tenant` e `user_id`
- Cria rooms isoladas por tenant: `t:tenant:user:123`, `t:tenant:canal:5`, etc
- Garante que mensagens nunca vazam entre tenants
- Rate limit de 30 eventos/segundo por socket

### Cliente (`public/index.html`)

Interface de teste que permite:
- Conectar múltiplas abas simultâneas
- Enviar mensagens para usuários ou canais específicos
- Visualizar eventos recebidos em tempo real
- Testar isolamento entre abas/usuários

## Instalação

```bash
npm install
```

## Configuração

Crie um arquivo `.env`:

```env
PORT=8082
JWT_SECRET=sua-chave-secreta-aqui
CORS_ORIGINS=http://localhost:8082
```

## Gerando Tokens de Teste

```bash
node gerante-token.js
```

O script gera **2 tokens automaticamente** (User 1 e User 2) prontos para testar comunicação entre usuários.

**User 1:**
- `user_id`: 1
- `canais`: [2]
- `departamentos`: [5]
- `operador_id`: 1

**User 2:**
- `user_id`: 2
- `canais`: [1, 2, 3, 4, 5]
- `departamentos`: [1, 2]
- `operador_id`: 2

Edite `gerante-token.js` para criar usuários de diferentes tenants ou personalizar permissões

## Executando

```bash
npm start
```

Acesse: `http://localhost:8082`

## Como Testar

1. Execute `node gerante-token.js` para gerar 2 tokens (User 1 e User 2)
2. Abra 2 abas do navegador em `http://localhost:8082`
3. Cole o token do User 1 na primeira aba e conecte
4. Cole o token do User 2 na segunda aba e conecte
5. Na Aba 1 (User 1): informe `user_id` = 2 e envie uma mensagem
6. Veja a mensagem chegando apenas na Aba 2 (isolamento funcionando)

### Testando Canais

- User 1 e User 2 compartilham o canal 2
- Envie mensagem para `canal_id` = 2 e veja ambas as abas receberem

### Testando Isolamento por Tenant

- Edite `gerante-token.js` e mude o `tenant` de um usuário
- Conecte em abas separadas
- Tente enviar mensagens entre tenants → não devem chegar (isolamento OK)

## Estrutura de Rooms

```
t:tenant                    → todos do tenant
t:tenant:user:123           → usuário específico
t:tenant:canal:5            → canal específico
t:tenant:dept:10            → departamento específico
t:tenant:op:42              → operador específico
```

O prefixo `t:tenant` garante que eventos nunca cruzem entre clientes/empresas diferentes.

## Segurança

- ✅ JWT verificado antes de aceitar conexão
- ✅ Rate limiting por socket
- ✅ Rooms isoladas por tenant
- ✅ Validação de permissões (canais, departamentos)
- ✅ Emissor não recebe próprias mensagens
- ✅ CORS configurável
