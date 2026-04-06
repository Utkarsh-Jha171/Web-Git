import * as THREE from 'three';

export function createTNTSection(scene, options = {}) {
  // Configurable positions
  const positions = options.positions || [
    new THREE.Vector3(0, 1, 60),
    new THREE.Vector3(-3, 1, 65),
    new THREE.Vector3(3, 1, 70),
    new THREE.Vector3(0, 1, 75)
  ];

  const tnts = [];
  
  // Create TNTs
  positions.forEach((pos, index) => {
    const tntRoot = new THREE.Group();
    tntRoot.position.copy(pos);
    
    // Create visual mesh group inside root so we can float/bob it independently
    const tntVisual = new THREE.Group();
    
    // Body (Red Box)
    const bodyGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    // Simple texture map for bold TNT label
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#cc0000';
    ctx.fillRect(0, 0, 128, 128);
    // Draw deep shadow to make it pop
    ctx.fillStyle = '#220000';
    ctx.font = 'bold 45px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TNT', 67, 67);
    // Draw pure white text
    ctx.fillStyle = '#ffffff';
    ctx.fillText('TNT', 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    
    const bodyMat = new THREE.MeshStandardMaterial({ 
      color: 0xff0000, 
      map: texture,
      roughness: 0.7 
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    tntVisual.add(bodyMesh);
    
    // Cap (Black Top edge)
    const capGeo = new THREE.BoxGeometry(1.55, 0.2, 1.55);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const capMesh = new THREE.Mesh(capGeo, capMat);
    capMesh.position.y = 0.85;
    capMesh.castShadow = true;
    tntVisual.add(capMesh);
    
    // Fuse
    const fuseGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4);
    const fuseMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const fuseMesh = new THREE.Mesh(fuseGeo, fuseMat);
    fuseMesh.position.y = 1.1;
    tntVisual.add(fuseMesh);
    
    // Warning Spark / Emissive top of fuse
    const sparkGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const sparkMesh = new THREE.Mesh(sparkGeo, sparkMat);
    sparkMesh.position.y = 1.35;
    tntVisual.add(sparkMesh);
    
    tntRoot.add(tntVisual);
    scene.add(tntRoot);
    
    tnts.push({
      root: tntRoot,
      visual: tntVisual,
      spark: sparkMesh,
      bodyMat: bodyMat,
      state: 'idle', // idle -> warning -> exploding -> done
      timeInState: 0,
      initialY: pos.y,
      triggerRadius: 1.6,  // Requires direct tight contact to arm
      explosionRadius: 18.0 // Proximity for damage/force impact
    });
  });

  return {
    tnts,
    scene
  };
}

// Particle system helper to keep TNT tidy
function createExplosionParticles(scene, position) {
  // Fireball
  const fbGeo = new THREE.SphereGeometry(1, 16, 16);
  const fbMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 1 });
  const fireball = new THREE.Mesh(fbGeo, fbMat);
  fireball.position.copy(position);
  scene.add(fireball);
  
  // Bright Flash Core
  const flashGeo = new THREE.SphereGeometry(1.5, 16, 16);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.copy(position);
  scene.add(flash);
  
  // Shockwave Ring
  const swGeo = new THREE.RingGeometry(0.1, 1, 32);
  const swMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const shockwave = new THREE.Mesh(swGeo, swMat);
  shockwave.rotation.x = -Math.PI / 2;
  shockwave.position.copy(position);
  shockwave.position.y += 0.2; // slightly above ground
  scene.add(shockwave);
  
  // Sparks (flying debris)
  const sparks = [];
  const sparkGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
  for(let i=0; i<15; i++) {
    const spark = new THREE.Mesh(sparkGeo, sparkMat);
    spark.position.copy(position);
    spark.userData.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 30,
      10 + Math.random() * 20,
      (Math.random() - 0.5) * 30
    );
    scene.add(spark);
    sparks.push(spark);
  }
  
  return {
    fireball,
    flash,
    shockwave,
    sparks,
    time: 0,
    duration: 0.8
  };
}

let activeExplosions = [];

