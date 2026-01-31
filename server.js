require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const path = require("path");

// ============ Logger ============
function log(level, msg, fields = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    service: "socket-server",
    ...fields,
  };
  console.log(JSON.stringify(line));
}

// ============ Config ============
const PORT = Number(process.env.PORT || 8082);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não definido no .env");
}

const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ============ App/Server ============
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

if (CORS_ORIGINS.length) {
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
} else {
  app.use(cors());
}

const server = http.createServer(app);

const io = new Server(server, {
  transports: ["websocket"],
  cors: CORS_ORIGINS.length
    ? {
        origin: CORS_ORIGINS,
        methods: ["GET", "POST"],
        allowedHeaders: ["Authorization", "Content-Type"],
        credentials: true,
      }
    : { origin: "*" },
});

// ============ Helpers ============

// Normaliza domínio/tenant (evita www., maiúsculas etc.)
function normalizeTenant(tenant) {
  if (!tenant || typeof tenant !== "string") return null;
  return tenant.trim().toLowerCase().replace(/^www\./, "");
}

// Rooms namespaced por tenant => impede vazamento por erro humano
const room = {
  tenant: (t) => `t:${t}`,
  canal: (t, id) => `t:${t}:canal:${id}`,
  dept: (t, id) => `t:${t}:dept:${id}`,
  op: (t, id) => `t:${t}:op:${id}`,
  user: (t, id) => `t:${t}:user:${id}`,
};

// Rate limit simples por socket (por segundo)
function attachRateLimit(socket, { windowMs = 1000, max = 25 } = {}) {
  let count = 0;
  let windowStart = Date.now();

  socket.use((packet, next) => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count++;
    if (count > max) {
      const user = socket.user || {};
      log("warn", "rate_limit.exceeded", {
        socketId: socket.id,
        maxPerSec: max,
        tenant: user.tenant,
        userId: user.id,
      });
      return next(new Error("rate_limit_exceeded"));
    }
    next();
  });
}

function isIntArray(a) {
  return Array.isArray(a) && a.every(n => Number.isInteger(n));
}

// ============ Auth middleware (Handshake) ============
io.use((socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

    if (!token) {
      log("warn", "auth.failed.no_token", { socketId: socket.id });
      return next(new Error("unauthorized"));
    }

    const claims = jwt.verify(token, JWT_SECRET);

    // Esperado: claims.tenant (domínio/tenant), claims.sub (user id)
    const tenant = normalizeTenant(claims.tenant);
    const userId = claims.sub;

    if (!tenant) {
      log("warn", "auth.failed.tenant_missing", { socketId: socket.id });
      return next(new Error("tenant_missing"));
    }
    if (!userId) {
      log("warn", "auth.failed.user_id_missing", { socketId: socket.id, tenant });
      return next(new Error("sub_missing"));
    }

    // Anexa identidade "confiável" no socket
    socket.user = {
      id: userId,
      tenant,
      role: claims.role || "user",
      // Ideal: esses arrays vêm do token OU você busca no backend
      canais: isIntArray(claims.canais) ? claims.canais : [],
      departamentos: isIntArray(claims.departamentos) ? claims.departamentos : [],
      operadorId: Number.isInteger(claims.operador_id) ? claims.operador_id : null,
    };

    socket.loggedAt = Date.now();

    next();
  } catch (e) {
    log("error", "auth.failed.invalid_jwt", {
      socketId: socket.id,
      error: e.message,
      ip: socket.handshake.address,
      ua: socket.handshake.headers["user-agent"],
    });
    next(new Error("unauthorized"));
  }
});

