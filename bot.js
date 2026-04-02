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

console.log(`🔎 Intentando conectar a TikTok: @${tiktokUsername}...`);

function connectToTikTok() {
    tiktokConnection.connect().then(state => {
        console.log(`🟢 MOTOR ONLINE: Conectado al Live ID ${state.roomId}`);
    }).catch(err => {
        console.error(`🔴 Error de conexión: ${err.message}`);
        // Si el usuario no está en vivo, esto fallará. 
        setTimeout(connectToTikTok, 15000); 
    });
}

// ─── EVENTOS DE ESCUCHA ───

tiktokConnection.on('chat', data => {
    console.log(`💬 Mensaje de ${data.nickname}: ${data.comment}`); // Log para ver en Railway
    
    const payloadChat = {
        id: Date.now() + Math.random(),
        author: data.nickname || data.uniqueId, 
        text: data.comment,
        foto: data.profilePictureUrl,
        time: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
        isTikTok: true,
        isSystem: false
    };

    pusher.trigger('interactivos', 'nuevo-mensaje-tiktok', payloadChat).catch(e => console.error("Pusher Error:", e));
});

tiktokConnection.on('gift', data => {
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
    
    console.log(`🎁 REGALO: ${payloadRegalo.author} mandó ${data.giftName}`);
    pusher.trigger('interactivos', 'nuevo-mensaje-tiktok', payloadRegalo).catch(e => console.error("Pusher Error:", e));
});

// Detectar si TikTok nos saca
tiktokConnection.on('disconnected', () => {
    console.log('⚠️ Desconectado de TikTok. Reintentando...');
    setTimeout(connectToTikTok, 5000);
});

tiktokConnection.on('error', err => {
    console.error('❌ TikTok Connection Error:', err);
});

// Arrancar
connectToTikTok();