import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Vehicle parameters
const VEHICLE_WIDTH = 2.0;
const VEHICLE_HEIGHT = 0.6;
const VEHICLE_LENGTH = 4.0;
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH = 0.25;
const SUSPENSION_REST_LENGTH = 0.3;
const WHEEL_X_OFFSET = 0.8;
const WHEEL_Z_OFFSET = 1.5;

// Physics tuning parameters
const SUSPENSION_STIFFNESS = 50;
const SUSPENSION_DAMPING = 10;
const SUSPENSION_COMPRESSION = 4.0;
const ROLL_INFLUENCE = 0.1;
const WHEEL_FRICTION = 10;

// Steering parameters
const MAX_STEERING_ANGLE = 0.15;
const STEERING_SPEED = 1.5;
const STEERING_RETURN_SPEED = 2; 

// Modify createVehicle to accept a callback for when the car is fully loaded
export function createVehicle(ammo, scene, physicsWorld, debugObjects, onCarLoaded) {
  console.log("Starting vehicle creation");
  
  // Use the global loadingManager
  const loader = new GLTFLoader(window.loadingManager);
  
  // Car components that will be returned immediately for physics setup
  const carComponents = {
    carBody: null,
    vehicle: null,
    wheelMeshes: [],
    carModel: null,
    currentSteeringAngle: 0
  };
  
  // Create chassis physics body with modified dimensions
  const chassisShape = new ammo.btBoxShape(
    new ammo.btVector3(VEHICLE_WIDTH/2, VEHICLE_HEIGHT/2 * 0.8, VEHICLE_LENGTH/2 * 0.9)
  );
  
  const chassisTransform = new ammo.btTransform();
  chassisTransform.setIdentity();
  // Move the chassis origin up slightly to prevent underbody scraping
  chassisTransform.setOrigin(new ammo.btVector3(0, 5.2, 0));
  
  const chassisMotionState = new ammo.btDefaultMotionState(chassisTransform);
  const chassisMass = 200;
  const localInertia = new ammo.btVector3(0, 0, 0);
  chassisShape.calculateLocalInertia(chassisMass, localInertia);
  
  const chassisRbInfo = new ammo.btRigidBodyConstructionInfo(
    chassisMass, chassisMotionState, chassisShape, localInertia
  );
  
  carComponents.carBody = new ammo.btRigidBody(chassisRbInfo);
  carComponents.carBody.setActivationState(4); 
  carComponents.carBody.setFriction(0.1);
  physicsWorld.addRigidBody(carComponents.carBody);
  
  // Create vehicle raycaster
  const tuning = new ammo.btVehicleTuning();
  const vehicleRaycaster = new ammo.btDefaultVehicleRaycaster(physicsWorld);
  carComponents.vehicle = new ammo.btRaycastVehicle(tuning, carComponents.carBody, vehicleRaycaster);
  
  // Configure vehicle
  carComponents.vehicle.setCoordinateSystem(0, 1, 2); 
  physicsWorld.addAction(carComponents.vehicle);
  
  // Wheel directions and axles
  const wheelDirCS = new ammo.btVector3(0, -1, 0);
  const wheelAxleCS = new ammo.btVector3(-1, 0, 0);
  
  // Add all four wheels
  const wheelPositions = [
    { x: -WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET, name: 'wheel-fl' }, 
    { x: WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET, name: 'wheel-fr' },  
    { x: -WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-bl' }, 
    { x: WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-br' }  
  ];
  
  // Create wheels with physics (but without visuals yet)
  for (let i = 0; i < wheelPositions.length; i++) {
    const pos = wheelPositions[i];
    const isFront = i < 2; 
    
    // Connect wheel to vehicle
    const connectionPoint = new ammo.btVector3(pos.x, pos.y, pos.z);
    carComponents.vehicle.addWheel(
      connectionPoint,
      wheelDirCS,
      wheelAxleCS,
      SUSPENSION_REST_LENGTH,
      WHEEL_RADIUS,
      tuning,
      isFront
    );
    
    // Configure wheel
    const wheelInfo = carComponents.vehicle.getWheelInfo(i);
    wheelInfo.set_m_suspensionStiffness(SUSPENSION_STIFFNESS);
    wheelInfo.set_m_wheelsDampingRelaxation(SUSPENSION_DAMPING);
    wheelInfo.set_m_wheelsDampingCompression(SUSPENSION_COMPRESSION);
    wheelInfo.set_m_frictionSlip(WHEEL_FRICTION);
    wheelInfo.set_m_rollInfluence(ROLL_INFLUENCE);
    wheelInfo.set_m_maxSuspensionTravelCm(SUSPENSION_REST_LENGTH * 150); 
    
    // Add a placeholder for the wheel mesh
    carComponents.wheelMeshes.push(null);
  }
  
  // Now load the car model with a callback
  loadCarModel(ammo, scene, carComponents, wheelPositions, (updatedComponents) => {
    console.log("Car model fully loaded, calling onCarLoaded callback");
    // When the car model is fully loaded, call the callback with the updated components
    if (onCarLoaded) onCarLoaded(updatedComponents);
  });
  
  // Return physics body immediately for setting up physics
  return carComponents;
}

// Modify loadCarModel to accept and use a callback
function loadCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded) {
  const loader = new GLTFLoader();
  
  // Get the player ID
  const myPlayerId = localStorage.getItem('myPlayerId');
  
  // Determine vehicle and model selection (priority: gameConfig -> sessionStorage)
  let carColor = 'red';
  let vehicle = 'car';
  let bikeModel = null;

  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      const gameConfig = JSON.parse(savedConfig);
      if (gameConfig && gameConfig.players) {
        const playerInfo = gameConfig.players.find(p => p.id === myPlayerId) || gameConfig.players[0];
        if (playerInfo) {
          if (playerInfo.playerColor) carColor = playerInfo.playerColor;
          if (playerInfo.vehicle) vehicle = playerInfo.vehicle;
          if (playerInfo.vehicleModel) bikeModel = playerInfo.vehicleModel;
          console.log('Using player info from gameConfig:', playerInfo);
        }
      }
    }
  } catch (e) {
    console.error('Error reading gameConfig for vehicle info:', e);
  }

  // Fallbacks to sessionStorage
  const storedColor = sessionStorage.getItem('carColor');
  if (storedColor) carColor = storedColor;
  vehicle = sessionStorage.getItem('vehicle') || sessionStorage.getItem('vehicleType') || vehicle;
  bikeModel = bikeModel || sessionStorage.getItem('bikeModel') || 'bike_teal.glb';

  // If car: restore original car loading behavior (scale=4, detach wheel meshes, create cylinder fallbacks)
  if (vehicle === 'car') {
    const carPath = `/models/car_${carColor}.glb`;
    console.log('Loading car model:', carPath);
    loader.load(
      carPath,
      (gltf) => {
        const carModel = gltf.scene;

        // Adjust model scale and position as original
        carModel.scale.set(4, 4, 4);
        carModel.position.set(0, 0, 0);

        carModel.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = false;
          }
        });

        // Find wheel meshes in the car model (original name checks)
        let wheelMeshFL = carModel.getObjectByName('wheel-fr');
        let wheelMeshFR = carModel.getObjectByName('wheel-fl');
        let wheelMeshBL = carModel.getObjectByName('wheel-br');
        let wheelMeshBR = carModel.getObjectByName('wheel-bl');

        const wheelModelMeshes = [wheelMeshFL, wheelMeshFR, wheelMeshBL, wheelMeshBR];

        for (let i = 0; i < wheelModelMeshes.length; i++) {
          if (wheelModelMeshes[i]) {
            try { wheelModelMeshes[i].updateMatrixWorld(true); } catch (e) {}
            try { carModel.remove(wheelModelMeshes[i]); } catch (e) {}
            scene.add(wheelModelMeshes[i]);
            wheelModelMeshes[i].scale.set(4, 4, 4);
            carComponents.wheelMeshes[i] = wheelModelMeshes[i];
            console.log(`Found and set up wheel: ${wheelPositions[i].name}`);
          } else {
            console.warn(`Could not find wheel mesh: ${wheelPositions[i].name}`);
            // Create a default wheel as fallback (original behavior)
            const wheelGeometry = new THREE.CylinderGeometry(
              WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
            );
            wheelGeometry.rotateZ(Math.PI/2);
            const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
            const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
            wheelMesh.castShadow = true;
            scene.add(wheelMesh);
            wheelMesh.scale.set(4, 4, 4);
            carComponents.wheelMeshes[i] = wheelMesh;
          }
        }

        scene.add(carModel);
        carComponents.carModel = carModel;

        console.log('Car model loaded successfully');
        if (onModelLoaded) onModelLoaded(carComponents);
      },
      undefined,
      (error) => {
        console.error(`Error loading car model ${carPath}:`, error);
        if (carColor !== 'red') {
          loadFallbackCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded);
        }
      }
    );
  } else {
    // Bike (or other) path: keep normalized loader (for correct sizing and orientation)
    const bikePath = `/models/${bikeModel}`;
    console.log('Loading bike model:', bikePath);
    loader.load(
      bikePath,
      (gltf) => {
        const carModel = gltf.scene;

        // Normalize model size based on bounding box
        carModel.position.set(0, 0, 0);
        carModel.scale.set(1, 1, 1);

        // Apply per-model base rotation before measuring to correct orientation issues
        let baseRotY = 0;
        if (bikeModel && bikeModel.toLowerCase().includes('bike_teal')) {
          baseRotY = Math.PI / 2; // rotate 90 degrees on Y for bike_teal
        }
        carModel.rotation.set(0, baseRotY, 0);
        carModel.updateMatrixWorld(true);

        const naturalBox = new THREE.Box3().setFromObject(carModel);
        const naturalSize = naturalBox.getSize(new THREE.Vector3());
        const naturalHeight = naturalSize.y || 1;

        const desiredHeight = VEHICLE_HEIGHT * 4; // keep legacy multiplier
        let scale = desiredHeight / naturalHeight;
        if (!isFinite(scale) || scale <= 0) scale = 4;
        scale = Math.max(0.01, Math.min(50, scale));
        carModel.scale.set(scale, scale, scale);

        carModel.updateMatrixWorld(true);
        const finalBox = new THREE.Box3().setFromObject(carModel);
        const finalCenter = finalBox.getCenter(new THREE.Vector3());
        const finalMin = finalBox.min;

        // Align bottom of model to y=0
        const deltaY = -finalMin.y;
        carModel.position.y += deltaY;

        carModel.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = false;
          }
        });

        // Try to attach wheel meshes if present, otherwise leave visuals as-is (no procedural wheels)
        const wheelNames = ['wheel-fl', 'wheel-fr', 'wheel-bl', 'wheel-br'];
        const wheelModelMeshes = [];
        wheelNames.forEach((name) => {
          let mesh = carModel.getObjectByName(name);
          if (!mesh) {
            carModel.traverse((child) => {
              if (!mesh && child.isMesh && child.name && child.name.toLowerCase().includes('wheel')) {
                mesh = child;
              }
            });
          }
          wheelModelMeshes.push(mesh || null);
        });

        for (let i = 0; i < wheelModelMeshes.length; i++) {
          const mesh = wheelModelMeshes[i];
          if (mesh) {
            try { mesh.updateMatrixWorld(true); } catch (e) {}
            try { carModel.remove(mesh); } catch (e) {}
            scene.add(mesh);
            mesh.scale.copy(carModel.scale);
            carComponents.wheelMeshes[i] = mesh;
            console.log(`Attached wheel mesh for ${wheelPositions[i].name}`);
          } else {
            console.warn(`No wheel mesh found for ${wheelPositions[i].name}; leaving visual empty (no procedural wheel created)`);
            carComponents.wheelMeshes[i] = null;
          }
        }

        scene.add(carModel);
        carComponents.carModel = carModel;

        console.log('Vehicle model loaded successfully');
        if (onModelLoaded) onModelLoaded(carComponents);
      },
      undefined,
      (error) => {
        console.error(`Error loading bike model ${bikePath}:`, error);
      }
    );
  }
}

