class CarPreview {
  constructor() {
    this.container = document.getElementById('car-model-container');
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.model = null; // currently displayed GLTF scene
    this.isInitialized = false;
    // Read vehicle selection (support both legacy 'vehicleType' and canonical 'vehicle')
    this.vehicleType = sessionStorage.getItem('vehicle') || sessionStorage.getItem('vehicleType') || 'car';
    this.currentCarColor = sessionStorage.getItem('carColor') || 'red';
    this.currentBikeFile = sessionStorage.getItem('bikeModel') || 'bike_teal.glb';

    this.modelRotation = 0;
    this.rotationSpeed = 0.01;
    this.modelBaseRotation = 0; // static offset for certain models

    this.isDragging = false;
    this.prevPointerX = 0;
    this.isLoading = false;

    // Display scale reference: keep cars similar to previous appearance
    this.carDisplayScale = 8;
    this.referenceDisplayHeight = null; // measured after loading a car
    this.desiredModelCenterY = 2; // place model center near camera lookAt
    this.minScale = 0.01;
    this.maxScale = 50;

    this.init();
  }

  init() {
    if (!this.container) return;

    // Create scene
    this.scene = new THREE.Scene();

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    this.scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xffffff, 2, 50);
    pointLight.position.set(0, 10, 5);
    this.scene.add(pointLight);

    // Set up camera
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    this.camera.position.set(0, 3, 8);
    this.camera.lookAt(0, 2, 0);

    // Set up renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // Wire up UI
    this.setupVehicleTypeToggle();
    this.renderColorOptions();
    this.setupColorChangeListener();

    // Pointer-based rotation
    this.setupPointerControls();

    // Add resize listener
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // Load initial model
    if (this.vehicleType === 'car') {
      this.loadModel('car', this.currentCarColor);
    } else {
      this.loadModel('bike', this.currentBikeFile);
    }

