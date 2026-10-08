import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/decoders', { recursive: true });
await cp('node_modules/three/examples/jsm/libs/draco/gltf', 'public/decoders/draco', { recursive: true });
await cp('node_modules/three/examples/jsm/libs/basis', 'public/decoders/basis', { recursive: true });
