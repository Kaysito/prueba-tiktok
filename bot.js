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

// Bandera para evitar múltiples intentos de conexión al mismo tiempo
let isConnecting = false;

function connectToTikTok() {
    if (isConnecting) return;
    
    isConnecting = true;

    tiktokConnection.connect().then(state => {
        isConnecting = false;
        console.log(`🟢 MOTOR ONLINE: @${state.roomInfo.owner.display_id}`);
    }).catch(err => {
        isConnecting = false;
        // No imprimimos nada para mantener la consola limpia
        setTimeout(connectToTikTok, 15000); 
    });
}

// ─── MANEJO DE MENSAJES (FLUIDO) ───────────────────────────

tiktokConnection.on('chat', data => {
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

        pusher.trigger('interactivos', 'nuevo-mensaje-tiktok', payloadChat).catch(() => {});
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
        pusher.trigger('interactivos', 'nuevo-mensaje-tiktok', payloadRegalo).catch(() => {});
        console.log(`🎁 [REGALO] ${payloadRegalo.author} -> ${data.giftName}`);
    });
});

// ─── GESTIÓN DE CONEXIÓN ─────────────────────────

tiktokConnection.on('disconnected', () => {
    isConnecting = false;
    setTimeout(connectToTikTok, 5000);
});

tiktokConnection.on('streamEnd', () => {
    isConnecting = false;
    setTimeout(connectToTikTok, 30000);
});

// Capturar errores para que no crasheen el proceso
tiktokConnection.on('error', () => {
    isConnecting = false;
});

// Iniciar
connectToTikTok();