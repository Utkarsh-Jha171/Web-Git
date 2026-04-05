import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

class CarPreview {
  constructor() {
    this.container = document.getElementById('car-model-container');
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.model = null;
    this.isInitialized = false;
    this.vehicleType = sessionStorage.getItem('vehicle') || sessionStorage.getItem('vehicleType') || 'car';
    this.currentCarColor = sessionStorage.getItem('carColor') || 'red';
    this.currentBikeColor = sessionStorage.getItem('carColor') || 'red';

    this.modelRotation = 0;
    this.rotationSpeed = 0.01;
    this.modelBaseRotation = 0;

    this.isDragging = false;
    this.prevPointerX = 0;
    this.isLoading = false;

    this.carDisplayScale = 8;
    this.referenceDisplayHeight = null;
    this.desiredModelCenterY = 2;
    this.minScale = 0.01;
    this.maxScale = 50;

    this.loader = new GLTFLoader();

    this.init();
  }

  init() {
    if (!this.container) {
      console.error('CarPreview: #car-model-container not found');
      return;
    }

    this.scene = new THREE.Scene();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    this.scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xffffff, 2, 50);
    pointLight.position.set(0, 10, 5);
    this.scene.add(pointLight);

    const width = this.container.clientWidth || 400;
    const height = this.container.clientHeight || 300;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    this.camera.position.set(0, 3, 8);
    this.camera.lookAt(0, 2, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.setupVehicleTypeToggle();
    this.renderColorOptions();
    this.setupColorChangeListener();
    this.setupPointerControls();

    window.addEventListener('resize', this.onWindowResize.bind(this));

    if (this.vehicleType === 'car') {
      this.loadModel('car', this.currentCarColor);
    } else {
      this.loadModel('bike', this.currentBikeColor);
    }

    this.animate();
    console.log('CarPreview initialized');
  }