// ============ Connection ============
io.on("connection", (socket) => {
  attachRateLimit(socket, { windowMs: 1000, max: 30 });

  const t = socket.user.tenant;

  // Room base do tenant (útil pra eventos gerais do cliente)
  socket.join(room.tenant(t));

  // Rooms por dimensão (namespaced)
  socket.join(room.user(t, socket.user.id));

  if (socket.user.operadorId) {
    socket.join(room.op(t, socket.user.operadorId));
  }

  for (const canalId of socket.user.canais) {
    socket.join(room.canal(t, canalId));
  }

  for (const deptId of socket.user.departamentos) {
    socket.join(room.dept(t, deptId));
  }

  socket.emit("ready", {
    tenant: t,
    userId: socket.user.id,
    role: socket.user.role,
  });

  log("audit", "connection.established", {
    socketId: socket.id,
    tenant: t,
    userId: socket.user.id,
    role: socket.user.role,
    ip: socket.handshake.address,
  });

  // ======== Eventos do client (exemplos seguros) ========

  socket.on("ping", () => {
    socket.emit("pong", Date.now());
    log("debug", "message.ping", {
      socketId: socket.id,
      tenant: t,
      userId: socket.user.id,
    });
  });

  socket.on("message", ({ to_user_id, to_canal_id, to_departamento_id, message }) => {
    if (typeof message !== "string") {
      log("warn", "message.rejected.invalid_type", {
        socketId: socket.id,
        tenant: t,
        userId: socket.user.id,
        messageType: typeof message,
      });
      return;
    }
    if (message.length > 500) {
      log("warn", "message.rejected.too_long", {
        socketId: socket.id,
        tenant: t,
        userId: socket.user.id,
        length: message.length,
      });
      return;
    }
    if (
      !Number.isInteger(to_user_id) &&
      !Number.isInteger(to_canal_id) &&
      !Number.isInteger(to_departamento_id) &&
      socket.user.role !== "admin"
    ) {
      log("warn", "message.rejected.no_target", {
        socketId: socket.id,
        tenant: t,
        userId: socket.user.id,
        to_user_id,
        to_canal_id,
        to_departamento_id,
      });
      return;
    }
    // autorização simples: canal alvo precisa estar nos canais do usuário
    if (Number.isInteger(to_canal_id) && to_canal_id > 0) {
      if (!socket.user.canais.includes(to_canal_id) && socket.user.role !== "admin") {
        log("warn", "message.denied.channel_unauthorized", {
          socketId: socket.id,
          tenant: t,
          userId: socket.user.id,
          canalId: to_canal_id,
        });
        return;
      }
    }
    if (Number.isInteger(to_departamento_id) && to_departamento_id > 0) {
      if (!socket.user.departamentos.includes(to_departamento_id) && socket.user.role !== "admin") {
        log("warn", "message.denied.department_unauthorized", {
          socketId: socket.id,
          tenant: t,
          userId: socket.user.id,
          departamentoId: to_departamento_id,
        });
        return;
      }
    }
    // constrói payload da mensagem
    const payload = {
      from_user_id: socket.user.id,
      message,
      timestamp: Date.now(),
    };
    let emitter = null;
    let target = null;
    if (Number.isInteger(to_user_id) && to_user_id > 0) {
      emitter = room.user(t, to_user_id);
      target = { userId: to_user_id };
    } else if (Number.isInteger(to_canal_id) && to_canal_id > 0) {
      emitter = room.canal(t, to_canal_id);
      target = { canalId: to_canal_id };
    } else if (Number.isInteger(to_departamento_id) && to_departamento_id > 0) {
      emitter = room.dept(t, to_departamento_id);
      target = { departamentoId: to_departamento_id };
    } else if (socket.user.role === "admin") {
      // admin broadcast
      emitter = room.tenant(t);
      target = { broadcast: true };
    }
    if (!emitter) return;

    // envia ignorando o remetente
    socket.to(emitter).emit("message", payload);

    // notifica o remetente que a mensagem foi enviada
    socket.emit("message:sent", payload);

    // auditoria
    log("audit", "message.sent", {
      socketId: socket.id,
      tenant: t,
      userId: socket.user.id,
      target,
      messageLength: message.length,
    });
  });

  socket.on("disconnect", (reason) => {
    let connectionDuration = null;
    if (socket.loggedAt) {
      const logoutAt = Date.now();
      connectionDuration = (((logoutAt - socket.loggedAt) / 1000) / 60).toFixed(2); // em minutos
    }

    log("audit", "connection.closed", {
      socketId: socket.id,
      tenant: t,
      userId: socket.user.id,
      durationMin: connectionDuration,
      reason,
    });
  });
});

// ============ Emissão “segura” (helpers) ============

app.get("/", (req, res) => {
  const file = path.resolve(__dirname, "public", "index.html");
  res.sendFile(file);
});

server.listen(PORT, () => {
  log("info", "server.started", { port: PORT });
});
