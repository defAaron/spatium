import * as THREE from 'three';

export const tourDuration = 10000;
export const startPose = { at: 0, yaw: 0, pitch: 0, fov: 84 };
export type TourPose = typeof startPose;
const ease = (x: number) => x * x * (3 - 2 * x);

export function filmPose(progress: number, count: number): TourPose {
  const segment = (begin: number, end: number) =>
    ease(THREE.MathUtils.clamp((progress - begin) / (end - begin), 0, 1));
  // Let the viewer see each location before departing for the next one.
  const approach = segment(0.10, 0.33);
  const depart = segment(0.54, 0.74);
  const lookSideways = segment(0.26, 0.42) * (1 - segment(0.49, 0.62));
  return { at: (approach + depart) * (count - 1) / 2,
    yaw: -0.48 * lookSideways - Math.PI * segment(0.71, 0.97), pitch: -0.04, fov: 84 };
}

// During travel, project the outgoing and incoming panoramas from their own
// camera origins. At a stop the source is sampled exactly at its capture center.
const fragment = `
uniform sampler2D first;
uniform sampler2D second;
uniform float travel, yaw, pitch, spread, aspect;
varying vec2 screen;
vec2 spherical(vec3 ray, float offset) {
  vec3 eye = vec3(0., 0., -offset * .34);
  float d = dot(eye, ray);
  float hit = -d + sqrt(d*d + 1. - dot(eye,eye));
  vec3 n = normalize(eye + hit * ray);
  return vec2(fract(.5 + atan(n.x, -n.z) / 6.2831853), .5 + asin(clamp(n.y,-1.,1.)) / 3.14159265);
}
void main() {
  vec3 ray = normalize(vec3(screen * vec2(aspect,1.) * spread, -1.));
  ray.yz = mat2(cos(pitch), sin(pitch), -sin(pitch), cos(pitch)) * ray.yz;
  ray.xz = mat2(cos(yaw), sin(yaw), -sin(yaw), cos(yaw)) * ray.xz;
  vec3 a = texture2D(first,spherical(ray,travel)).rgb;
  vec3 b = texture2D(second,spherical(ray,travel-1.)).rgb;
  gl_FragColor = vec4(mix(a,b,smoothstep(.42,.58,travel)),1.);
  #include <colorspace_fragment>
}`;

export function panoramaRenderer(canvas: HTMLCanvasElement, textures: THREE.Texture[], recording = false) {
  const renderer = new THREE.WebGLRenderer({canvas, preserveDrawingBuffer: recording});
  const uniforms = {
    first: {value: textures[0]}, second: {value: textures[0]}, travel: {value: 0},
    yaw: {value: 0}, pitch: {value: 0}, spread: {value: 1}, aspect: {value: 1},
  };
  const material = new THREE.ShaderMaterial({uniforms, fragmentShader: fragment,
    vertexShader: 'varying vec2 screen; void main(){screen=position.xy;gl_Position=vec4(position.xy,0.,1.);}'});
  const geometry = new THREE.PlaneGeometry(2, 2);
  const world = new THREE.Scene();
  world.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.Camera();
  return {
    resize(width: number, height: number) {
      renderer.setSize(width, height, false);
      uniforms.aspect.value = width / height;
    },
    draw(pose: TourPose) {
      const index = Math.floor(pose.at);
      uniforms.first.value = textures[index];
      uniforms.second.value = textures[Math.min(index + 1, textures.length - 1)];
      uniforms.travel.value = pose.at - index;
      uniforms.yaw.value = pose.yaw;
      uniforms.pitch.value = pose.pitch;
      uniforms.spread.value = Math.tan(THREE.MathUtils.degToRad(pose.fov / 2));
      renderer.render(world, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