// Update fallback model function to also use callback
function loadFallbackCarModel(ammo, scene, carComponents, wheelPositions, onModelLoaded) {
  console.log('Falling back to red car model');
  const loader = new GLTFLoader();

  loader.load(
    '/models/car_red.glb',
    (gltf) => {
      const carModel = gltf.scene;

      // Adjust model scale and position
      carModel.scale.set(4, 4, 4);
      carModel.position.set(0, 0, 0);

      // Make sure car casts shadows
      carModel.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = false;
        }
      });

      // Process wheel meshes (same as in loadCarModel)
      let wheelMeshFL = carModel.getObjectByName('wheel-fr');
      let wheelMeshFR = carModel.getObjectByName('wheel-fl');
      let wheelMeshBL = carModel.getObjectByName('wheel-br');
      let wheelMeshBR = carModel.getObjectByName('wheel-bl');

      const wheelModelMeshes = [wheelMeshFL, wheelMeshFR, wheelMeshBL, wheelMeshBR];

      for (let i = 0; i < wheelModelMeshes.length; i++) {
        if (wheelModelMeshes[i]) {
          wheelModelMeshes[i].updateMatrixWorld(true);
          carModel.remove(wheelModelMeshes[i]);
          scene.add(wheelModelMeshes[i]);
          wheelModelMeshes[i].scale.set(4, 4, 4);
          carComponents.wheelMeshes[i] = wheelModelMeshes[i];
        } else {
          // Create default wheel
          const wheelGeometry = new THREE.CylinderGeometry(
            WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
          );
          wheelGeometry.rotateZ(Math.PI/2);

          const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
          const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
          wheelMesh.castShadow = true;
          scene.add(wheelMesh);

          wheelMesh.scale.set(4, 4, 4);
          carComponents.wheelMeshes[i] = wheelMesh;
        }
      }

      scene.add(carModel);
      carComponents.carModel = carModel;

      console.log('Fallback car model loaded successfully');

      // Call the callback when complete
      if (onModelLoaded) onModelLoaded(carComponents);
    },
    undefined,
    (error) => {
      console.error('Error loading fallback red car model:', error);
    }
  );
}

