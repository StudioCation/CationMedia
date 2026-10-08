import { imageExtensions } from './image.mjs';
// Format metadata is shared by desktop dialogs/menus and renderer adapters.
// A new media family supplies its own adapter and capabilities; it does not inherit 3D UI.
export const mediaTypes = Object.freeze([
  Object.freeze({ id: 'model3d', label: '3D models', extensions: ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'dae', '3ds', 'blend'],
    capabilities: ['scene', 'camera', 'shading', 'transform', 'animation', 'materials', 'modelExport', 'textureExport', 'textureDiscovery'] }),
  Object.freeze({ id: 'audio', label: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'aif', 'aiff', 'wma', 'ac3', 'aiffc', 'aifc', 'caf', 'amr', 'ape', 'mka', 'weba'],
    capabilities: ['audio', 'audioExport'] }),
  Object.freeze({ id: 'video', label: 'Video', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', 'ogv', '3gp', 'vob', 'mxf'], capabilities: ['video', 'videoExport'] }),
  Object.freeze({ id: 'image', label: 'Images', extensions: imageExtensions, capabilities: ['image', 'imageExport', 'imageAtlas'] })
]);
export const mediaType = id => mediaTypes.find(type => type.id === id) || null;
export const detectMediaType = name => mediaTypes.find(type => type.extensions.includes(String(name).split('.').pop().toLowerCase())) || null;
export const hasCapability = (id, capability) => Boolean(mediaType(id)?.capabilities.includes(capability));
export const modelFormats = [['glb', 'GLB'], ['gltf', 'glTF'], ['fbx', 'FBX — via Blender'], ['obj', 'OBJ — geometry'], ['stl', 'STL — geometry'], ['ply', 'PLY — geometry']];
export const textureFormats = ['png', 'jpg', 'webp'];
export const audioFormats = ['wav', 'mp3', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'aiff', 'wma', 'ac3'];
