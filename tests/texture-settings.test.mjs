import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture, Vector2, RepeatWrapping, NearestFilter } from 'three';
import { sidecarTextureSettings, applyTextureSettings } from '../src/managers/TextureSettings.mjs';
const definition = { nodes: { nodes: [{ name:'image', type:'ShaderNodeTexImage', image:{name:'ground'}, interpolation:'Closest' }, {name:'mapping',type:'ShaderNodeMapping',params:{Scale:[20,20,20],Location:[0,0,0],Rotation:[0,0,0]}}], links:[{from:{node:'mapping',socket:'Vector'},to:{node:'image',socket:'Vector'}}] } };
test('sidecar Mapping restores repeat and filtering after deferred texture repair', async () => {
  const { Group, Mesh, PlaneGeometry, MeshBasicMaterial } = await import('three');
  const { applySidecar } = await import('../src/managers/SidecarManager.mjs');
  const { TextureManager } = await import('../src/managers/TextureManager.mjs');
  const root=new Group(), mesh=new Mesh(new PlaneGeometry(),new MeshBasicMaterial());mesh.name='ground';root.add(mesh);
  await applySidecar(root,{objects:{ground:{materials:['ground']}},materials:{ground:{...definition,params:{base_color_texture:'ground'}}}},[]);
  const manager=new TextureManager();manager.decode=async()=>new Texture({width:2,height:2});
  await manager.apply(root,[{name:'ground.png'}],{repair:true});
  assert.deepEqual(mesh.material.map.repeat.toArray(),[20,20]);
  assert.equal(mesh.material.map.wrapS,RepeatWrapping);assert.equal(mesh.material.map.magFilter,NearestFilter);
});
test('Blender mapping rotation, scale and translation survive the glTF UV convention',()=>{
  const d=structuredClone(definition);d.nodes.nodes[1].params={Scale:[2,3,1],Location:[.2,.4,0],Rotation:[0,0,.3]};
  const texture=new Texture();applyTextureSettings(texture,sidecarTextureSettings(d,'ground'));
  const uv=new Vector2(.25,.7).applyMatrix3(texture.matrix);
  assert.ok(Math.abs(uv.x-(Math.cos(.3)*.5-Math.sin(.3)*.9+.2))<1e-10);
  assert.ok(Math.abs(uv.y-(1-(Math.sin(.3)*.5+Math.cos(.3)*.9+.4)))<1e-10);
});
