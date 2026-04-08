const express = require('express');
const cors = require('cors');
const { WebcastPushConnection } = require('tiktok-live-connector');
const Pusher = require('pusher');

const app = express();
app.use(cors());
app.use(express.json());

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

const activeStreams = new Map();

// ─── HELPERS ───
const getFotoUrl = (data) => {
    if (data.profilePictureUrl) {
        return typeof data.profilePictureUrl === 'string'
            ? data.profilePictureUrl
            : (data.profilePictureUrl.urls && data.profilePictureUrl.urls[0]) || '';
    }
    return '';
};

let idCounter = Date.now();
const generateId = () => `${idCounter++}`;

function sendToPusher(channel, event, payload) {
    pusher.trigger(channel, event, payload).catch((err) => {
        console.error(`🔴 ERROR PUSHER (${channel}):`, err.message);
    });
}

// ─── CONECTAR ───
app.post('/api/conectar', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ error: "Falta el username de TikTok." });
    }

    const cleanName = username.toLowerCase().replace('@', '');
    const userChannel = `interactivos-${cleanName}`;

    if (activeStreams.has(cleanName)) {
        console.log(`♻️ Reusando conexión @${cleanName}`);
        return res.json({ success: true, username: cleanName, channel: userChannel });
    }

    console.log(`🔎 Conectando a @${cleanName}...`);

    const connection = new WebcastPushConnection(cleanName, {
        enableExtendedGiftInfo: true
        // ❌ quitamos requestPollingIntervalMs (rompe eventos)
    });

    // ─── DEBUG CLAVE ───
    connection.on('connected', state => {
        console.log(`🟢 CONECTADO A ROOM: ${state.roomId}`);
    });

    // ─── CHAT ───
    connection.on('chat', data => {
        console.log("💬 CHAT:", data.uniqueId, data.comment); // 🔥 DEBUG

        const payload = {
            id: generateId(),
            author: data.nickname || data.uniqueId,
            text: data.comment,
            foto: getFotoUrl(data),
            time: new Date().toLocaleTimeString("es", {
                hour: "2-digit",
                minute: "2-digit"
            }),
            isTikTok: true,
            isSystem: false
        };

        sendToPusher(userChannel, 'nuevo-mensaje-tiktok', payload);
    });

    // ─── REGALOS ───
    connection.on('gift', data => {
        console.log("🎁 GIFT:", data.uniqueId, data.giftName);

        if (data.giftType === 1 && !data.repeatEnd) return;

        const payload = {
            id: generateId(),
            author: data.nickname || data.uniqueId,
            text: `🎁 ${data.repeatCount}x ${data.giftName}`,
            foto: getFotoUrl(data),
            time: new Date().toLocaleTimeString("es", {
                hour: "2-digit",
                minute: "2-digit"
            }),
            isTikTok: true,
            isSystem: true
        };

        sendToPusher(userChannel, 'nuevo-mensaje-tiktok', payload);
    });

    // ─── ERRORES ───
    connection.on('error', err => {
        console.error(`❌ ERROR @${cleanName}:`, err);
    });

    // ─── RECONEXIÓN AUTOMÁTICA ───
    connection.on('disconnected', () => {
        console.log(`⚠️ Desconectado @${cleanName}, reconectando...`);

        activeStreams.delete(cleanName);

        setTimeout(() => {
            fetchReconnect(cleanName);
        }, 3000);
    });

    connection.on('streamEnd', () => {
        console.log(`🛑 Live terminado @${cleanName}`);
        activeStreams.delete(cleanName);
    });

    async function fetchReconnect(name) {
        try {
            const newConn = new WebcastPushConnection(name);
            await newConn.connect();
            activeStreams.set(name, newConn);
            console.log(`🔁 Reconectado @${name}`);
        } catch (err) {
            console.error(`❌ Error reconectando @${name}`);
        }
    }

    try {
        await connection.connect();

        activeStreams.set(cleanName, connection);

        console.log(`✅ BOT ACTIVO @${cleanName}`);

        res.json({
            success: true,
            username: cleanName,
            channel: userChannel
        });

    } catch (err) {
        console.error(`🔴 ERROR CONEXIÓN @${cleanName}:`, err.message);

        res.status(500).json({
            error: "No se pudo conectar. El live debe estar activo."
        });
    }
});

// ─── DESCONECTAR ───
app.post('/api/desconectar', (req, res) => {
    const name = req.body.username?.toLowerCase().replace('@', '');

    if (!name) {
        return res.status(400).json({ error: "Falta username" });
    }

    if (activeStreams.has(name)) {
        activeStreams.get(name).disconnect();
        activeStreams.delete(name);

        console.log(`🔌 Desconectado @${name}`);

        return res.json({ success: true });
    }

    res.json({ message: "No estaba conectado" });
});

// ─── STATUS ───
app.get('/api/status', (req, res) => {
    res.json({
        active: activeStreams.size,
        users: [...activeStreams.keys()]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Bot corriendo en puerto ${PORT}`);
});
