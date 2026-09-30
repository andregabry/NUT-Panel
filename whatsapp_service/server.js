const crypto = require('crypto');
if (!global.crypto) {
    global.crypto = crypto.webcrypto || crypto;
}
if (!globalThis.crypto) {
    globalThis.crypto = crypto.webcrypto || crypto;
}

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');

const PORT = process.env.PORT || 3001;
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth_info');
const MSG_FILE = path.join(__dirname, 'messages_history.json');
const CONFIG_FILE = path.join(__dirname, 'session_config.json');

if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let currentQrDataUrl = null;
let currentRawQr = null;
let connectionState = 'disconnected'; // 'disconnected', 'connecting', 'qr', 'connected'
let connectedUser = null;
let lastStateTime = new Date().toISOString();

// Cache de mensagens em memória
let messageHistory = [];
try {
    if (fs.existsSync(MSG_FILE)) {
        messageHistory = JSON.parse(fs.readFileSync(MSG_FILE, 'utf-8'));
    }
} catch (e) {
    messageHistory = [];
}

function saveMessagesToDisk() {
    try {
        if (messageHistory.length > 200) {
            messageHistory = messageHistory.slice(0, 200);
        }
        fs.writeFileSync(MSG_FILE, JSON.stringify(messageHistory, null, 2));
    } catch (e) {
        console.error('[WhatsApp] Erro ao salvar histórico de mensagens:', e);
    }
}

// Configurações de Sessão (Nome Personalizado & Avatar desta Sessão)
let sessionConfig = {
    name: 'Enging UPS Notifier ⚡',
    avatar: 'enging', // 'enging', 'robot', 'server', 'battery', or URL
    custom_avatar_url: ''
};
try {
    if (fs.existsSync(CONFIG_FILE)) {
        sessionConfig = { ...sessionConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
    }
} catch (e) {}

function saveSessionConfigToDisk() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(sessionConfig, null, 2));
    } catch (e) {}
}

async function startWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1043857760], isLatest: true }));

        console.log(`[WhatsApp] Iniciando cliente Baileys v${version.join('.')} (Latest: ${isLatest})...`);
        connectionState = 'connecting';
        lastStateTime = new Date().toISOString();

        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
            auth: state,
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            emitOwnEvents: true,
            retryRequestDelayMs: 250
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentRawQr = qr;
                connectionState = 'qr';
                lastStateTime = new Date().toISOString();
                try {
                    currentQrDataUrl = await QRCode.toDataURL(qr, {
                        width: 320,
                        margin: 2,
                        color: {
                            dark: '#131e2b',
                            light: '#ffffff'
                        }
                    });
                    console.log('[WhatsApp] Novo QR Code gerado com sucesso para autenticação!');
                } catch (err) {
                    console.error('[WhatsApp] Erro ao gerar DataURL do QR Code:', err);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`[WhatsApp] Conexão encerrada. Motivo: ${statusCode} (Reconectar: ${shouldReconnect})`);

                connectionState = 'disconnected';
                connectedUser = null;
                currentQrDataUrl = null;
                lastStateTime = new Date().toISOString();

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('[WhatsApp] Sessão desconectada pelo utilizador. Limpando credenciais...');
                    try {
                        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                        fs.mkdirSync(AUTH_DIR, { recursive: true });
                    } catch (e) {
                        console.error('[WhatsApp] Erro ao limpar auth_dir:', e);
                    }
                    setTimeout(startWhatsApp, 3000);
                } else if (shouldReconnect) {
                    console.log('[WhatsApp] Reconectando em 4 segundos...');
                    setTimeout(startWhatsApp, 4000);
                } else {
                    setTimeout(startWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                console.log('[WhatsApp] ✔ Autenticado e conectado com sucesso ao WhatsApp Web!');
                connectionState = 'connected';
                currentQrDataUrl = null;
                currentRawQr = null;
                lastStateTime = new Date().toISOString();

                const user = sock.user || {};
                const rawId = user.id || '';
                const phone = rawId.split(':')[0].replace(/[^0-9]/g, '');

                connectedUser = {
                    id: rawId,
                    name: user.name || sessionConfig.name || 'Enging UPS Admin',
                    phone: phone ? `+${phone}` : ''
                };
            }
        });

        // Captura mensagens recebidas e enviadas para histórico de chat interativo
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (!messages || !Array.isArray(messages)) return;
            for (const m of messages) {
                if (!m.message) continue;
                const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
                if (!text) continue;

                const fromMe = Boolean(m.key.fromMe);
                const remoteJid = m.key.remoteJid || '';
                const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');

                const newMsg = {
                    id: m.key.id,
                    fromMe: fromMe,
                    target: remoteJid,
                    phone: senderPhone.startsWith('+') ? senderPhone : `+${senderPhone}`,
                    senderName: fromMe ? (sessionConfig.name || 'Enging UPS') : (m.pushName || `+${senderPhone}`),
                    text: text,
                    timestamp: m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now(),
                    formatted_time: new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }),
                    status: 'delivered'
                };

                // Evita duplicados
                const exists = messageHistory.find(x => x.id === newMsg.id);
                if (!exists) {
                    messageHistory.unshift(newMsg);
                    saveMessagesToDisk();
                }
            }
        });

    } catch (error) {
        console.error('[WhatsApp] Erro crítico ao iniciar socket:', error);
        connectionState = 'disconnected';
        setTimeout(startWhatsApp, 5000);
    }
}

