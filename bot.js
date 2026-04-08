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

// Helper para extraer la URL de la foto (TikTok envía un objeto complejo)
const getFotoUrl = (data) => {
    if (data.profilePictureUrl) {
        return typeof data.profilePictureUrl === 'string' 
          ? data.profilePictureUrl 
          : (data.profilePictureUrl.urls && data.profilePictureUrl.urls[0]) || '';
    }
    return '';
};

// Generador de ID más robusto
let idCounter = Date.now();
function generateId() {
    return `${idCounter++}`;
}

// ─── Envío de Pusher con Error Visible ───
function sendToPusher(channel, event, payload) {
    pusher.trigger(channel, event, payload).catch((err) => {
        console.error(`🔴 ERROR PUSHER en canal ${channel}:`, err.message);
    });
}

// ─── ENDPOINT: CONECTAR (OPTIMIZADO) ───
app.post('/api/conectar', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ error: "Falta el username de TikTok." });
    }

    // 🔥 Limpieza de nombre (quitar @ y pasar a minúsculas)
    const cleanName = username.toLowerCase().replace('@', '');
    const userChannel = `interactivos-${cleanName}`;

    if (activeStreams.has(cleanName)) {
        console.log(`♻️ Reusando conexión activa para @${cleanName}`);
        return res.json({ message: "Ya conectado", username: cleanName, channel: userChannel });
    }

    console.log(`🔎 Iniciando conexión para @${cleanName}...`);

    let tiktokConnection = new WebcastPushConnection(cleanName, {
        enableExtendedGiftInfo: true,
        requestPollingIntervalMs: 1000 // Acelera la detección de eventos
    });

    // ─── EVENTO CHAT ───
    tiktokConnection.on('chat', data => {
        const payload = {
            id: generateId(),
            author: data.nickname || data.uniqueId,
            text: data.comment,
            foto: getFotoUrl(data),
            time: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
            isTikTok: true,
            isSystem: false
        };
        sendToPusher(userChannel, 'nuevo-mensaje-tiktok', payload);
    });

    // ─── EVENTO REGALOS ───
    tiktokConnection.on('gift', data => {
        if (data.giftType === 1 && !data.repeatEnd) return;
        
        const payload = {
            id: generateId(),
            author: data.nickname || data.uniqueId,
            text: `🎁 ¡Envió ${data.repeatCount}x ${data.giftName}!`,
            foto: getFotoUrl(data),
            time: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
            isTikTok: true,
            isSystem: true
        };
        sendToPusher(userChannel, 'nuevo-mensaje-tiktok', payload);
    });

    tiktokConnection.on('error', err => {
        console.error(`❌ Error en @${cleanName}:`, err.message);
    });

    tiktokConnection.on('disconnected', () => {
        console.log(`⚠️ @${cleanName} desconectado`);
        activeStreams.delete(cleanName);
    });

    tiktokConnection.on('streamEnd', () => {
        console.log(`🛑 Live terminado para @${cleanName}`);
        activeStreams.delete(cleanName);
    });

    try {
        await tiktokConnection.connect();
        activeStreams.set(cleanName, tiktokConnection);
        console.log(`🟢 CONECTADO OK: @${cleanName}`);

        res.json({
            success: true,
            message: "Conexión exitosa",
            username: cleanName,
            channel: userChannel
        });

    } catch (err) {
        console.error(`🔴 Fallo al conectar @${cleanName}:`, err.message);
        res.status(500).json({ error: "No se pudo conectar. ¿El live está activo?" });
    }
});

// ─── ENDPOINT: DESCONECTAR ───
app.post('/api/desconectar', (req, res) => {
    const name = req.body.username?.toLowerCase().replace('@', '');
    if (!name) return res.status(400).json({ error: "Falta el username." });

    if (activeStreams.has(name)) {
        const conn = activeStreams.get(name);
        conn.disconnect();
        activeStreams.delete(name);
        console.log(`🔌 Desconectado manualmente: @${name}`);
        return res.json({ success: true, message: `Bot desconectado de @${name}` });
    }
    res.json({ message: "No estaba conectado." });
});

app.get('/api/status', (req, res) => {
    res.json({
        activeConnections: activeStreams.size,
        users: Array.from(activeStreams.keys())
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API Bot Multi-Streamer en puerto ${PORT}`);
});