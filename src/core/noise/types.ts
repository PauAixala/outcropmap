/** Shared noise-sampler shapes. No Minecraft knowledge — see AGENTS.md section 3. */

export interface Noise2D {
  sample(x: number, y: number): number;
}

export interface Noise3D {
  sample(x: number, y: number, z: number): number;
}