  setupVehicleTypeToggle() {
    const toggles = document.querySelectorAll('.vehicle-type');
    if (!toggles.length) return;

    toggles.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-type');
        if (!type || this.vehicleType === type) return;
        this.vehicleType = type;
        sessionStorage.setItem('vehicle', type);
        sessionStorage.setItem('vehicleType', type);

        toggles.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.renderColorOptions();

        if (this.vehicleType === 'car') {
          this.currentCarColor = sessionStorage.getItem('carColor') || 'red';
          this.loadModel('car', this.currentCarColor);
        } else {
          this.currentBikeColor = sessionStorage.getItem('carColor') || 'red';
          this.loadModel('bike', this.currentBikeColor);
        }
      });
    });
  }

  renderColorOptions() {
    const container = document.querySelector('.color-options');
    if (!container) return;
    container.innerHTML = '';

    const colors = [
      { id: 'red', hex: '#ff7070' },
      { id: 'orange', hex: '#ffb766' },
      { id: 'yellow', hex: '#ffffa7' },
      { id: 'green', hex: '#429849' },
      { id: 'blue', hex: '#447bc9' },
      { id: 'indigo', hex: '#cc57d0' },
      { id: 'violet', hex: '#7c37b1' }
    ];

    const activeColor = this.vehicleType === 'car' ? this.currentCarColor : this.currentBikeColor;

    colors.forEach(c => {
      const el = document.createElement('div');
      el.className = 'color-option' + (c.id === activeColor ? ' active' : '');
      el.setAttribute('data-color', c.id);
      el.style.backgroundColor = c.hex;
      container.appendChild(el);
    });
  }

  setupColorChangeListener() {
    const parent = document.querySelector('.color-options');
    if (!parent) return;

    parent.addEventListener('click', (ev) => {
      const option = ev.target.closest('.color-option');
      if (!option) return;

      parent.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
      option.classList.add('active');

      const newColor = option.getAttribute('data-color');
      if (!newColor) return;

      sessionStorage.setItem('carColor', newColor);

      if (this.vehicleType === 'car') {
        if (newColor !== this.currentCarColor) {
          this.currentCarColor = newColor;
          this.loadModel('car', newColor);
        }
      } else {
        if (newColor !== this.currentBikeColor) {
          this.currentBikeColor = newColor;
          this.loadModel('bike', newColor);
        }
      }
    });
  }

  setupPointerControls() {
    const canvas = this.renderer ? this.renderer.domElement : null;
    if (!canvas) return;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.prevPointerX = e.clientX;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging || !this.model) return;
      const dx = e.clientX - this.prevPointerX;
      this.prevPointerX = e.clientX;
      this.modelRotation += dx * 0.01;
      this.model.rotation.y = this.modelRotation;
    });

    const endDrag = (e) => {
      this.isDragging = false;
      try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      canvas.style.cursor = 'grab';
    };

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerout', endDrag);
  }

  disposeModel(obj) {
    if (!obj) return;
    try {
      obj.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(m => {
              ['map','lightMap','bumpMap','normalMap','emissiveMap','roughnessMap','metalnessMap'].forEach(k => {
                if (m[k]) m[k].dispose();
              });
              if (m.dispose) m.dispose();
            });
          }
        }
      });
    } catch (e) {}
    try { this.scene.remove(obj); } catch (e) {}
  }

  setModelOpacity(obj, value) {
    if (!obj) return;
    obj.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => { m.transparent = true; m.opacity = value; });
      }
    });
  }

  fadeInModel(obj, duration = 300) {
    if (!obj) return;
    this.setModelOpacity(obj, 0);
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      this.setModelOpacity(obj, t);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  loadModel(type = 'car', key = 'red') {
    if (!this.container) return;
    if (this.isLoading) return;
    this.isLoading = true;

    const path = `/models/car_${key}.glb`;
    console.log(`CarPreview: loading ${path} (type=${type})`);

    if (this.model) {
      this.disposeModel(this.model);
      this.model = null;
    }

    this.loader.load(path, (gltf) => {
      const node = gltf.scene;
      if (!node) {
        console.error('No scene in GLTF:', path);
        this.isLoading = false;
        return;
      }

      node.position.set(0, 0, 0);
      node.scale.set(1, 1, 1);
      this.modelBaseRotation = 0;

      node.updateMatrixWorld(true);
      const naturalBox = new THREE.Box3().setFromObject(node);
      const naturalSize = naturalBox.getSize(new THREE.Vector3());
      const naturalHeight = naturalSize.y || 1;

      let scale = this.carDisplayScale;
      scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
      node.scale.set(scale, scale, scale);

      node.updateMatrixWorld(true);
      const finalBox = new THREE.Box3().setFromObject(node);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const finalCenter = finalBox.getCenter(new THREE.Vector3());

      if (type === 'car') {
        this.referenceDisplayHeight = finalSize.y;
      }

      const deltaY = this.desiredModelCenterY - finalCenter.y;
      node.position.y += deltaY;
      node.rotation.y = this.modelRotation + this.modelBaseRotation;

      node.traverse((c) => {
        if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
      });

      // === BIKE RESHAPE ===
      if (type === 'bike') {
        let bodyMaterial = null;
        // Hide original car chassis
        node.traverse((child) => {
          if (child.isMesh && (!child.name || !child.name.toLowerCase().includes('wheel'))) {
            child.visible = false;
            if (!bodyMaterial) bodyMaterial = child.material;
          }
        });

        const bikeBody = new THREE.Group();
        if (!bodyMaterial) bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.4 });

        const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.4 });
        const chromeMaterial = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.2, metalness: 0.8 });
        
        // 1. Central Frame Pipe
        const frameGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 16);
        frameGeo.rotateX(Math.PI / 2.5);
        const frame = new THREE.Mesh(frameGeo, darkMaterial);
        frame.position.set(0, 0.2, 0);
        frame.castShadow = true;
        bikeBody.add(frame);
        
        // 2. Fuel Tank
        const tankGeo = new THREE.BoxGeometry(0.25, 0.2, 0.5);
        const tank = new THREE.Mesh(tankGeo, bodyMaterial);
        tank.position.set(0, 0.45, 0.2);
        tank.rotation.x = -0.1;
        tank.castShadow = true;
        bikeBody.add(tank);
        
        // 3. Seat
        const seatGeo = new THREE.BoxGeometry(0.2, 0.05, 0.6);
        const seat = new THREE.Mesh(seatGeo, darkMaterial);
        seat.position.set(0, 0.4, -0.3);
        seat.castShadow = true;
        bikeBody.add(seat);
        
        // 4. Engine Block
        const engineGeo = new THREE.BoxGeometry(0.2, 0.3, 0.4);
        const engine = new THREE.Mesh(engineGeo, chromeMaterial);
        engine.position.set(0, 0.1, 0.1);
        engine.castShadow = true;
        bikeBody.add(engine);

        // 5. Handlebars
        const handlesGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8);
        handlesGeo.rotateZ(Math.PI / 2);
        const handles = new THREE.Mesh(handlesGeo, darkMaterial);
        handles.position.set(0, 0.6, 0.4);
        handles.castShadow = true;
        bikeBody.add(handles);

        // 6. Exhaust Pipe
        const exhaustGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.8, 8);
        exhaustGeo.rotateX(Math.PI / 2);
        const exhaust = new THREE.Mesh(exhaustGeo, chromeMaterial);
        exhaust.position.set(0.15, 0.05, -0.2);
        exhaust.castShadow = true;
        bikeBody.add(exhaust);

        node.add(bikeBody);

        // Find wheels by name
        const allWheelNames = ['wheel-fl','wheel-fr','wheel-bl','wheel-br'];
        const wheelNodes = {};
        node.traverse(child => {
          allWheelNames.forEach(n => {
            if (child.name && child.name.toLowerCase() === n) wheelNodes[n] = child;
          });
        });

        // Keep front-right ('wheel-fr') and back-left ('wheel-bl') as front/rear
        ['wheel-fl','wheel-br'].forEach(n => {
          const w = wheelNodes[n];
          if (w && w.parent) w.parent.remove(w);
        });

        // Center remaining wheels on X=0
        ['wheel-fr','wheel-bl'].forEach(n => {
          const w = wheelNodes[n];
          if (w) {
            w.position.x = 0;
            // No scale fixing needed anymore because we didn't squish the master node
          }
        });
      }
      // === END BIKE RESHAPE ===

      this.scene.add(node);
      this.model = node;
      this.isInitialized = true;
      this.isLoading = false;
      this.fadeInModel(this.model, 300);
      console.log(`CarPreview: loaded ${path}`);
    }, undefined, (err) => {
      console.error('CarPreview load error:', path, err);
      this.isLoading = false;
    });
  }

  onWindowResize() {
    if (!this.camera || !this.renderer || !this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));
    if (this.model && this.isInitialized && !this.isDragging) {
      this.modelRotation += this.rotationSpeed;
      this.model.rotation.y = this.modelRotation + (this.modelBaseRotation || 0);
    }
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// Initialize once DOM is ready (this file is a Vite ES module, loaded with defer)
document.addEventListener('DOMContentLoaded', () => {
  new CarPreview();
});