export function updateTNTSection(deltaTime, playerObject, camera, ammo, vehicleBody, tntSystem) {
  if (!tntSystem) return;
  
  const playerPos = playerObject ? playerObject.position : null;
  const now = Date.now();
  
  tntSystem.tnts.forEach(tnt => {
    tnt.timeInState += deltaTime;
    
    if (tnt.state === 'idle') {
      // Gentle idle animation: bob up and down lazily
      tnt.visual.position.y = Math.sin(now * 0.003 + tnt.root.position.x) * 0.15;
      tnt.visual.rotation.y = Math.sin(now * 0.001) * 0.1;
      
      // Spark blink: flashes to grab attention
      tnt.spark.material.color.setHex((Math.sin(now * 0.01) > 0) ? 0xffaa00 : 0x222222);
      
      // Collision / Trigger distance check
      if (playerPos) {
        // We use pure distance here. An AABB trigger is heavier, distance is quick
        const dist = playerPos.distanceTo(tnt.root.position);
        if (dist < tnt.triggerRadius) {
          tnt.state = 'warning';
          tnt.timeInState = 0;
        }
      }
    } 
    else if (tnt.state === 'warning') {
      // Faster, panicked blink & flash the main body red/black
      tnt.spark.material.color.setHex((Math.sin(now * 0.05) > 0) ? 0xffffff : 0xff0000);
      tnt.bodyMat.emissive.setHex((Math.sin(now * 0.05) > 0) ? 0x550000 : 0x000000);
      
      // Detonate after very short margin
      if (tnt.timeInState > 0.2) {
        tnt.state = 'exploding';
        tnt.timeInState = 0;
        
        // Hide TNT visuals
        tnt.visual.visible = false;
        
        // Spawn Explosion Visual Effects
        activeExplosions.push(createExplosionParticles(tntSystem.scene, tnt.root.position));
        
        // 6. Gameplay Effect Implementation (Knockback + slowdown)
        if (vehicleBody && playerPos) {
          const dist = playerPos.distanceTo(tnt.root.position);
          if (dist < tnt.explosionRadius) {
            // Direction away from the explosion
            const dir = new THREE.Vector3().subVectors(playerPos, tnt.root.position).normalize();
            // Upward tilt for bounce
            dir.y = 0.5;
            dir.normalize();
            
            // Explosion force gets stronger the closer you are
            const forceStrength = 18000 * (1.0 - (dist / tnt.explosionRadius));
            const force = new ammo.btVector3(dir.x * forceStrength, dir.y * forceStrength, dir.z * forceStrength);
            vehicleBody.applyCentralImpulse(force);
            ammo.destroy(force); // cleanup ammo.js
            
            // Immediate brutal slowdown: multiply velocity heavily to stop momentum
            const vel = vehicleBody.getLinearVelocity();
            vel.setX(vel.x() * 0.1);
            vel.setY(vel.y()); // Keep y momentum to bounce up
            vel.setZ(vel.z() * 0.1);
            vehicleBody.setLinearVelocity(vel);
            
            // Simple camera screen shake via displacement (if cam exists)
            if (camera) {
              camera.position.add(new THREE.Vector3(
                (Math.random()-0.5)*3, 
                (Math.random()-0.5)*3, 
                (Math.random()-0.5)*3
              ));
            }
          }
        }
      }
    }
  });

  // Handle explosion effect frames
  for (let i = activeExplosions.length - 1; i >= 0; i--) {
    let exp = activeExplosions[i];
    exp.time += deltaTime;
    
    // Scale rapidly expanding fireball
    let fbScale = 1 + exp.time * 20;
    exp.fireball.scale.set(fbScale, fbScale, fbScale);
    // Fade out dynamically
    exp.fireball.material.opacity = Math.max(0, 1.0 - (exp.time / exp.duration));
    
    // Flash scale and fade extremely fast
    let flScale = 1 + exp.time * 15;
    exp.flash.scale.set(flScale, flScale, flScale);
    exp.flash.material.opacity = Math.max(0, 1.0 - (exp.time / 0.2));
    
    // Scale ground shockwave ring
    let swScale = 1 + exp.time * 30;
    exp.shockwave.scale.set(swScale, swScale, swScale);
    exp.shockwave.material.opacity = Math.max(0, 1.0 - (exp.time / exp.duration));
    
    // Animate sparks expanding outwards
    exp.sparks.forEach(spark => {
      spark.position.addScaledVector(spark.userData.velocity, deltaTime);
      spark.userData.velocity.y -= 40 * deltaTime; // gravity
      spark.rotation.x += 15 * deltaTime;
      spark.rotation.y += 15 * deltaTime;
      const sScale = Math.max(0.01, 1.0 - (exp.time / exp.duration));
      spark.scale.set(sScale, sScale, sScale);
    });
    
    // Cleanup if finished
    if (exp.time > exp.duration) {
      tntSystem.scene.remove(exp.fireball);
      tntSystem.scene.remove(exp.flash);
      tntSystem.scene.remove(exp.shockwave);
      
      exp.fireball.geometry.dispose();
      exp.fireball.material.dispose();
      exp.flash.geometry.dispose();
      exp.flash.material.dispose();
      exp.shockwave.geometry.dispose();
      exp.shockwave.material.dispose();
      
      // Cleanup sparks
      exp.sparks.forEach(spark => {
        tntSystem.scene.remove(spark);
      });
      // Sparks share geometry and material
      const sGeo = exp.sparks[0]?.geometry;
      const sMat = exp.sparks[0]?.material;
      if (sGeo) sGeo.dispose();
      if (sMat) sMat.dispose();
      
      activeExplosions.splice(i, 1);
    }
  }
}
