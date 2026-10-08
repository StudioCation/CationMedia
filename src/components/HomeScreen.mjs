import metadata from '../../package.json';
import { toolIcon } from './Controls.mjs';

export class HomeScreen {
  constructor(host, open) {
    this.element = document.createElement('section'); this.element.dataset.mediaView = 'home'; this.element.className = 'home-screen';
    this.element.innerHTML = `<div class="home-content"><div class="home-brand"><img src="./icon.png" width="42" height="42" alt=""><h1>CationMedia</h1></div><p class="home-intro">Open a file to get started</p><div class="home-choices"><button id="home-sounds" class="home-choice" aria-label="Sounds"><span class="home-icon">${toolIcon('wave-sine')}</span><strong>Sounds</strong><span>Waveform, playback & editing</span><small>WAV · MP3 · FLAC · OGG · more</small></button><button id="home-viewer" class="home-choice" aria-label="Viewer 3D"><span class="home-icon">${toolIcon('cube')}</span><strong>Viewer 3D</strong><span>Models, materials & animation</span><small>GLB · FBX · OBJ · BLEND · more</small></button></div><p class="home-drop">Drop files anywhere in this window</p><p class="inspector-note">Models and their textures can be dropped together.</p><button id="home-open" class="quiet">Open any supported file <kbd>Ctrl O</kbd></button></div>`;
    const version = document.createElement('p'); version.className = 'home-version'; version.textContent = `Version ${metadata.version}`;
    this.element.querySelector('.home-brand').after(version);
    host.append(this.element);
    const video = document.createElement('button'); video.id = 'home-video'; video.className = 'home-choice'; video.innerHTML = `<span class="home-icon">${toolIcon('player-play')}</span><strong>Video</strong><span>Playback, crop & conversion</span><small>MP4 · MOV · MKV · WebM · more</small>`; video.onclick = () => open('video'); this.element.querySelector('.home-choices').append(video);
    const images = document.createElement('button'); images.id = 'home-images'; images.className = 'home-choice'; images.innerHTML = '<span class="home-icon"><span class="home-image-glyph" aria-hidden="true"></span></span><strong>Images</strong><span>Viewing, editing & atlases</span><small>JPEG · TIFF · PNG · GIF · WebP · BMP</small>'; images.onclick = () => open('image'); this.element.querySelector('.home-choices').append(images);
    this.element.querySelector('#home-sounds').onclick = () => open('audio');
    this.element.querySelector('#home-viewer').onclick = () => open('model3d');
    this.element.querySelector('#home-open').onclick = () => open();
  }
}
