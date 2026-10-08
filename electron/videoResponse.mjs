import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

// HTML video seeks issue byte-range requests; stream only the requested bytes.
export async function videoResponse(file, request) {
  const { size } = await stat(file);
  const range = request.headers.get('range');
  let start = 0, end = size - 1, status = 200;
  const types = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ts: 'video/mp2t' };
  const headers = { 'Content-Type': types[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  return new Response(request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(createReadStream(file, { start, end })), { status, headers });
}
