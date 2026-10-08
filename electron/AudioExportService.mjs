import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function saveAudio(window, payload, { codec, documents, showSaveDialog, writeFile }) {
    codec.validate(payload?.data); codec.exportOptions(payload);
    const name = String(payload.name || 'audio').replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
    const current = documents.get(payload.documentId);
    let file = payload.overwrite && current && path.extname(current).toLowerCase() === `.${payload.format}` ? current : null;
    if (!file) {
      const defaultPath = current ? path.join(path.dirname(current), `${name}.${payload.format}`) : `${name}.${payload.format}`;
      const result = await showSaveDialog(window, { title: 'Save audio as', defaultPath, filters: [{ name: payload.format.toUpperCase(), extensions: [payload.format] }] });
      if (result.canceled || !result.filePath) return null;
      file = path.extname(result.filePath).toLowerCase() === `.${payload.format}` ? result.filePath : `${result.filePath}.${payload.format}`;
    }
    const bytes = await codec.encode(payload);
    await writeFile(file, bytes);
    const documentId = payload.documentId || randomUUID();
    if (!payload.selectionOnly) documents.set(documentId, file);
    return { name: path.basename(file), documentId };
}
