require('dotenv').config(); // Por si corres local, pero Railway lo ignora y usa su env
const express = require('express');
const cors = require('cors');
const { WebcastPushConnection } = require('tiktok-live-connector');
const Pusher = require('pusher');

const app = express();
app.use(cors());
app.use(express.json());

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// ─── CACHE GLOBAL ───
const activeStreams = new Map();

// Formatter cacheado (MUY importante)
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

// Envío no bloqueante
function sendToPusher(channel, event, payload) {
  setImmediate(() => {
    pusher.trigger(channel, event, payload).catch(() => {});
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
    
    // Variables para controlar la reconexión
    let reconnectDelay = 5000;
    let isIntentionallyDisconnected = false; 

    try {
        const state = await tiktokConnection.connect();
        
        // Guardamos no solo la conexión, sino la bandera de intención
        activeStreams.set(username, { connection: tiktokConnection, isIntentionallyDisconnected });

        console.log(`🟢 CONECTADO: @${state.roomInfo.owner.display_id}`);

        // ⚠️ ATENCIÓN: Este es el canal dinámico que tu frontend/juego debe escuchar
        const userChannel = `interactivos-${username.toLowerCase()}`;

        // ─── CHAT ───
        tiktokConnection.on('chat', data => {
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

        // ─── RECONEXIÓN INTELIGENTE ───
        function reconnect() {
            // Si lo desconectamos manual, abortamos bucle
            const streamData = activeStreams.get(username);
            if (!streamData || streamData.isIntentionallyDisconnected) {
                console.log(`🛑 Bucle de reconexión abortado para @${username}`);
                return;
            }

            reconnectDelay = Math.min(reconnectDelay * 2, 60000); // Max 1 minuto
            console.log(`🔁 Reintentando @${username} en ${reconnectDelay / 1000}s`);

            setTimeout(async () => {
                try {
                    // Validar de nuevo antes de conectar por si se desconectó mientras esperaba
                    const checkData = activeStreams.get(username);
                    if (!checkData || checkData.isIntentionallyDisconnected) return;

                    await tiktokConnection.connect();
                    reconnectDelay = 5000;
                    console.log(`🟢 Reconectado @${username}`);
                } catch {
                    reconnect(); // Llamada recursiva solo si falla por red/tiktok
                }
            }, reconnectDelay);
        }

        tiktokConnection.on('disconnected', () => {
            console.log(`⚠️ @${username} desconectado de TikTok`);
            reconnect();
        });

        tiktokConnection.on('streamEnd', () => {
             console.log(`🛑 El live de @${username} ha terminado.`);
             // Si el live termina, no intentamos reconectar
             if(activeStreams.has(username)){
                 activeStreams.get(username).isIntentionallyDisconnected = true;
                 activeStreams.delete(username);
             }
        });

        tiktokConnection.on('error', err => {
            console.error(`❌ Error @${username}:`, err.message);
        });

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

    if (!username) {
        return res.status(400).json({ error: "Falta el username." });
    }

    const streamData = activeStreams.get(username);

    if (streamData) {
        // Marcamos la bandera para matar el bucle de reconnect
        streamData.isIntentionallyDisconnected = true;
        // Desconectamos el socket
        streamData.connection.disconnect();
        // Borramos de la memoria
        activeStreams.delete(username);
        
        console.log(`🔌 Desconectado manualmente: @${username}`);
        return res.json({ success: true, message: `Bot desconectado de @${username}` });
    } else {
        return res.json({ message: "El bot no estaba conectado a ese usuario." });
    }
});

// ─── ENDPOINT DE SALUD (Para saber qué lives están activos) ───
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