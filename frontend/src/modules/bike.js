import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Vehicle parameters
const VEHICLE_WIDTH = 0.8;
const VEHICLE_HEIGHT = 1.0;
const VEHICLE_LENGTH = 2.5;
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH = 0.2;
const SUSPENSION_REST_LENGTH = 0.3;
const WHEEL_Z_OFFSET = 1.3;

// Physics tuning parameters
const SUSPENSION_STIFFNESS = 50;
const SUSPENSION_DAMPING = 10;
const SUSPENSION_COMPRESSION = 4.0;
const ROLL_INFLUENCE = 0.1;
const WHEEL_FRICTION = 20;  // Kept at 20 (2x car's 10) to match total grip since bike only has 2 contact points

// Steering parameters
const MIN_STEERING_ANGLE = 0.15;
const MAX_STEERING_ANGLE = 0.4;
const STEERING_SPEED = 1.5;
const STEERING_RETURN_SPEED = 2;

export function createBike(ammo, scene, physicsWorld, debugObjects, onBikeLoaded) {
  console.log("Starting bike creation");

  const loader = new GLTFLoader(window.loadingManager);

  const bikeComponents = {
    carBody: null,
    vehicle: null,
    wheelMeshes: [],
    carModel: null,
    currentSteeringAngle: 0
  };

  // Create chassis physics body
  const chassisShape = new ammo.btBoxShape(
    new ammo.btVector3(VEHICLE_WIDTH / 2, VEHICLE_HEIGHT / 2 * 0.8, VEHICLE_LENGTH / 2 * 0.9)
  );

  const chassisTransform = new ammo.btTransform();
  chassisTransform.setIdentity();
  chassisTransform.setOrigin(new ammo.btVector3(0, 5.2, 0));

  const chassisMotionState = new ammo.btDefaultMotionState(chassisTransform);
  const chassisMass = 200; // Matched car's mass for equal acceleration curve
  const localInertia = new ammo.btVector3(0, 0, 0);
  chassisShape.calculateLocalInertia(chassisMass, localInertia);

  const chassisRbInfo = new ammo.btRigidBodyConstructionInfo(
    chassisMass, chassisMotionState, chassisShape, localInertia
  );

  bikeComponents.carBody = new ammo.btRigidBody(chassisRbInfo);
  bikeComponents.carBody.setActivationState(4);
  bikeComponents.carBody.setFriction(0.1);
  bikeComponents.carBody.setDamping(0.05, 0.3); // (linearDamping, angularDamping)

  // Allow all rotations so the vehicle can pitch up and down hills properly
  // We will stabilize roll (Z axis) manually using custom torques
  const upritAngularFactor = new ammo.btVector3(1, 1, 1);
  bikeComponents.carBody.setAngularFactor(upritAngularFactor);
  ammo.destroy(upritAngularFactor);

  physicsWorld.addRigidBody(bikeComponents.carBody);

  const tuning = new ammo.btVehicleTuning();
  const vehicleRaycaster = new ammo.btDefaultVehicleRaycaster(physicsWorld);
  bikeComponents.vehicle = new ammo.btRaycastVehicle(tuning, bikeComponents.carBody, vehicleRaycaster);

  bikeComponents.vehicle.setCoordinateSystem(0, 1, 2);
  physicsWorld.addAction(bikeComponents.vehicle);

  const wheelDirCS = new ammo.btVector3(0, -1, 0);
  const wheelAxleCS = new ammo.btVector3(-1, 0, 0);

  // Add two wheels (front and back)
  const wheelPositions = [
    { x: 0, y: 0, z: WHEEL_Z_OFFSET, name: 'wheel-f' }, // front
    { x: 0, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-b' } // rear
  ];

  for (let i = 0; i < wheelPositions.length; i++) {
    const pos = wheelPositions[i];
    const isFront = (i === 0);

    const connectionPoint = new ammo.btVector3(pos.x, pos.y, pos.z);
    bikeComponents.vehicle.addWheel(
      connectionPoint,
      wheelDirCS,
      wheelAxleCS,
      SUSPENSION_REST_LENGTH,
      WHEEL_RADIUS,
      tuning,
      isFront
    );

    const wheelInfo = bikeComponents.vehicle.getWheelInfo(i);
    wheelInfo.set_m_suspensionStiffness(SUSPENSION_STIFFNESS);
    wheelInfo.set_m_wheelsDampingRelaxation(SUSPENSION_DAMPING);
    wheelInfo.set_m_wheelsDampingCompression(SUSPENSION_COMPRESSION);
    wheelInfo.set_m_frictionSlip(WHEEL_FRICTION);
    wheelInfo.set_m_rollInfluence(ROLL_INFLUENCE);
    wheelInfo.set_m_maxSuspensionTravelCm(SUSPENSION_REST_LENGTH * 150);

    bikeComponents.wheelMeshes.push(null); // Placeholders
  }

  loadBikeModel(ammo, scene, bikeComponents, wheelPositions, (updatedComponents) => {
    if (onBikeLoaded) onBikeLoaded(updatedComponents);
  });

  return bikeComponents;
}

function loadBikeModel(ammo, scene, bikeComponents, wheelPositions, onModelLoaded) {
  const loader = new GLTFLoader();
  const myPlayerId = localStorage.getItem('myPlayerId');

  let bikeColor = 'red';
  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      const gameConfig = JSON.parse(savedConfig);
      if (gameConfig && gameConfig.players) {
        const playerInfo = gameConfig.players.find(p => p.id === myPlayerId) || gameConfig.players[0];
        if (playerInfo && playerInfo.playerColor) {
          bikeColor = playerInfo.playerColor;
        }
      }
    }
  } catch (e) { }

  bikeColor = sessionStorage.getItem('carColor') || bikeColor;

  const bikePath = `/models/car_${bikeColor}.glb`;
  console.log('Loading car model for bike reshaping:', bikePath);
  loader.load(
    bikePath,
    (gltf) => {
      const carModel = gltf.scene;

      // Cars natively scale by 4
      carModel.scale.set(4, 4, 4);
      carModel.position.set(0, 0, 0);

      carModel.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });

      // Squish the chassis to look like a bike frame
      // Since car is scale 4, we scale X by 0.45 of that -> 1.8
      carModel.scale.x = 4 * 0.45;

      // Grab all 4 wheels
      let wheelMeshFL = carModel.getObjectByName('wheel-fr');
      let wheelMeshFR = carModel.getObjectByName('wheel-fl');
      let wheelMeshBL = carModel.getObjectByName('wheel-br');
      let wheelMeshBR = carModel.getObjectByName('wheel-bl');

      // We destroy the right wheels (since we only keep 2 for bikes)
      if (wheelMeshFR) {
        if (wheelMeshFR.geometry) wheelMeshFR.geometry.dispose();
        if (wheelMeshFR.parent) wheelMeshFR.parent.remove(wheelMeshFR);
      }
      if (wheelMeshBR) {
        if (wheelMeshBR.geometry) wheelMeshBR.geometry.dispose();
        if (wheelMeshBR.parent) wheelMeshBR.parent.remove(wheelMeshBR);
      }

      const activeWheels = [wheelMeshFL, wheelMeshBL]; // Front & Back

      for (let i = 0; i < activeWheels.length; i++) {
        const wheelObj = activeWheels[i];
        if (wheelObj) {
          try { wheelObj.updateMatrixWorld(true); } catch (e) { }
          try { carModel.remove(wheelObj); } catch (e) { }
          scene.add(wheelObj);

          // Original wheels have scale 4 inside car, but since X was squished we need to restore natural wheel thickness
          // Or we just set scale manually to 4,4,4 so the wheel looks normal (not squished)
          wheelObj.scale.set(4, 4, 4);

          bikeComponents.wheelMeshes[i] = wheelObj;
          console.log(`Attached reshaped bike wheel mesh`);
        } else {
          // procedural fallback for wheeled meshes just in case
          const wheelGeometry = new THREE.CylinderGeometry(
            WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24
          );
          wheelGeometry.rotateZ(Math.PI / 2);
          const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
          const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
          wheelMesh.castShadow = true;
          wheelMesh.receiveShadow = true;
          scene.add(wheelMesh);
          wheelMesh.scale.set(4, 4, 4);
          bikeComponents.wheelMeshes[i] = wheelMesh;
        }
      }

      scene.add(carModel);
      bikeComponents.carModel = carModel;
      
      addBlobShadow(carModel, 4, 10);

      console.log('Bike model reshaped successfully');
      if (onModelLoaded) onModelLoaded(bikeComponents);
    },
    undefined,
    (error) => {
      console.error(`Error loading model ${bikePath}:`, error);
    }
  );
}

