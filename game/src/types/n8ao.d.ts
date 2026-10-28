// n8ao 没有自带类型声明，这里只声明项目用到的部分。
declare module 'n8ao' {
  import type { Camera, Color, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
  import type { Pass } from 'postprocessing';

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    gammaCorrection: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    screenSpaceRadius: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  export type N8AOQualityMode =
    | 'Performance'
    | 'Low'
    | 'Medium'
    | 'High'
    | 'Ultra'
    | 'Neural-Low'
    | 'Neural-Medium'
    | 'Neural-High';

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    scene: Scene;
    camera: Camera;
    setQualityMode(mode: N8AOQualityMode): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
    override setSize(width: number, height: number): void;
    override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget): void;
  }
}
