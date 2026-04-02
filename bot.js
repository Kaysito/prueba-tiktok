const { WebcastPushConnection } = require('tiktok-live-connector');
const Pusher = require('pusher');

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

const tiktokUsername = process.env.TIKTOK_USERNAME || "lindaaani";
let tiktokConnection = new WebcastPushConnection(tiktokUsername);

// Función para conectar con manejo de errores
function connectToTikTok() {
    tiktokConnection.connect().then(state => {
        console.log(`🟢 CONECTADO AL LIVE: ${state.roomInfo.owner.display_id}`);
    }).catch(err => {
        console.error('🔴 Error al conectar. Reintentando en 10s...', err.message);
        setTimeout(connectToTikTok, 10000); // Reintenta en 10 segundos
    });
}

// ─── EVENTOS ───────────────────────────────────────────────────────────

tiktokConnection.on('chat', data => {
    try {
        const payloadChat = {
            id: Date.now() + Math.random(),
            author: data.nickname || data.uniqueId, 
            text: data.comment,
            foto: data.profilePictureUrl,
            time: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
            isTikTok: true,
            isSystem: false
        };
        pusher.trigger('interactivos', 'nuevo-mensaje-tiktok', payloadChat);
        console.log(`💬 [CHAT] ${payloadChat.author}: ${payloadChat.text}`);
    } catch (e) {
        console.error("❌ Error procesando chat:", e);
    }
});

tiktokConnection.on('gift', data => {
    try {
        if (data.giftType === 1 && !data.repeatEnd) return; 

        const payloadRegalo = {
            id: Date.now() + Math.random(),
            author: data.nickname || data.uniqueId,
            text: `🎁 ¡Envió ${data.repeatCount}x ${data.giftName}!`,
            foto: data.profilePictureUrl,
            time: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
            isTikTok: true,
            isSystem: true 
        };
        pusher.trigger('interactivos', 'nuevo-mensaje-tiktok', payloadRegalo);
        console.log(`🎁 [REGALO] ${payloadRegalo.author} mandó ${data.repeatCount} ${data.giftName}`);
    } catch (e) {
        console.error("❌ Error procesando regalo:", e);
    }
});

// Manejo de desconexiones inesperadas
tiktokConnection.on('disconnected', () => {
    console.log('🔴 Conexión perdida. Reintentando...');
    setTimeout(connectToTikTok, 5000);
});

tiktokConnection.on('streamEnd', () => {
    console.log('🚫 El Live terminó. Esperando 1 minuto para checar si vuelve...');
    setTimeout(connectToTikTok, 60000);
});

// Iniciar primera conexión
connectToTikTok();