export function updateSteering(deltaTime, vehicle, keyState, currentSteeringAngle, currentSpeed = 0, ammo, carBody) {
  // Calculate dynamic max steering angle based on speed, just like the car
  const MIN_SPEED = 0;   
  const MAX_SPEED = 150; 
  const clampedSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, currentSpeed));
  const speedFactorLocal = (clampedSpeed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  const maxSteeringAngle = MAX_STEERING_ANGLE - speedFactorLocal * (MAX_STEERING_ANGLE - MIN_STEERING_ANGLE);

  let targetSteeringAngle = 0;

  if (keyState.a) {
    targetSteeringAngle = maxSteeringAngle;
  } else if (keyState.d) {
    targetSteeringAngle = -maxSteeringAngle;
  }

  // Determine appropriate steering speed mirroring the car's responsive direction switching
  const steeringSpeed = (targetSteeringAngle === 0 || 
                         (currentSteeringAngle > 0 && targetSteeringAngle < 0) || 
                         (currentSteeringAngle < 0 && targetSteeringAngle > 0)) ? 
    STEERING_RETURN_SPEED : 
    STEERING_SPEED;

  const steeringDelta = targetSteeringAngle - currentSteeringAngle;
  const maxSteeringDelta = steeringSpeed * deltaTime;

  let newSteeringAngle = currentSteeringAngle;
  if (Math.abs(steeringDelta) > maxSteeringDelta) {
    newSteeringAngle += Math.sign(steeringDelta) * maxSteeringDelta;
  } else {
    newSteeringAngle = targetSteeringAngle;
  }

  // Apply steering only to front wheel (index 0)
  vehicle.setSteeringValue(newSteeringAngle, 0);

  // === BIKE STABILIZATION & LEANING ===
  if (carBody && ammo) {
    const transform = carBody.getWorldTransform();
    const rotation = transform.getRotation();
    const threeQuat = new THREE.Quaternion(rotation.x(), rotation.y(), rotation.z(), rotation.w());
    const euler = new THREE.Euler().setFromQuaternion(threeQuat, 'YXZ');

    // YXZ order: Z is roll, X is pitch
    const currentRoll = euler.z;
    const currentPitch = euler.x;

    // Calculate max lean based on speed
    const speedFactor = Math.min(Math.max(currentSpeed, 0) / 80, 1.0);
    const targetLean = -newSteeringAngle * 1.5 * speedFactor;

    const rollDiff = targetLean - currentRoll;
    const angularVel = carBody.getAngularVelocity();

    const upVector = new THREE.Vector3(0, 1, 0).applyQuaternion(threeQuat);
    const forwardVector = new THREE.Vector3(0, 0, 1).applyQuaternion(threeQuat);
    const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(threeQuat);

    // Convert world angular velocity to local angular velocity for accurate damping
    const localAngularVel = new THREE.Vector3(angularVel.x(), angularVel.y(), angularVel.z());
    localAngularVel.applyQuaternion(threeQuat.clone().invert());

    // Roll correction to keep upright: softened the multiplier to allow a smooth visual lean when turning
    const rollTorqueAmount = (rollDiff * 2500) - (localAngularVel.z * 400);

    // Remove pitch correction so the bike can pitch naturally to climb steep slopes
    const pitchTorqueAmount = 0; 

    // Always apply stabilization (including when trying to recover from tips)
    const rollTorque = forwardVector.clone().multiplyScalar(rollTorqueAmount);
    const pitchTorque = rightVector.clone().multiplyScalar(pitchTorqueAmount);
    const totalTorque = rollTorque.add(pitchTorque);

    const ammoTorque = new ammo.btVector3(totalTorque.x, totalTorque.y, totalTorque.z);
    carBody.applyTorque(ammoTorque);
    ammo.destroy(ammoTorque);
  }

  return newSteeringAngle;
}

