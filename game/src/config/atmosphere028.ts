/**
 * v0.1-028 大气参数（美术交付 art/source/atmosphere/atmosphere-028.json 的原样副本，去掉 _doc / check 字段）。
 * 美术改 JSON 后重新生成：node scripts/gen-atmo028.mjs（verify-render 会逐项比对 art 原件，不一致就失败）。
 * 单位：米 / 秒；颜色 sRGB hex；贴图 key = art/textures/<key>.ktx2。说明见 art/source/atmosphere/README-028.md。
 */
export const ATMO028 = {
  "version": "028-v1 (2026-10-30)",
  "textures": {
    "skyClouds": "tex-sky-clouds-overcast-albedo",
    "fogCards": {
      "wall": "tex-fog-card-a-albedo",
      "puff": "tex-fog-card-b-albedo",
      "ground": "tex-fog-card-c-albedo"
    },
    "rainStreak": "tex-rain-streak-albedo",
    "rainSplash": "tex-rain-splash-albedo",
    "rainRipple": "tex-rain-ripple-normal",
    "lensDroplets": "tex-lens-droplets-normal",
    "waterNormal": "tex-water-normal",
    "waterFoam": "tex-water-foam-albedo",
    "beamNoise": "tex-beam-noise-albedo",
    "beamSpot": "tex-beam-spot-albedo",
    "glowLighthouse": "tex-glow-lighthouse-albedo",
    "ramps": {
      "char": "tex-ramp-char",
      "env": "tex-ramp-env",
      "metalWet": "tex-ramp-metal-wet"
    }
  },
  "presets": {
    "overcast-dusk": {
      "lut": "lut-overcast-dusk.png",
      "sky": {
        "top": "#4A535B",
        "mid": "#99A2AA",
        "horizon": "#C9D0D4",
        "midElev": 0.18,
        "topElev": 0.7,
        "duskBand": {
          "color": "#C9A88A",
          "dir": [
            0.83,
            0,
            -0.56
          ],
          "power": 6,
          "maxElev": 0.1,
          "strength": 0.45
        },
        "clouds": {
          "scale": 0.55,
          "scroll": [
            0.0016,
            0.0005
          ],
          "opacity": 0.96,
          "tint": "#9EA6AD",
          "fadeElev": [
            0.015,
            0.16
          ],
          "horizonLift": 0.12
        }
      },
      "fog": {
        "color": "#B9C2C8",
        "density": 0.009,
        "farWallTint": "#C9D0D4"
      },
      "rain": {
        "enabled": true,
        "color": "#A3B0BA",
        "brightness": 1,
        "speed": 22,
        "windTilt": 0.25
      },
      "water": {
        "color": "#2E3A42",
        "fresnel": [
          0.32,
          0.92
        ],
        "normalScale": 0.35,
        "reflectDistort": 0.035
      }
    },
    "overcast-after-rain": {
      "lut": "lut-overcast-after-rain.png",
      "sky": {
        "top": "#56606A",
        "mid": "#A3ACB3",
        "horizon": "#D2D8DB",
        "midElev": 0.18,
        "topElev": 0.7,
        "duskBand": {
          "color": "#C9A88A",
          "dir": [
            0.83,
            0,
            -0.56
          ],
          "power": 6,
          "maxElev": 0.1,
          "strength": 0.3
        },
        "clouds": {
          "scale": 0.55,
          "scroll": [
            0.0024,
            0.0008
          ],
          "opacity": 0.78,
          "tint": "#B3BAC0",
          "fadeElev": [
            0.015,
            0.16
          ],
          "horizonLift": 0.15
        }
      },
      "fog": {
        "color": "#C3CBD0",
        "density": 0.007,
        "farWallTint": "#D2D8DB"
      },
      "rain": {
        "enabled": false,
        "color": "#A3B0BA",
        "brightness": 1,
        "speed": 22,
        "windTilt": 0.25
      },
      "water": {
        "color": "#34414A",
        "fresnel": [
          0.3,
          0.92
        ],
        "normalScale": 0.25,
        "reflectDistort": 0.025
      }
    },
    "rain-night": {
      "lut": "lut-rain-night.png",
      "sky": {
        "top": "#12181E",
        "mid": "#2A333B",
        "horizon": "#46515A",
        "midElev": 0.15,
        "topElev": 0.6,
        "duskBand": null,
        "clouds": {
          "scale": 0.55,
          "scroll": [
            0.003,
            0.001
          ],
          "opacity": 0.95,
          "tint": "#5A646C",
          "fadeElev": [
            0.015,
            0.16
          ],
          "horizonLift": 0.05
        }
      },
      "fog": {
        "color": "#3A444C",
        "density": 0.016,
        "farWallTint": "#46515A"
      },
      "rain": {
        "enabled": true,
        "color": "#6F7E8B",
        "brightness": 1,
        "speed": 24,
        "windTilt": 0.32
      },
      "water": {
        "color": "#161D24",
        "fresnel": [
          0.3,
          0.9
        ],
        "normalScale": 0.45,
        "reflectDistort": 0.045
      },
      "previewLightMul": 0.35
    },
    "after-lit": {
      "lut": "lut-after-lit.png",
      "sky": {
        "top": "#3E4750",
        "mid": "#8E98A1",
        "horizon": "#C4C8C8",
        "midElev": 0.18,
        "topElev": 0.7,
        "duskBand": {
          "color": "#C9A88A",
          "dir": [
            0.83,
            0,
            -0.56
          ],
          "power": 5,
          "maxElev": 0.12,
          "strength": 0.55
        },
        "clouds": {
          "scale": 0.55,
          "scroll": [
            0.002,
            0.0007
          ],
          "opacity": 0.82,
          "tint": "#A2A9AF",
          "fadeElev": [
            0.015,
            0.16
          ],
          "horizonLift": 0.12
        }
      },
      "fog": {
        "color": "#AEB7BE",
        "density": 0.008,
        "farWallTint": "#C4C8C8"
      },
      "rain": {
        "enabled": false,
        "color": "#A8B2BA",
        "brightness": 1,
        "speed": 22,
        "windTilt": 0.25
      },
      "water": {
        "color": "#26323A",
        "fresnel": [
          0.32,
          0.92
        ],
        "normalScale": 0.3,
        "reflectDistort": 0.03
      }
    }
  },
  "rainTiers": {
    "ultra": {
      "count": 30000,
      "mode": "quad",
      "widthM": 0.009,
      "minPx": 1,
      "maxPx": 2.5,
      "lenMin": 0.4,
      "lenMax": 0.85,
      "opacity": 0.24,
      "fadeNear": [
        1,
        2.6
      ],
      "fadeFar": [
        3,
        16
      ],
      "depthBoost": [
        [
          0,
          1
        ],
        [
          3,
          1.25
        ],
        [
          7,
          1.25
        ],
        [
          12,
          0.8
        ],
        [
          30,
          0.6
        ]
      ],
      "area": [
        46,
        26
      ],
      "atlasCols": 4,
      "splash": {
        "enabled": true,
        "perSecond": 900,
        "radius": 12,
        "size": [
          0.12,
          0.22
        ],
        "fps": 40,
        "opacity": 0.35
      },
      "ripples": {
        "enabled": true,
        "tileM": 1.5,
        "fps": 24,
        "strength": 0.35,
        "layers": 2
      },
      "lensDroplets": {
        "enabled": true,
        "cutsceneOnly": true,
        "tilesPerScreenH": 1,
        "refraction": 0.015,
        "fadeIn": 0.6
      }
    },
    "high": {
      "count": 15000,
      "mode": "quad",
      "widthM": 0.01,
      "minPx": 1,
      "maxPx": 2.5,
      "lenMin": 0.4,
      "lenMax": 0.85,
      "opacity": 0.28,
      "fadeNear": [
        1,
        2.6
      ],
      "fadeFar": [
        3,
        18
      ],
      "depthBoost": [
        [
          0,
          1
        ],
        [
          3,
          1.2
        ],
        [
          7,
          1.2
        ],
        [
          12,
          0.85
        ],
        [
          30,
          0.7
        ]
      ],
      "area": [
        46,
        26
      ],
      "atlasCols": 4,
      "splash": {
        "enabled": true,
        "perSecond": 450,
        "radius": 10,
        "size": [
          0.12,
          0.22
        ],
        "fps": 40,
        "opacity": 0.35
      },
      "ripples": {
        "enabled": true,
        "tileM": 1.5,
        "fps": 24,
        "strength": 0.35,
        "layers": 1
      },
      "lensDroplets": {
        "enabled": false
      }
    },
    "standard": {
      "count": 6000,
      "mode": "line",
      "lenMin": 0.35,
      "lenMax": 0.75,
      "opacity": 0.2,
      "fadeNear": [
        0.8,
        2.2
      ],
      "fadeFar": [
        3,
        21
      ],
      "depthBoost": null,
      "area": [
        46,
        26
      ],
      "splash": {
        "enabled": true,
        "perSecond": 150,
        "radius": 8,
        "size": [
          0.12,
          0.2
        ],
        "fps": 40,
        "opacity": 0.3
      },
      "ripples": {
        "enabled": true,
        "tileM": 1.8,
        "fps": 24,
        "strength": 0.3,
        "layers": 1
      },
      "lensDroplets": {
        "enabled": false
      }
    }
  },
  "fogTiers": {
    "ultra": {
      "farLayers": 5,
      "extraMax": 20
    },
    "high": {
      "farLayers": 5,
      "extraMax": 30
    },
    "standard": {
      "farLayers": 4,
      "extraMax": 40,
      "groundFogOpacityMul": 1.15
    }
  },
  "s1": {
    "center": [
      -2,
      0,
      -2
    ],
    "farWalls": [
      {
        "card": "wall",
        "radius": 175,
        "height": 22,
        "y": -1,
        "opacity": 0.26,
        "tint": "#B9C2C8",
        "arcDeg": [
          -150,
          -20
        ],
        "segments": 9,
        "drift": 0.004,
        "tileAspect": 2.6
      },
      {
        "card": "wall",
        "radius": 225,
        "height": 20,
        "y": -1,
        "opacity": 0.34,
        "tint": "#C1C9CE",
        "arcDeg": [
          -160,
          -10
        ],
        "segments": 10,
        "drift": 0.003,
        "tileAspect": 3
      },
      {
        "card": "wall",
        "radius": 290,
        "height": 17,
        "y": -1,
        "opacity": 0.42,
        "tint": "#C9D0D4",
        "arcDeg": [
          -170,
          0
        ],
        "segments": 12,
        "drift": 0.0025,
        "tileAspect": 3.4
      },
      {
        "card": "wall",
        "radius": 370,
        "height": 14,
        "y": -1,
        "opacity": 0.52,
        "tint": "#D2D8DB",
        "arcDeg": [
          -180,
          10
        ],
        "segments": 14,
        "drift": 0.002,
        "tileAspect": 3.8
      },
      {
        "card": "wall",
        "radius": 470,
        "height": 11,
        "y": -1,
        "opacity": 0.66,
        "tint": "#DCE1E4",
        "arcDeg": [
          -185,
          15
        ],
        "segments": 16,
        "drift": 0.0015,
        "tileAspect": 4.2
      }
    ],
    "groundFog": {
      "island": {
        "center": [
          39.73,
          0,
          -122.75
        ],
        "rings": [
          {
            "card": "ground",
            "radius": 26,
            "count": 9,
            "height": 2.4,
            "width": 30,
            "y": -0.5,
            "opacity": 0.34
          },
          {
            "card": "ground",
            "radius": 40,
            "count": 11,
            "height": 1.8,
            "width": 34,
            "y": -0.6,
            "opacity": 0.26
          }
        ],
        "puffs": [
          {
            "card": "puff",
            "pos": [
              22,
              0.6,
              -110
            ],
            "size": [
              26,
              9
            ],
            "opacity": 0.4
          },
          {
            "card": "puff",
            "pos": [
              58,
              0.6,
              -112
            ],
            "size": [
              30,
              9
            ],
            "opacity": 0.38
          }
        ]
      },
      "nearWater": {
        "card": "ground",
        "count": 8,
        "distance": [
          45,
          120
        ],
        "arcDeg": [
          -130,
          -40
        ],
        "height": [
          2.6,
          3.6
        ],
        "width": [
          30,
          55
        ],
        "opacity": [
          0.25,
          0.4
        ],
        "seed": 7
      }
    },
    "fogDensityHint": {
      "mid": {
        "nodes": [
          "env-lighthouse-island-main-s3tower",
          "env-lighthouse-ch1(插槽)"
        ],
        "overcast-dusk": 0.0036,
        "overcast-after-rain": 0.0032,
        "rain-night": 0.0042,
        "after-lit": 0.0034
      },
      "far-silhouette": {
        "nodes": [
          "env-lighthouse-silhouette-far ×2（天空层）"
        ],
        "note": "天空层不吃场景雾：用固定色 #56616B 向 fog.farWallTint 混 0.38（overcast-dusk）/ 0.5（rain-night）"
      }
    },
    "waterFoam": {
      "tex": "waterFoam",
      "tileM": 3,
      "bandWidth": [
        1.2,
        2.2
      ],
      "opacity": 0.8,
      "scroll": [
        0.03,
        0.01
      ],
      "tideMin": 1
    }
  },
  "water": {
    "normal": {
      "layers": [
        {
          "tileM": 14,
          "scroll": [
            0.012,
            0.006
          ]
        },
        {
          "tileM": 5.3,
          "scroll": [
            -0.008,
            0.011
          ]
        }
      ],
      "rippleMix": 1,
      "texSize": 2048
    },
    "ripple": {
      "tileM": 1.5,
      "fps": 24,
      "frames": 64,
      "grid": 8,
      "maxMipLevel": 3
    }
  },
  "beam": {
    "noise": {
      "scrollAlongBeam": 0.05,
      "tile": [
        6,
        1
      ],
      "strength": 0.35
    },
    "spot": {
      "opacity": 0.85,
      "flicker": 0.04
    }
  },
  "glow": {
    "lighthouse": {
      "sizeM": 9,
      "intensity": 1.6,
      "blend": "additive",
      "fadeInS": 2.5,
      "fogAttenuation": 0.4
    }
  }
} as const;

export type Atmo028PresetName = keyof typeof ATMO028.presets;
export type Atmo028Tier = keyof typeof ATMO028.rainTiers;
