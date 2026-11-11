import * as THREE from "three";
import { createBloodSimulation } from "./blood-physics.js";
import { matteMaterial } from "./surface-finish.js";

function splatterTexture() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const angle = Math.atan2(v, u), radius = Math.hypot(u, v);
    const edge = .61 + Math.sin(angle * 7) * .075 + Math.cos(angle * 11) * .045;
    const alpha = Math.max(0, Math.min(1, (edge - radius) * 30));
    const index = (y * size + x) * 4;
    pixels.set([255, 255, 255, Math.round(alpha * 255)], index);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createBloodEffects(scene, options = {}) {
  const simulation = createBloodSimulation(options), group = new THREE.Group();
  group.name = "blood-effects";
  const count = simulation.droplets.length;
  const positions = new Float32Array(count * 3), sizes = new Float32Array(count), alpha = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("bloodSize", new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("bloodAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const particles = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms: { viewportHeight: { value: 720 }, bloodColor: { value: new THREE.Color(0x8b1512) } },
    vertexShader: `
      uniform float viewportHeight;
      attribute float bloodSize;
      attribute float bloodAlpha;
      varying float opacity;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(bloodSize * viewportHeight * projectionMatrix[1][1] /
          max(.05, -viewPosition.z), 1.0, 6.0);
        opacity = bloodAlpha * (1.0 - smoothstep(15.0, 50.0, -viewPosition.z));
      }`,
    fragmentShader: `
      uniform vec3 bloodColor;
      varying float opacity;
      void main() {
        float radius = length(gl_PointCoord - .5);
        float coverage = 1.0 - smoothstep(.22, .5, radius);
        if (coverage * opacity < .01) discard;
        gl_FragColor = vec4(bloodColor * (1.0 - radius * .4), coverage * opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false
  }));
  particles.frustumCulled = false;
  const drawingSize = new THREE.Vector2();
  particles.onBeforeRender = (renderer) => {
    particles.material.uniforms.viewportHeight.value =
      renderer.getRenderTarget()?.height || renderer.getDrawingBufferSize(drawingSize).y;
  };
  const stainGeometry = new THREE.PlaneGeometry(1, 1), texture = splatterTexture();
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(simulation.stains.length), 1).setUsage(THREE.DynamicDrawUsage);
  const wetness = new THREE.InstancedBufferAttribute(new Float32Array(simulation.stains.length), 1).setUsage(THREE.DynamicDrawUsage);
  stainGeometry.setAttribute("stainOpacity", opacity);
  stainGeometry.setAttribute("stainWetness", wetness);
  const stainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: texture, roughness: .35, metalness: 0,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  });
  stainMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float stainOpacity; attribute float stainWetness;
      varying float bloodOpacity; varying float bloodWetness;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\nbloodOpacity = stainOpacity; bloodWetness = stainWetness;");
    shader.fragmentShader = "varying float bloodOpacity; varying float bloodWetness;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <alphatest_fragment>",
      "diffuseColor.a *= bloodOpacity;\n#include <alphatest_fragment>");
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\nroughnessFactor = mix(.85, .3, bloodWetness);");
  };
  matteMaterial(stainMaterial);
  const stains = new THREE.InstancedMesh(stainGeometry, stainMaterial, simulation.stains.length);
  stains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stains.frustumCulled = false;
  stains.renderOrder = 2;
  const transform = new THREE.Object3D(), normal = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, 1);
  const fresh = new THREE.Color(0x751510), dry = new THREE.Color(0x361310), color = new THREE.Color();
  group.add(particles, stains); scene.add(group);
  function sync() {
    let live = false, stained = false;
    simulation.droplets.forEach((particle, index) => {
      positions[index * 3] = particle.position.x;
      positions[index * 3 + 1] = particle.position.y;
      positions[index * 3 + 2] = particle.position.z;
      sizes[index] = particle.radius * 2;
      alpha[index] = particle.active ? Math.min(1, particle.life * 3) : 0;
      live ||= particle.active;
    });
    particles.visible = live;
    Object.values(geometry.attributes).forEach((attribute) => { attribute.needsUpdate = true; });
    simulation.stains.forEach((stain, index) => {
      normal.set(stain.normal.x, stain.normal.y, stain.normal.z);
      transform.position.set(stain.position.x, stain.position.y, stain.position.z).addScaledVector(normal, .002);
      transform.quaternion.setFromUnitVectors(forward, normal.lengthSq() > 0 ? normal : forward);
      const size = stain.active ? stain.radius * 2.5 : 0;
      transform.scale.set(size, size * (1 + (1 - Math.abs(normal.y)) * Math.min(.8, stain.age * .12)), 1);
      if (stain.active && stain.obstacle) {
        const box = stain.obstacle, cos = Math.cos(box.rotation), sin = Math.sin(box.rotation);
        const x = (stain.position.x - box.x) * cos - (stain.position.z - box.z) * sin;
        const z = (stain.position.x - box.x) * sin + (stain.position.z - box.z) * cos;
        const localNormalX = normal.x * cos - normal.z * sin;
        if (Math.abs(normal.y) < .5) {
          const width = Math.abs(localNormalX) > .5 ? box.depth / 2 - Math.abs(z) : box.width / 2 - Math.abs(x);
          transform.scale.x = Math.min(size, Math.max(0, width * 2 - .002));
          transform.scale.y = Math.min(transform.scale.y, Math.max(0, Math.min(stain.position.y, box.height - stain.position.y) * 2 - .002));
        } else {
          const width = Math.min(box.width / 2 - Math.abs(x), box.depth / 2 - Math.abs(z));
          transform.scale.x = transform.scale.y = Math.min(size, Math.max(0, width * 2 - .002));
        }
      } else if (stain.active && Math.abs(normal.y) < .5) {
        transform.scale.y = Math.min(transform.scale.y, Math.max(0, Math.min(stain.position.y, 5 - stain.position.y) * 2 - .002));
      }
      transform.updateMatrix(); stains.setMatrixAt(index, transform.matrix);
      stains.setColorAt(index, color.copy(fresh).lerp(dry, Math.min(1, stain.age / 20)));
      opacity.setX(index, stain.active ? stain.opacity * .9 : 0);
      wetness.setX(index, Math.max(0, 1 - stain.age / 18));
      stained ||= stain.active;
    });
    stains.visible = stained;
    stains.instanceMatrix.needsUpdate = true;
    stains.instanceColor.needsUpdate = true;
    opacity.needsUpdate = wetness.needsUpdate = true;
  }
  sync();
  return {
    group, simulation,
    emit(position, direction, hit) { simulation.emit(position, direction, hit); sync(); },
    update(delta) {
      if (!particles.visible && !stains.visible) return;
      simulation.update(delta); sync();
    },
    clear() { simulation.clear(); sync(); },
    dispose() {
      scene.remove(group);
      geometry.dispose(); particles.material.dispose();
      stainGeometry.dispose(); stainMaterial.dispose(); texture.dispose();
    }
  };
}
