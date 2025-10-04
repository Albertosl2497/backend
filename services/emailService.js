// backend/services/emailService.js
var nodemailer = require("nodemailer");

/*
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

// Lee configuración con defaults seguros
var PROVIDER   = String(process.env.SMTP_PROVIDER || "gmail").toLowerCase();
var EMAIL_USER = process.env.SMTP_USER || "sorteosmg1@gmail.com";
var EMAIL_PASS = process.env.SMTP_PASS || "alppsrtmecmfksjl"; // pásala a ENV cuando puedas
var EMAIL_FROM = process.env.EMAIL_FROM || ('"Rifas" <' + EMAIL_USER + '>');
var DEFAULT_CC = process.env.EMAIL_CC || "sorteosmg1@gmail.com";

var SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 8000);
var MAX_RETRIES     = Number(process.env.EMAIL_MAX_RETRIES || 3);
var BACKOFF_BASE_MS = Number(process.env.EMAIL_BACKOFF_BASE_MS || 600);

var SMTP_HOST   = process.env.SMTP_HOST || "smtp.gmail.com";
var SMTP_PORT   = Number(process.env.SMTP_PORT || 587);
var SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

function buildTransporter() {
  var common = {
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 7000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  };

  if (PROVIDER === "gmail") {
    // No usar sintaxis moderna para máxima compatibilidad
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      pool: common.pool,
      maxConnections: common.maxConnections,
      maxMessages: common.maxMessages,
      connectionTimeout: common.connectionTimeout,
      greetingTimeout: common.greetingTimeout,
      socketTimeout: common.socketTimeout,
      auth: common.auth
    });
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    pool: common.pool,
    maxConnections: common.maxConnections,
    maxMessages: common.maxMessages,
    connectionTimeout: common.connectionTimeout,
    greetingTimeout: common.greetingTimeout,
    socketTimeout: common.socketTimeout,
    auth: common.auth
  });
}

var transporter = buildTransporter();

// Verificación no bloqueante al iniciar
(function verifyOnce() {
  transporter.verify()
    .then(function () { console.log("[email] SMTP listo (" + PROVIDER + ")"); })
    .catch(function (err) { console.error("[email] SMTP NO disponible al inicio:", (err && err.message) || err); });
})();

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isTransient(err) {
  var msg = "";
  if (err && err.code) msg += String(err.code).toUpperCase() + " ";
  if (err && err.message) msg += String(err.message).toUpperCase();
  return (
    msg.indexOf("ETIMEDOUT") >= 0 ||
    msg.indexOf("ECONNRESET") >= 0 ||
    msg.indexOf("ECONNECTION") >= 0 ||
    msg.indexOf("EHOSTUNREACH") >= 0 ||
    msg.indexOf("ESOCKET") >= 0 ||
    msg.indexOf("EAI_AGAIN") >= 0 ||
    msg.indexOf("ETIMEOUT") >= 0 ||
    msg.indexOf("EAUTH") >= 0 ||
    msg.indexOf("ENOTFOUND") >= 0
  );
}

function isValidEmail(e) {
  e = String(e || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// --- Core de envío con timeouts y reintentos (bloqueante internamente) ---
function sendEmailInternal(opts) {
  return new Promise(function (resolve, reject) {
    if (!isValidEmail(opts.to)) return reject(new Error("EMAIL_INVALID_TO"));
    if (!EMAIL_USER || !EMAIL_PASS) return reject(new Error("EMAIL_CREDENTIALS_MISSING"));

    var mailOptions = {
      from: EMAIL_FROM,
      to: opts.to,
      cc: (typeof opts.cc !== "undefined" && opts.cc !== null) ? opts.cc : DEFAULT_CC,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      bcc: opts.bcc,
      attachments: opts.attachments
    };

    var attempt = 0;
    var lastError = null;

    function tryOnce() {
      var timedOut = false;

      var timeoutId = setTimeout(function () {
        timedOut = true;
        // nodemailer no tiene cancelación nativa; simulamos timeout
        reject(new Error("EMAIL_TIMEOUT"));
      }, SEND_TIMEOUT_MS);

      transporter.sendMail(mailOptions, function (err, info) {
        clearTimeout(timeoutId);
        if (timedOut) return; // ya rechazamos por timeout

        if (err) {
          lastError = err;
          attempt += 1;
          var retry = attempt <= MAX_RETRIES && isTransient(err);
          console.warn("[email] intento " + attempt + " falló:", (err && err.message) || err, "| retry=" + retry);
          if (!retry) {
            return reject(new Error((lastError && lastError.message) || "EMAIL_SEND_FAILED"));
          }
          var delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
          sleep(delay).then(function () {
            // reconstruimos el transporter por si la conexión quedó rota
            transporter = buildTransporter();
            transporter.verify().catch(function () { /* ignore */ });
            tryOnce();
          });
        } else {
          var messageId = (info && info.messageId) ? info.messageId : null;
          console.log("[email] OK → " + opts.to + " (id: " + (messageId || "n/a") + ")");
          resolve({ ok: true, messageId: messageId });
        }
      });
    }

    tryOnce();
  });
}

/**
 * API pública NO BLOQUEANTE con la MISMA FIRMA que usabas:
 *   sendEmail(to, subject, text)
 *
 * - Dispara el envío en background y devuelve inmediatamente:
 *     Promise.resolve({ ok: true, queued: true })
 * - No rompe tus rutas (aunque hagan `await sendEmail(...)`, retorna al instante).
 */
function sendEmail(to, subject, text) {
  // Ejecuta en background; captura y loguea errores sin reventar la request
  sendEmailInternal({ to: to, subject: subject, text: text })
    .catch(function (err) {
      console.error("[email] async error:", (err && err.message) || err);
    });

  // Respuesta inmediata (no bloquea la ruta)
  return Promise.resolve({ ok: true, queued: true });
}

module.exports = { sendEmail };