// Update steering based on key state
export function updateSteering(deltaTime, vehicle, keyState, currentSteeringAngle, currentSpeed = 0) {
  // Calculate dynamic maximum steering angle based on speed
  const maxSteeringAngle = calculateMaxSteeringAngle(currentSpeed);
  
  // Calculate target steering angle based on key state
  let targetSteeringAngle = 0;
  
  if (keyState.a) {
    targetSteeringAngle = maxSteeringAngle; 
  } else if (keyState.d) {
    targetSteeringAngle = -maxSteeringAngle;
  }
  
  // Determine appropriate steering speed
  const steeringSpeed = (targetSteeringAngle === 0 || 
                         (currentSteeringAngle > 0 && targetSteeringAngle < 0) || 
                         (currentSteeringAngle < 0 && targetSteeringAngle > 0)) ? 
    STEERING_RETURN_SPEED : 
    STEERING_SPEED;         
  
  // Smoothly interpolate current steering angle towards target
  const steeringDelta = targetSteeringAngle - currentSteeringAngle;
  const maxSteeringDelta = steeringSpeed * deltaTime;
  
  let newSteeringAngle = currentSteeringAngle;
  
  // Limit the steering change per frame
  if (Math.abs(steeringDelta) > maxSteeringDelta) {
    newSteeringAngle += Math.sign(steeringDelta) * maxSteeringDelta;
  } else {
    newSteeringAngle = targetSteeringAngle;
  }
  
  // Apply steering to front wheels
  for (let i = 0; i < 2; i++) {
    vehicle.setSteeringValue(newSteeringAngle, i);
  }
  
  return newSteeringAngle;
}

