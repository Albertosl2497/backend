// backend/services/emailService.js
const nodemailer = require("nodemailer");

/*
  Sin depender de cambios en rutas.
  - Misma firma: sendEmail(to, subject, text)
  - No bloquea: devuelve inmediatamente { ok: true, queued: true }
  - Reintentos con backoff, pool y timeouts para robustez.
  - Lee ENV si existen; si no, usa tus valores actuales para que funcione ya.
    ENV opcionales:
      SMTP_PROVIDER=gmail | smtp
      SMTP_USER=...
      SMTP_PASS=...
      SMTP_HOST=smtp.gmail.com
      SMTP_PORT=587
      SMTP_SECURE=false
      EMAIL_FROM="Rifas" <tu@correo>
      EMAIL_CC=tu@correo
      EMAIL_SEND_TIMEOUT_MS=8000
      EMAIL_MAX_RETRIES=3
      EMAIL_BACKOFF_BASE_MS=600
*/

const PROVIDER   = (process.env.SMTP_PROVIDER || "gmail").toLowerCase();
const EMAIL_USER = process.env.SMTP_USER || "sorteosmg1@gmail.com";
const EMAIL_PASS = process.env.SMTP_PASS || "alppsrtmecmfksjl"; // ← tu App Password; pásala a ENV cuando puedas
const EMAIL_FROM = process.env.EMAIL_FROM || `"Rifas" <${EMAIL_USER}>`;
const DEFAULT_CC = process.env.EMAIL_CC || "sorteosmg1@gmail.com";

const SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 8000);
const MAX_RETRIES     = Number(process.env.EMAIL_MAX_RETRIES || 3);
const BACKOFF_BASE_MS = Number(process.env.EMAIL_BACKOFF_BASE_MS || 600);

const SMTP_HOST   = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT   = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

function buildTransporter() {
  const common = {
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 7000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  };

  if (PROVIDER === "gmail") {
    return nodemailer.createTransport({
      ...common,
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
    });
  }

  return nodemailer.createTransport({
    ...common,
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
  });
}

let transporter = buildTransporter();

// Chequeo de salud al iniciar (no bloquea la app)
(async () => {
  try {
    await transporter.verify();
    console.log(`[email] SMTP listo (${PROVIDER})`);
  } catch (err) {
    console.error("[email] SMTP NO disponible al inicio:", err.message);
  }
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (err) => {
  const m = (err && (err.code || err.message || "")).toString().toUpperCase();
  return ["ETIMEDOUT","ECONNRESET","ECONNECTION","EHOSTUNREACH","ESOCKET","EAI_AGAIN","ETIMEOUT","EAUTH","ENOTFOUND"]
    .some(k => m.includes(k));
};
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());

async function sendEmailInternal({ to, subject, text, html, cc }) {
  if (!isValidEmail(to)) throw new Error("EMAIL_INVALID_TO");
  if (!EMAIL_USER || !EMAIL_PASS) throw new Error("EMAIL_CREDENTIALS_MISSING");

  const mailOptions = {
    from: EMAIL_FROM,
    to,
    cc: cc ?? DEFAULT_CC,
    subject,
    text,
    html,
  };

  let attempt = 0, lastError = null;

  while (attempt <= MAX_RETRIES) {
    try {
      const sendPromise = transporter.sendMail(mailOptions);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("EMAIL_TIMEOUT")), SEND_TIMEOUT_MS)
      );
      const info = await Promise.race([sendPromise, timeoutPromise]);
      console.log(`[email] OK → ${to} (id: ${info?.messageId || "n/a"})`);
      return { ok: true, messageId: info?.messageId || null };
    } catch (err) {
      lastError = err;
      attempt += 1;
      const retry = attempt <= MAX_RETRIES && isTransient(err);
      console.warn(`[email] intento ${attempt} falló: ${err.message || err} | retry=${retry}`);
      if (!retry) break;
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
      try { transporter = buildTransporter(); await transporter.verify(); } catch {}
    }
  }

  throw new Error(lastError?.message || "EMAIL_SEND_FAILED");
}

/**
 * NO BLOQUEANTE (misma firma de tu proyecto):
 *   sendEmail(to, subject, text)
 * - Dispara el envío en background y retorna de inmediato.
 * - No necesitas cambiar ni una sola línea en tus rutas actuales.
 */
function sendEmail(to, subject, text) {
  // Ejecutar en background y jamás bloquear al caller
  sendEmailInternal({ to, subject, text })
    .catch(err => console.error("[email] async error:", err.message || err));

  // Respuesta inmediata para el código que invoca (aunque haga await)
  return Promise.resolve({ ok: true, queued: true });
}

module.exports = { sendEmail };