// Format telephone to WhatsApp JID
function formatToJid(phone) {
    if (!phone) return null;
    let clean = String(phone).replace(/[^0-9]/g, '');
    if (!clean) return null;
    // Se for número de 9 dígitos de Portugal sem indicativo, adiciona 351
    if (clean.length === 9 && (clean.startsWith('9') || clean.startsWith('2'))) {
        clean = '351' + clean;
    }
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.includes('@')) return clean;
    return `${clean}@s.whatsapp.net`;
}

// ----------------- REST ENDPOINTS ----------------- //

// 1. Status do serviço e QR Code
app.get('/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.json({
        success: true,
        connected: connectionState === 'connected',
        state: connectionState,
        qr: currentQrDataUrl,
        user: connectedUser,
        session_config: sessionConfig,
        lastStateTime: lastStateTime
    });
});

// 1.1 Imagem direta do QR Code em PNG
app.get('/qr.png', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    if (connectionState === 'connected') {
        return res.status(200).send('CONNECTED');
    }
    if (!currentRawQr) {
        return res.status(404).send('QR_NOT_READY');
    }
    try {
        const buffer = await QRCode.toBuffer(currentRawQr, {
            width: 320,
            margin: 2,
            color: {
                dark: '#131e2b',
                light: '#ffffff'
            }
        });
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// 2. Histórico de Mensagens do Chat
app.get('/messages', (req, res) => {
    const target = req.query.phone || req.query.target || '';
    let filtered = messageHistory;
    if (target) {
        const targetClean = String(target).replace(/[^0-9]/g, '');
        filtered = messageHistory.filter(m => {
            const mPhone = String(m.phone || '').replace(/[^0-9]/g, '');
            const mTarget = String(m.target || '').replace(/[^0-9]/g, '');
            return mPhone.includes(targetClean) || mTarget.includes(targetClean) || targetClean.includes(mPhone);
        });
    }
    res.json({
        success: true,
        messages: filtered.slice(0, 50),
        session_config: sessionConfig
    });
});

// 2.1 Limpar histórico do chat
app.post('/messages/clear', (req, res) => {
    messageHistory = [];
    saveMessagesToDisk();
    res.json({ success: true });
});

// 3. Configurações da Sessão (Nome Personalizado & Avatar)
app.get('/session-config', (req, res) => {
    res.json({ success: true, config: sessionConfig });
});

app.post('/session-config', (req, res) => {
    const { name, avatar, custom_avatar_url } = req.body;
    if (name) sessionConfig.name = name.trim();
    if (avatar) sessionConfig.avatar = avatar.trim();
    if (custom_avatar_url !== undefined) sessionConfig.custom_avatar_url = custom_avatar_url.trim();
    saveSessionConfigToDisk();
    res.json({ success: true, config: sessionConfig });
});

// 4. Envio de mensagem
app.post('/send', async (req, res) => {
    const { phone, number, to, message, text } = req.body;
    const target = phone || number || to;
    const content = message || text;

    if (!target) {
        return res.status(400).json({ success: false, error: 'Parâmetro phone/number obrigatório' });
    }
    if (!content) {
        return res.status(400).json({ success: false, error: 'Parâmetro message/text obrigatório' });
    }

    if (connectionState !== 'connected' || !sock) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp Web não está autenticado. Escaneie o QR Code no dashboard primeiro.',
            state: connectionState
        });
    }

    const jid = formatToJid(target);
    if (!jid) {
        return res.status(400).json({ success: false, error: 'Número de telefone inválido' });
    }

    try {
        const result = await sock.sendMessage(jid, { text: content });
        console.log(`[WhatsApp] Mensagem enviada para ${jid} (ID: ${result?.key?.id})`);

        const cleanPhone = jid.replace('@s.whatsapp.net', '');
        const outMsg = {
            id: result?.key?.id || `out-${Date.now()}`,
            fromMe: true,
            target: jid,
            phone: cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`,
            senderName: sessionConfig.name || 'Enging UPS Notifier',
            text: content,
            timestamp: Date.now(),
            formatted_time: new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }),
            status: 'delivered'
        };
        messageHistory.unshift(outMsg);
        saveMessagesToDisk();

        return res.json({
            success: true,
            messageId: result?.key?.id,
            target: jid,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error(`[WhatsApp] Falha ao enviar para ${jid}:`, err);
        return res.status(500).json({
            success: false,
            error: 'Falha ao transmitir mensagem via WhatsApp Web: ' + err.message
        });
    }
});

// 5. Desconectar e reiniciar sessão
app.post('/logout', async (req, res) => {
    try {
        console.log('[WhatsApp] Desconexão solicitada via API REST...');
        if (sock) {
            try {
                await sock.logout();
            } catch (e) {}
        }
        try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        } catch (e) {}

        connectionState = 'disconnected';
        connectedUser = null;
        currentQrDataUrl = null;
        lastStateTime = new Date().toISOString();

        setTimeout(startWhatsApp, 2000);
        return res.json({ success: true, message: 'WhatsApp desconectado com sucesso. Novo QR Code será gerado.' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Inicia o microserviço HTTP e o WhatsApp
app.listen(PORT, '127.0.0.1', () => {
    console.log(`[WhatsApp] Microserviço ativo na porta ${PORT}`);
    startWhatsApp();
});
