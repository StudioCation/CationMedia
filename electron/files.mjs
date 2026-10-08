import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { mediaTypes } from '../shared/mediaTypes.mjs';
export const extensions = mediaTypes.flatMap(type => type.extensions);
export function supported(file) { return typeof file === 'string' && extensions.includes(path.extname(file).slice(1).toLowerCase()); }
export function inside(root, file) { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
export async function resolveAsset(root, requested) {
  const candidate = await realpath(path.resolve(root, requested));
  if (!inside(root, candidate) || !(await stat(candidate)).isFile()) throw new Error('Access to this resource is denied');
  return candidate;
}
