import axios from 'axios';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { log } from './vite';

const DOWNLOAD_DIR = path.join(process.cwd(), 'downloads');

interface DownloadResult {
  filePath: string;
  fileName: string;
  fileSize: number;
}

export async function handleDownload(url: string): Promise<DownloadResult> {
  try {
    // Ensure download directory exists
    await mkdir(DOWNLOAD_DIR, { recursive: true });

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const contentDisposition = response.headers['content-disposition'];
    const contentLength = parseInt(response.headers['content-length'] || '0', 10);

    let fileName = path.basename(url);
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) fileName = match[1];
    }

    const filePath = path.join(DOWNLOAD_DIR, fileName);
    const writer = createWriteStream(filePath);

    log(`Starting download of ${fileName}`, 'downloader');

    await pipeline(response.data, writer);

    log(`Download completed: ${fileName}`, 'downloader');

    return {
      filePath,
      fileName,
      fileSize: contentLength || 0
    };
  } catch (error: any) {
    log(`Download failed: ${error.message}`, 'downloader');
    throw new Error(`Failed to download file: ${error.message}`);
  }
}