    // Start animation
    this.animate();
  }

  setupVehicleTypeToggle() {
    const toggles = document.querySelectorAll('.vehicle-type');
    if (!toggles.length) return;

    toggles.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-type');
        if (!type || this.vehicleType === type) return;
        this.vehicleType = type;
        // Persist canonical key and legacy key for compatibility
        sessionStorage.setItem('vehicle', type);
        sessionStorage.setItem('vehicleType', type);

        // Update active state
        toggles.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Re-render color options for the selected type
        this.renderColorOptions();

        // Load first option for the selected vehicle type
        if (this.vehicleType === 'car') {
          this.currentCarColor = sessionStorage.getItem('carColor') || 'red';
          this.loadModel('car', this.currentCarColor);
        } else {
          this.currentBikeFile = sessionStorage.getItem('bikeModel') || 'bike_teal.glb';
          this.loadModel('bike', this.currentBikeFile);
        }
      });
    });
  }

  renderColorOptions() {
    const container = document.querySelector('.color-options');
    if (!container) return;
    container.innerHTML = '';

    if (this.vehicleType === 'car') {
      // render car color options (matching existing palette)
      const colors = [
        { id: 'red', hex: '#ff7070' },
        { id: 'orange', hex: '#ffb766' },
        { id: 'yellow', hex: '#ffffa7' },
        { id: 'green', hex: '#429849' },
        { id: 'blue', hex: '#447bc9' },
        { id: 'indigo', hex: '#cc57d0' },
        { id: 'violet', hex: '#7c37b1' }
      ];

      colors.forEach(c => {
        const el = document.createElement('div');
        el.className = 'color-option' + (c.id === this.currentCarColor ? ' active' : '');
        el.setAttribute('data-color', c.id);
        el.style.backgroundColor = c.hex;
        container.appendChild(el);
      });
    } else {
      // Bikes: 3 bike glb files with representative colors
      const bikes = [
        { file: 'bike_teal.glb', hex: '#1abc9c' },
        { file: 'bike_sun.glb', hex: '#ffb766' },
        { file: 'bike_magenta.glb', hex: '#cc57d0' }
      ];

      bikes.forEach(b => {
        const el = document.createElement('div');
        el.className = 'color-option' + (b.file === this.currentBikeFile ? ' active' : '');
        el.setAttribute('data-file', b.file);
        el.style.backgroundColor = b.hex;
        container.appendChild(el);
      });
    }
  }

  setupColorChangeListener() {
    const parent = document.querySelector('.color-options');
    if (!parent) {
      console.warn('No color options container found');
      return;
    }

    parent.addEventListener('click', (ev) => {
      const option = ev.target.closest('.color-option');
      if (!option) return;

      // remove active from siblings
      parent.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
      option.classList.add('active');

      if (this.vehicleType === 'car') {
        const newColor = option.getAttribute('data-color');
        if (newColor && newColor !== this.currentCarColor) {
          this.currentCarColor = newColor;
          sessionStorage.setItem('carColor', newColor);
          this.loadModel('car', newColor);
        }
      } else {
        const file = option.getAttribute('data-file');
        if (file && file !== this.currentBikeFile) {
          this.currentBikeFile = file;
          sessionStorage.setItem('bikeModel', file);
          this.loadModel('bike', file);
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
            materials.forEach(m => this.disposeMaterial(m));
          }
        }
      });
    } catch (e) {
      console.warn('Error disposing model:', e);
    }
    try { this.scene.remove(obj); } catch (e) {}
  }

  disposeMaterial(mat) {
    if (!mat) return;
    try {
      if (mat.map) mat.map.dispose();
      if (mat.lightMap) mat.lightMap.dispose();
      if (mat.bumpMap) mat.bumpMap.dispose();
      if (mat.normalMap) mat.normalMap.dispose();
      if (mat.emissiveMap) mat.emissiveMap.dispose();
      if (mat.roughnessMap) mat.roughnessMap.dispose();
      if (mat.metalnessMap) mat.metalnessMap.dispose();
      if (mat.dispose) mat.dispose();
    } catch (e) {
      // ignore
    }
  }

  setModelOpacity(obj, value) {
    if (!obj) return;
    obj.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          m.transparent = true;
          m.opacity = value;
        });
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
    if (this.isLoading) return; // prevent concurrent loads
    this.isLoading = true;

    const loader = new THREE.GLTFLoader();

    // remove existing model first to avoid overlap
    if (this.model) {
      this.disposeModel(this.model);
      this.model = null;
    }

    let path = '';
    if (type === 'car') {
      path = `/models/car_${key}.glb`;
    } else {
      path = `/models/${key}`;
    }

    loader.load(path, (gltf) => {
      const node = gltf.scene;
      if (!node) {
        console.error('GLTF has no scene/root:', path);
        this.isLoading = false;
        return;
      }

      // start with neutral transforms so measurements are correct
      node.position.set(0, 0, 0);
      node.scale.set(1, 1, 1);

      // Apply any per-model base rotation before measuring (fixes orientation issues)
      let baseRotY = 0;
      if (type === 'bike' && typeof key === 'string' && key.toLowerCase().includes('bike_teal')) {
        baseRotY = Math.PI / 2; // 90 degrees
      }
      node.rotation.set(0, baseRotY, 0);
      this.modelBaseRotation = baseRotY;

      // compute natural size
      node.updateMatrixWorld(true);
      const naturalBox = new THREE.Box3().setFromObject(node);
      const naturalSize = naturalBox.getSize(new THREE.Vector3());
      const naturalHeight = naturalSize.y || 1;

      // determine scale
      let scale = 1;
      if (type === 'car') {
        scale = this.carDisplayScale;
      } else {
        if (this.referenceDisplayHeight && naturalHeight > 0) {
          scale = this.referenceDisplayHeight / naturalHeight;
        } else {
          // fallback: use same display scale as cars
          scale = this.carDisplayScale;
        }
      }

      // clamp scale to avoid runaway values
      scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
      node.scale.set(scale, scale, scale);

      // Update world matrices before recomputing bbox
      node.updateMatrixWorld(true);
      const finalBox = new THREE.Box3().setFromObject(node);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const finalCenter = finalBox.getCenter(new THREE.Vector3());

      // store reference height when loading a car
      if (type === 'car') {
        this.referenceDisplayHeight = finalSize.y;
      }

      // center model vertically so its center is at desiredModelCenterY
      const desiredCenterY = this.desiredModelCenterY;
      const deltaY = desiredCenterY - finalCenter.y;
      node.position.y += deltaY;

      // keep rotation state (preserve user rotation + base rotation)
      node.rotation.y = this.modelRotation + (this.modelBaseRotation || 0);

      // Ensure meshes cast/receive shadows if available
      node.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });

      // add to scene and fade in
      this.scene.add(node);
      this.model = node;
      this.isInitialized = true;
      this.isLoading = false;
      this.fadeInModel(this.model, 300);

      console.log(`Loaded preview model: ${path} (scale=${scale.toFixed(3)})`);
    }, undefined, (err) => {
      console.error('Error loading model:', path, err);
      this.isLoading = false;
      // fallback for cars
      if (type === 'car' && key !== 'red') {
        this.loadModel('car', 'red');
      }
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

// Initialize car/bike preview when the page loads
document.addEventListener('DOMContentLoaded', () => {
  const carPreview = new CarPreview();
});