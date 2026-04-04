const express = require('express');
const cors = require('cors');
const { WebcastPushConnection } = require('tiktok-live-connector');
const Pusher = require('pusher');

const app = express();
app.use(cors());
app.use(express.json());

// Verifica si las variables de entorno se están cargando
console.log("Pusher Config Check:", {
  appId: process.env.PUSHER_APP_ID ? "OK" : "FALTA",
  key: process.env.PUSHER_KEY ? "OK" : "FALTA",
  cluster: process.env.PUSHER_CLUSTER ? "OK" : "FALTA"
});

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// ─── CACHE GLOBAL ───
const activeStreams = new Map();

const timeFormatter = new Intl.DateTimeFormat("es", {
  hour: "2-digit",
  minute: "2-digit"
});

function getTime() {
  return timeFormatter.format(Date.now());
}

let idCounter = 0;
function generateId() {
  return ++idCounter;
}

// ─── Envío de Pusher con Error Visible ───
function sendToPusher(channel, event, payload) {
  setImmediate(() => {
    pusher.trigger(channel, event, payload).catch((err) => {
      console.error(`🔴 ERROR PUSHER en canal ${channel}:`, err.message);
    });
  });
}

// ─── ENDPOINT: CONECTAR ───
app.post('/api/conectar', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ error: "Falta el username de TikTok." });
    }

    if (activeStreams.has(username)) {
        return res.json({ message: "El bot ya está escuchando a este usuario.", username });
    }

    console.log(`🔎 Iniciando conexión para @${username}...`);

    let tiktokConnection = new WebcastPushConnection(username);
    let reconnectDelay = 5000;
    let isIntentionallyDisconnected = false; 

    const userChannel = `interactivos-${username.toLowerCase()}`;

    // 🔥 1. DECLARAMOS LOS EVENTOS ANTES DE CONECTAR 🔥

    // ─── CHAT ───
    tiktokConnection.on('chat', data => {
        console.log(`💬 Chat recibido de @${data.uniqueId}: ${data.comment}`); // Chismoso 1
        const payload = {
            id: generateId(),
            author: data.nickname || data.uniqueId,
            text: data.comment,
            foto: data.profilePictureUrl,
            time: getTime(),
            isTikTok: true,
            isSystem: false
        };
        sendToPusher(userChannel, 'nuevo-mensaje-tiktok', payload);
    });

    // ─── REGALOS ───
    tiktokConnection.on('gift', data => {
        if (data.giftType === 1 && !data.repeatEnd) return;
        console.log(`🎁 Regalo recibido de @${data.uniqueId}: ${data.giftName}`); // Chismoso 2
        
        const payload = {
            id: generateId(),
            author: data.nickname || data.uniqueId,
            text: `🎁 ¡Envió ${data.repeatCount}x ${data.giftName}!`,
            foto: data.profilePictureUrl,
            time: getTime(),
            isTikTok: true,
            isSystem: true
        };
        sendToPusher(userChannel, 'nuevo-mensaje-tiktok', payload);
    });

    // ─── ERRORES DE TIKTOK ───
    tiktokConnection.on('error', err => {
        console.error(`❌ Error en el stream de @${username}:`, err.message);
    });

    tiktokConnection.on('disconnected', () => {
        console.log(`⚠️ @${username} desconectado de TikTok`);
        reconnect();
    });

    tiktokConnection.on('streamEnd', () => {
         console.log(`🛑 El live de @${username} ha terminado.`);
         if(activeStreams.has(username)){
             activeStreams.get(username).isIntentionallyDisconnected = true;
             activeStreams.delete(username);
         }
    });

    // ─── RECONEXIÓN ───
    function reconnect() {
        const streamData = activeStreams.get(username);
        if (!streamData || streamData.isIntentionallyDisconnected) {
            console.log(`🛑 Bucle de reconexión abortado para @${username}`);
            return;
        }

        reconnectDelay = Math.min(reconnectDelay * 2, 60000);
        console.log(`🔁 Reintentando @${username} en ${reconnectDelay / 1000}s`);

        setTimeout(async () => {
            try {
                const checkData = activeStreams.get(username);
                if (!checkData || checkData.isIntentionallyDisconnected) return;

                await tiktokConnection.connect();
                reconnectDelay = 5000;
                console.log(`🟢 Reconectado @${username}`);
            } catch {
                reconnect(); 
            }
        }, reconnectDelay);
    }

    // 🔥 2. AHORA SÍ CONECTAMOS 🔥
    try {
        const state = await tiktokConnection.connect();
        activeStreams.set(username, { connection: tiktokConnection, isIntentionallyDisconnected });
        console.log(`🟢 CONECTADO: @${state.roomInfo.owner.display_id}`);

        res.json({
            message: "Conexión exitosa",
            username,
            channel: userChannel
        });

    } catch (err) {
        console.error(`🔴 Error conectando a @${username}:`, err.message);
        res.status(500).json({
            error: "No se pudo conectar. ¿El live está activo?",
            details: err.message
        });
    }
});

// ─── ENDPOINT: DESCONECTAR MANUALLY ───
app.post('/api/desconectar', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Falta el username." });

    const streamData = activeStreams.get(username);
    if (streamData) {
        streamData.isIntentionallyDisconnected = true;
        streamData.connection.disconnect();
        activeStreams.delete(username);
        
        console.log(`🔌 Desconectado manualmente: @${username}`);
        return res.json({ success: true, message: `Bot desconectado de @${username}` });
    } else {
        return res.json({ message: "El bot no estaba conectado a ese usuario." });
    }
});

// ─── ENDPOINT DE SALUD ───
app.get('/api/status', (req, res) => {
    res.json({
        activeConnections: activeStreams.size,
        users: Array.from(activeStreams.keys())
    });
});

// ─── SERVER ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API Bot Multi-Streamer en puerto ${PORT}`);
});