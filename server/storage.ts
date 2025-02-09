import { downloads, type Download, type InsertDownload } from "@shared/schema";

export interface IStorage {
  getDownload(id: number): Promise<Download | undefined>;
  createDownload(download: InsertDownload): Promise<Download>;
  updateDownloadStatus(id: number, status: string): Promise<Download | undefined>;
}

export class MemStorage implements IStorage {
  private downloads: Map<number, Download>;
  currentId: number;

  constructor() {
    this.downloads = new Map();
    this.currentId = 1;
  }

  async getDownload(id: number): Promise<Download | undefined> {
    return this.downloads.get(id);
  }

  async createDownload(insertDownload: InsertDownload): Promise<Download> {
    const id = this.currentId++;
    const download: Download = {
      ...insertDownload,
      id,
      status: 'pending',
      filename: null,
      parts: 1,
      createdAt: new Date()
    };
    this.downloads.set(id, download);
    return download;
  }

  async updateDownloadStatus(id: number, status: string): Promise<Download | undefined> {
    const download = await this.getDownload(id);
    if (download) {
      const updatedDownload = { ...download, status };
      this.downloads.set(id, updatedDownload);
      return updatedDownload;
    }
    return undefined;
  }
}

export const storage = new MemStorage();