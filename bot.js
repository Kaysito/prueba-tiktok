const { WebcastPushConnection } = require('tiktok-live-connector');
const Pusher = require('pusher');

// ─── CONFIG ───
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

const tiktokUsername = process.env.TIKTOK_USERNAME || "lindaaani";
let tiktokConnection = new WebcastPushConnection(tiktokUsername);

// Cache de formatter (MUY importante para rendimiento)
const timeFormatter = new Intl.DateTimeFormat("es", {
  hour: "2-digit",
  minute: "2-digit"
});

let reconnectDelay = 5000;

// ─── FUNCIONES ───
function getTime() {
  return timeFormatter.format(Date.now());
}

// Generador de ID más rápido
let idCounter = 0;
function generateId() {
  return ++idCounter;
}

function connectToTikTok() {
  console.log(`🔎 Intentando conectar a TikTok: @${tiktokUsername}...`);

  tiktokConnection.connect()
    .then(state => {
      console.log(`🟢 MOTOR ONLINE: Live ID ${state.roomId}`);
      reconnectDelay = 5000; // reset delay
    })
    .catch(err => {
      console.error(`🔴 Error: ${err.message}`);
      
      // Backoff exponencial (mejor para Railway)
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
      setTimeout(connectToTikTok, reconnectDelay);
    });
}

// ─── ENVÍO OPTIMIZADO ───
function sendToPusher(event, payload) {
  // No bloquea el hilo
  setImmediate(() => {
    pusher.trigger('interactivos', event, payload)
      .catch(e => console.error("Pusher Error:", e));
  });
}

// ─── EVENTOS ───
tiktokConnection.on('chat', data => {
  const payloadChat = {
    id: generateId(),
    author: data.nickname || data.uniqueId,
    text: data.comment,
    foto: data.profilePictureUrl,
    time: getTime(),
    isTikTok: true,
    isSystem: false
  };

  sendToPusher('nuevo-mensaje-tiktok', payloadChat);
});

tiktokConnection.on('gift', data => {
  if (data.giftType === 1 && !data.repeatEnd) return;

  const payloadRegalo = {
    id: generateId(),
    author: data.nickname || data.uniqueId,
    text: `🎁 ¡Envió ${data.repeatCount}x ${data.giftName}!`,
    foto: data.profilePictureUrl,
    time: getTime(),
    isTikTok: true,
    isSystem: true
  };

  console.log(`🎁 ${payloadRegalo.author} → ${data.giftName}`);
  sendToPusher('nuevo-mensaje-tiktok', payloadRegalo);
});

// ─── RECONEXIÓN ───
tiktokConnection.on('disconnected', () => {
  console.log('⚠️ Desconectado. Reintentando...');
  setTimeout(connectToTikTok, reconnectDelay);
});

tiktokConnection.on('error', err => {
  console.error('❌ Error TikTok:', err);
});

// ─── START ───
connectToTikTok();