// Add a new function to calculate max steering angle based on speed
function calculateMaxSteeringAngle(speedKPH) {
  // Constants for steering behavior
  const MIN_SPEED = 0;   
  const MAX_SPEED = 150; 
  const MIN_ANGLE = 0.15;
  const MAX_ANGLE = 0.4; 
  
  // Clamp the speed to avoid extreme values
  const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speedKPH));
  
  const speedFactor = (clampedSpeed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  const steeringAngle = MAX_ANGLE - speedFactor * (MAX_ANGLE - MIN_ANGLE);
  
  return steeringAngle;
}

// Reset car position 
export function resetCarPosition(ammo, carBody, vehicle, currentSteeringAngle, currentGatePosition, currentGateQuaternion) {
  // Cancel all movement
  const zero = new ammo.btVector3(0, 0, 0);
  carBody.setLinearVelocity(zero);
  carBody.setAngularVelocity(zero);
  
  // Reset position transform
  const resetTransform = new ammo.btTransform();
  resetTransform.setIdentity();
  resetTransform.setOrigin(new ammo.btVector3(
    currentGatePosition.x, 
    currentGatePosition.y + 2, 
    currentGatePosition.z
  )); 
  
  const rotQuat = new ammo.btQuaternion(
    currentGateQuaternion.x,
    currentGateQuaternion.y,
    currentGateQuaternion.z,
    currentGateQuaternion.w
  );
  resetTransform.setRotation(rotQuat);
  
  // Apply transform
  carBody.setWorldTransform(resetTransform);
  carBody.getMotionState().setWorldTransform(resetTransform);
  
  // Reset steering
  let newSteeringAngle = 0;
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    if (i < 2) { // Front wheels only
      vehicle.setSteeringValue(0, i);
    }
    
    // Reset wheel rotation and position
    vehicle.updateWheelTransform(i, true);
  }
  
  // Clean up
  ammo.destroy(zero);
  ammo.destroy(rotQuat);
  ammo.destroy(resetTransform);
  
  return newSteeringAngle;
}

