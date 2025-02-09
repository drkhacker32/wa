import { makeWASocket, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { promises as fs } from 'fs';
import { join } from 'path';
import { log } from './vite';
import { handleDownload } from './downloader';
import { splitFile } from './file-splitter';
import { unlink, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import pino from 'pino';

const AUTH_FOLDER = './auth';
const DOWNLOAD_DIR = join(process.cwd(), 'downloads');
const SPLIT_DIR = join(process.cwd(), 'splits');
let sock: any = null;

// Helper function to clean all files in a directory
async function cleanDirectory(dir: string): Promise<number> {
  try {
    if (!existsSync(dir)) return 0;

    const files = await readdir(dir);
    let count = 0;

    for (const file of files) {
      await unlink(join(dir, file));
      count++;
    }

    return count;
  } catch (error) {
    log(`Error cleaning directory ${dir}: ${error}`, 'whatsapp');
    return 0;
  }
}

async function connectToWhatsApp() {
  try {
    // Create auth folder if it doesn't exist
    await mkdir(AUTH_FOLDER, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    // Create a basic Pino logger with minimal logging
    const logger = pino({ level: 'warn' });

    sock = makeWASocket({
      printQRInTerminal: true,
      auth: state,
      logger,
      connectTimeoutMs: 60000,
      qrTimeout: 60000,
      defaultQueryTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        log(`Connection closed due to ${lastDisconnect?.error?.message}. ${shouldReconnect ? 'Reconnecting...' : 'Not reconnecting.'}`, 'whatsapp');

        if (shouldReconnect) {
          setTimeout(() => {
            log('Attempting to reconnect...', 'whatsapp');
            connectToWhatsApp();
          }, 5000);
        }
      }

      if (connection === 'open') {
        log('WhatsApp connection established!', 'whatsapp');
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }: any) => {
      for (const message of messages) {
        if (!message.message) continue;

        const textMessage = message.message.conversation ||
          (message.message.extendedTextMessage && message.message.extendedTextMessage.text);

        const jid = message.key.remoteJid!;

        // Handle .del command - clean up all downloaded files
        if (textMessage === '.del') {
          try {
            const downloadCount = await cleanDirectory(DOWNLOAD_DIR);
            const splitCount = await cleanDirectory(SPLIT_DIR);

            await sock.sendMessage(jid, {
              text: `✨ *Cleanup Complete!*\n\n📁 Removed ${downloadCount} files from downloads\n📂 Removed ${splitCount} split files`
            }, { quoted: message });
            continue;
          } catch (error: any) {
            log(`Error in cleanup: ${error}`, 'whatsapp');
            await sock.sendMessage(jid, {
              text: `❌ *Error during cleanup:* ${error.message}`
            }, { quoted: message });
            continue;
          }
        }

        // Handle .dl command
        if (textMessage?.startsWith('.dl ')) {
          const url = textMessage.slice(4).trim();

          try {
            // React with download emoji
            await sock.sendMessage(jid, { react: { text: "⬇️", key: message.key } });

            // Download file
            const { filePath, fileName, fileSize } = await handleDownload(url);

            if (fileSize > 2 * 1024 * 1024 * 1024) { // 2GB
              // React with hammer emoji for splitting
              await sock.sendMessage(jid, { react: { text: "⚒️", key: message.key } });

              const parts = await splitFile(filePath);
              const totalParts = parts.length;

              // React with upload emoji
              await sock.sendMessage(jid, { react: { text: "⬆️", key: message.key } });

              // Send all parts
              for (let i = 0; i < parts.length; i++) {
                // Send the actual file part with enhanced caption
                await sock.sendMessage(jid, {
                  document: await fs.readFile(parts[i]),
                  fileName: `${fileName}.part${i + 1}`,
                  caption: `🖇️ *${fileName}*\n_(Part ${i + 1} of ${totalParts})_`,
                  mimetype: 'application/octet-stream'
                }, { quoted: message });

                // Clean up part
                await unlink(parts[i]);
              }
            } else {
              // React with upload emoji
              await sock.sendMessage(jid, { react: { text: "⬆️", key: message.key } });

              // Send the actual file with enhanced caption
              await sock.sendMessage(jid, {
                document: await fs.readFile(filePath),
                fileName,
                caption: `🖇️ *${fileName}*`,
                mimetype: 'application/octet-stream'
              }, { quoted: message });
            }

            // Clean up original file
            if (existsSync(filePath)) {
              await unlink(filePath);
              log(`Cleaned up file: ${filePath}`, 'whatsapp');
            }

            // React with check mark for completion
            await sock.sendMessage(jid, { react: { text: "✅", key: message.key } });

          } catch (error: any) {
            log(`Error processing download: ${error}`, 'whatsapp');
            // React with broken heart for error
            await sock.sendMessage(jid, { react: { text: "💔", key: message.key } });
            await sock.sendMessage(jid, {
              text: `❌ *Error:* ${error.message}`
            }, { quoted: message });
          }
        }
      }
    });
  } catch (error: any) {
    log(`Error in WhatsApp connection: ${error.message}`, 'whatsapp');
    setTimeout(() => {
      log('Attempting to reconnect after error...', 'whatsapp');
      connectToWhatsApp();
    }, 5000);
  }
}

export async function initWhatsapp() {
  try {
    await connectToWhatsApp();
    log('WhatsApp client initialized successfully', 'whatsapp');
  } catch (error: any) {
    log(`Failed to initialize WhatsApp client: ${error.message}`, 'whatsapp');
    throw error;
  }
}