export function resetBikePosition(ammo, carBody, vehicle, currentSteeringAngle, currentGatePosition, currentGateQuaternion) {
  const zero = new ammo.btVector3(0, 0, 0);
  carBody.setLinearVelocity(zero);
  carBody.setAngularVelocity(zero);

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

  carBody.setWorldTransform(resetTransform);
  carBody.getMotionState().setWorldTransform(resetTransform);

  vehicle.setSteeringValue(0, 0);
  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    vehicle.updateWheelTransform(i, true);
  }

  ammo.destroy(zero);
  ammo.destroy(rotQuat);
  ammo.destroy(resetTransform);

  return 0;
}

export function updateBikePosition(ammo, vehicle, carModel, wheelMeshes) {
  if (!vehicle || !carModel) return;

  const chassisWorldTrans = vehicle.getChassisWorldTransform();
  const position = chassisWorldTrans.getOrigin();
  const quaternion = chassisWorldTrans.getRotation();

  carModel.position.set(position.x(), position.y(), position.z());
  carModel.quaternion.set(quaternion.x(), quaternion.y(), quaternion.z(), quaternion.w());

  for (let i = 0; i < vehicle.getNumWheels(); i++) {
    vehicle.updateWheelTransform(i, true);
    if (wheelMeshes[i]) {
      const transform = vehicle.getWheelInfo(i).get_m_worldTransform();
      const wheelPosition = transform.getOrigin();
      const wheelQuaternion = transform.getRotation();
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

// Helper to add fake ambient occlusion blob shadow
function addBlobShadow(model, width, length) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  
  const shadowTexture = new THREE.CanvasTexture(canvas);
  const shadowMaterial = new THREE.MeshBasicMaterial({ 
    map: shadowTexture, 
    transparent: true, 
    depthWrite: false,
    opacity: 0.8
  });
  
  const shadowGeo = new THREE.PlaneGeometry(width, length);
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMaterial);
  shadowMesh.rotation.x = -Math.PI / 2;
  // Position it slightly below the center of the chassis, right above ground
  // Assuming model origin is center of chassis.
  shadowMesh.position.y = -0.4; 
  shadowMesh.receiveShadow = false;
  shadowMesh.castShadow = false;
  
  model.add(shadowMesh);
}