// Update car and wheel positions from physics
export function updateCarPosition(ammo, vehicle, carModel, wheelMeshes) {
  if (!vehicle || !carModel) return;
  
  // Update chassis transform
  const chassisWorldTrans = vehicle.getChassisWorldTransform();
  const position = chassisWorldTrans.getOrigin();
  const quaternion = chassisWorldTrans.getRotation();

  // Update car model position
  carModel.position.set(position.x(), position.y(), position.z());
  carModel.quaternion.set(quaternion.x(), quaternion.y(), quaternion.z(), quaternion.w());
  
  // Update wheel transforms
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    // Sync wheels with physics
    vehicle.updateWheelTransform(i, true);
    const transform = vehicle.getWheelInfo(i).get_m_worldTransform();
    const wheelPosition = transform.getOrigin();
    const wheelQuaternion = transform.getRotation();
    // Only update visual wheel if a mesh exists (do not create procedural wheels)
    if (wheelMeshes[i]) {
      wheelMeshes[i].position.set(wheelPosition.x(), wheelPosition.y(), wheelPosition.z());
      wheelMeshes[i].quaternion.set(
        wheelQuaternion.x(), 
        wheelQuaternion.y(), 
        wheelQuaternion.z(), 
        wheelQuaternion.w()
      );
    }
  }
}