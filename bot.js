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

function connectToTikTok() {
    // Solo intentamos conectar si no estamos ya en proceso o conectados
    if (tiktokConnection.getState().isConnected) return;

    tiktokConnection.connect().then(state => {
        console.log(`🟢 MOTOR ONLINE: @${state.roomInfo.owner.display_id}`);
    }).catch(err => {
        // Silenciamos el error si ya estamos conectados
        if (!err.message.includes('Already connected')) {
            // console.error('🟡 Reconexión silenciosa...'); 
        }
        setTimeout(connectToTikTok, 15000); 
    });
}

// ─── MANEJO DE MENSAJES (MÁXIMA VELOCIDAD) ───────────────────────────

tiktokConnection.on('chat', data => {
    // process.nextTick hace que Pusher envíe el mensaje de inmediato
    process.nextTick(() => {
        const payloadChat = {
            id: Date.now() + Math.random(),
            author: data.nickname || data.uniqueId, 
            text: data.comment,
            foto: data.profilePictureUrl,
            time: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
            isTikTok: true,
            isSystem: false
        };

        pusher.trigger('interactivos', 'nuevo-mensaje-tiktok', payloadChat)
              .catch(e => {}); // Ignorar errores de Pusher para no trabar el bot
    });
});

tiktokConnection.on('gift', data => {
    if (data.giftType === 1 && !data.repeatEnd) return; 

    process.nextTick(() => {
        const payloadRegalo = {
            id: Date.now() + Math.random(),
            author: data.nickname || data.uniqueId,
            text: `🎁 ¡Envió ${data.repeatCount}x ${data.giftName}!`,
            foto: data.profilePictureUrl,
            time: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
            isTikTok: true,
            isSystem: true 
        };
        pusher.trigger('interactivos', 'nuevo-mensaje-tiktok', payloadRegalo).catch(e => {});
        console.log(`🎁 [REGALO] ${payloadRegalo.author} -> ${data.giftName}`);
    });
});

// ─── GESTIÓN DE CONEXIÓN (ANTI-LOGS MOLESTOS) ─────────────────────────

tiktokConnection.on('disconnected', () => {
    setTimeout(connectToTikTok, 5000);
});

tiktokConnection.on('error', err => {
    // Si el error es de "Ya conectado", no hacemos nada.
    if (err && err.includes && err.includes('Already connected')) return;
});

tiktokConnection.on('streamEnd', () => {
    setTimeout(connectToTikTok, 30000);
});

// Arrancar
connectToTikTok();