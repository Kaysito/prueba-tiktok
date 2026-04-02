const { WebcastPushConnection } = require('tiktok-live-connector');
const Pusher = require('pusher');

// ─── CONFIGURACIÓN DE PUSHER ───
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

const config = {
    tiktokUsername: process.env.TIKTOK_USERNAME || "lindaaani", 
};

let tiktokConnection = new WebcastPushConnection(config.tiktokUsername);

console.log(`🚀 Motor de Chat y Regalos iniciado para @${config.tiktokUsername}...`);

tiktokConnection.connect().then(state => {
    console.log(`🟢 CONECTADO AL LIVE DE: ${state.roomInfo.owner.display_id}`);
    console.log(`📡 Filtrando chat y donaciones para el juego.`);
}).catch(err => console.error('🔴 Error:', err.message));

// ─── EVENTO 1: CHAT REAL (Nombres Amigables) ───
tiktokConnection.on('chat', data => {
    const payloadChat = {
        id: Date.now() + Math.random(),
        // Nickname es el nombre con emojis, uniqueId es el @usuario
        author: data.nickname || data.uniqueId, 
        text: data.comment,
        foto: data.profilePictureUrl,
        time: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
        isTikTok: true,
        isSystem: false
    };

    pusher.trigger('interactivos', 'nuevo-mensaje-tiktok', payloadChat);
    console.log(`💬 [CHAT] ${payloadChat.author}: ${payloadChat.text}`);
});

// ─── EVENTO 2: REGALOS (Agrupados por Combo) ───
tiktokConnection.on('gift', data => {
    // Si el usuario sigue presionando el botón, esperamos al final para no saturar
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
    console.log(`🎁 [DONACIÓN] ${payloadRegalo.author} mandó ${data.repeatCount} ${data.giftName}`);
});

// Los eventos de 'like' han sido eliminados para evitar distracciones.

tiktokConnection.on('disconnected', () => console.log('🔴 Bot desconectado de TikTok.'));
tiktokConnection.on('streamEnd', () => console.log('🚫 El Live terminó.'));