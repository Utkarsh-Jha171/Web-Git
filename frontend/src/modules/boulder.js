import * as THREE from 'three';

/**
 * Procedurally generates static boulder hazards along the track.
 * Integrates directly with Ammo.js to create immovable physical blockages
 * that naturally halt vehicle velocity via real collision physics.
 */
export function createBoulderSection(scene, positions = [], ammo, physicsWorld) {
  const boulders = [];
  
  if (!ammo || !physicsWorld) {
    console.warn("boulder.js: Ammo or physicsWorld missing, skipping physics generation.");
  }
  
  // Size of the boulder. 1.6 matches roughly a large, impassable rock given track scale
  const boulderRadius = 1.6; 
  
  // Shared properties to save memory across heavy instantiation
  const boulderGeo = new THREE.DodecahedronGeometry(boulderRadius, 0);
  const boulderMat = new THREE.MeshPhongMaterial({ 
    color: 0x777777, 
    flatShading: true,
    shininess: 10
  });

  positions.forEach((pos, index) => {
    // 1. Setup Visual Mesh
    const boulderMesh = new THREE.Mesh(boulderGeo, boulderMat);
    
    // Scramble the rotation so identical meshes look organically distinct
    boulderMesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    boulderMesh.position.copy(pos);
    
    // Because they're Dodecahedrons rotating around center, shift elevation slightly so they seat on the ground
    // Y represents up. Half radius prevents floating
    boulderMesh.position.y += Math.max(0, (boulderRadius * 0.4)); 
    
    boulderMesh.castShadow = true;
    boulderMesh.receiveShadow = true;
    scene.add(boulderMesh);
    
    // 2. Setup Heavy Static Physics Collision (Ammo.js)
    if (ammo && physicsWorld) {
      const transform = new ammo.btTransform();
      transform.setIdentity();
      // Lock physics origin securely onto the visually shifted boulder
      transform.setOrigin(new ammo.btVector3(boulderMesh.position.x, boulderMesh.position.y, boulderMesh.position.z));
      
      // Use Box collision to cleanly repel boxy raycast chassis. Sphere collisions can sometimes trap wheels.
      const shape = new ammo.btBoxShape(new ammo.btVector3(boulderRadius * 0.85, boulderRadius * 0.85, boulderRadius * 0.85));
      shape.setMargin(0.05);
      
      // Mass 0 means infinite mass (IMMOVABLE STATIC OBJECT)
      const mass = 0; 
      const localInertia = new ammo.btVector3(0, 0, 0);
      
      const motionState = new ammo.btDefaultMotionState(transform);
      const rbInfo = new ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
      
      const rigidBody = new ammo.btRigidBody(rbInfo);
      
      // Dampen bounciness heavily so the collision behaves as "Dead Stoppage"
      rigidBody.setRestitution(0.1); 
      rigidBody.setFriction(0.8);    
      
      physicsWorld.addRigidBody(rigidBody);
      
      boulders.push({
        mesh: boulderMesh,
        rigidBody: rigidBody
      });
    } else {
      boulders.push({ mesh: boulderMesh });
    }
  });
  
  return boulders;
}
