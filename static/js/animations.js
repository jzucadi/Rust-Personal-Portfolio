// Wave animations using Three.js and GSAP
// Based on the Waves project

import {
  PerspectiveCamera,
  Mesh,
  WebGLRenderer,
  Scene,
  DoubleSide,
  Raycaster,
  ShaderMaterial,
  Vector2,
  PlaneGeometry,
  TextureLoader,
  RepeatWrapping,
  LinearFilter,
  Color,
} from "three";

// Inline shaders
const VERTEX_SHADER = `
    varying vec2 vUv;
    uniform float hover;
    uniform float time;
    uniform vec2 intersect;

    uniform float hoverRadius;
    uniform float amplitude;
    uniform float speed;

    void main() {
        vUv = uv;
        vec4 _plane = modelMatrix * vec4(position, 1.0);

        if (hover > 0.0) {
            float _wave = hover * amplitude * sin(speed * (position.x + position.y + time));
            float _dist = length(uv - intersect);
            float _inCircle = 1.  - (clamp(_dist, 0., hoverRadius) / hoverRadius);
            float _distort = _inCircle * _wave;

            _plane.z += _distort;
        }

        gl_Position = projectionMatrix * viewMatrix * _plane;
    }
`;

const FRAGMENT_SHADER = `
    uniform sampler2D uTexture;
    uniform vec2 ratio;

    varying vec2 vUv;

    void main(){

        vec2 uv = vec2(
            vUv. x * ratio.x + (1.0 - ratio.x) * 0.5,
            vUv. y * ratio.y + (1.0 - ratio.y) * 0.5
        );

        gl_FragColor = texture2D(uTexture, uv);
    }
`;

/**
 * Default configuration for the wave effect
 * @typedef {Object} WaveEffectOptions
 */
const DEFAULT_OPTIONS = {
  fov: 50,
  cameraDistance: 50,
  planeWidthSegments: 30,
  hoverRadius: 0.35,
  waveSpeed: 0.7,
  waveAmplitude: 10,
  animationSpeed: 0.05,
  hoverScale: 1.05,
  backgroundColor: "#ffffff",
  transitionDuration: 0.35,
};

/**
 * Checks if WebGL is available in the browser
 * @returns {boolean}
 */
function isWebGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/**
 * Throttle function to limit how often a function can be called
 * @param {Function} func - The function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function}
 */
function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * ImageWaveEffect creates an interactive wave animation effect on images
 * using Three.js and GSAP
 */
class ImageWaveEffect {
  /**
   * @param {HTMLImageElement} imgElement - The image element to apply the effect to
   * @param {Partial<typeof DEFAULT_OPTIONS>} options - Configuration options
   */
  constructor(imgElement, options = {}) {
    if (!imgElement || !(imgElement instanceof HTMLImageElement)) {
      console.error("ImageWaveEffect: Invalid image element provided");
      return;
    }

    this.imgElement = imgElement;
    this.container = imgElement.closest(".pic");
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.mouse = new Vector2();
    this.time = 0;
    this.uv = new Vector2(0, 0);
    this.isHovering = false;
    this.animationFrameId = null;
    this.isDestroyed = false;

    // Bound event handlers for proper cleanup
    this.boundHandleMouseEnter = this.handleMouseEnter.bind(this);
    this.boundHandleMouseMove = throttle(this.handleMouseMove.bind(this), 16);
    this.boundHandleMouseLeave = this.handleMouseLeave.bind(this);
    this.boundHandleResize = this.handleResize.bind(this);

    // Store references for cleanup
    this.texture = null;
    this.geometry = null;
    this.material = null;
    this.resizeObserver = null;
    this.wrapper = null;

    this.init();
  }

  async init() {
    if (!isWebGLAvailable()) {
      console.warn("ImageWaveEffect: WebGL not available, skipping effect");
      return;
    }

    if (!this.container) {
      console.error("ImageWaveEffect: Container with class 'pic' not found");
      return;
    }

    try {
      const imgSrc = this.imgElement.src;

      // Wait for image to load
      await this.waitForImageLoad();

      // Check if destroyed during async operation
      if (this.isDestroyed) return;

      // Get the exact rendered dimensions BEFORE hiding the image
      const imgRect = this.imgElement.getBoundingClientRect();
      this.targetWidth = imgRect.width;
      this.targetHeight = imgRect.height;

      if (this.targetWidth === 0 || this.targetHeight === 0) {
        console.warn("ImageWaveEffect: Image has zero dimensions, skipping");
        return;
      }

      // Create wrapper and canvas
      this.createWrapper();
      this.createCanvas();
      this.setupThreeJS();

      // Create the plane with wave shader
      await this.createPlane(imgSrc);

      // Check if destroyed during async operation
      if (this.isDestroyed) return;

      // Finalize setup
      this.finalizeSetup();

      // Start animation loop
      this.animate();

      // Set up event listeners
      this.setupEventListeners();
    } catch (error) {
      console.error("ImageWaveEffect: Initialization failed", error);
      this.destroy();
    }
  }

  /**
   * Wait for the image to fully load
   * @returns {Promise<void>}
   */
  waitForImageLoad() {
    return new Promise((resolve, reject) => {
      if (this.imgElement.complete && this.imgElement.naturalWidth > 0) {
        resolve();
      } else {
        const onLoad = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("Image failed to load"));
        };
        const cleanup = () => {
          this.imgElement.removeEventListener("load", onLoad);
          this.imgElement.removeEventListener("error", onError);
        };

        this.imgElement.addEventListener("load", onLoad);
        this.imgElement.addEventListener("error", onError);
      }
    });
  }

  createWrapper() {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "wave-image-wrapper";
    Object.assign(this.wrapper.style, {
      width: `${this.targetWidth}px`,
      height: `${this.targetHeight}px`,
      boxShadow: "var(--shad)",
      borderRadius: "5px",
      overflow: "hidden",
      justifySelf: "right",
      display: "block",
    });
  }

  createCanvas() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.targetWidth * window.devicePixelRatio;
    this.canvas.height = this.targetHeight * window.devicePixelRatio;
    Object.assign(this.canvas.style, {
      width: `${this.targetWidth}px`,
      height: `${this.targetHeight}px`,
      display: "block",
    });
  }

  setupThreeJS() {
    this.scene = new Scene();
    this.scene.background = new Color(this.options.backgroundColor);

    this.camera = new PerspectiveCamera(
      this.options.fov,
      this.targetWidth / this.targetHeight,
      1,
      1000,
    );
    this.camera.position.z = this.options.cameraDistance;

    this.raycaster = new Raycaster();

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  }

  finalizeSetup() {
    this.wrapper.appendChild(this.canvas);
    this.imgElement.style.display = "none";
    this.container.appendChild(this.wrapper);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.targetWidth, this.targetHeight);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Load texture and create the plane mesh
   * @param {string} imageSrc - Source URL of the image
   * @returns {Promise<void>}
   */
  async createPlane(imageSrc) {
    this.texture = await this.loadTexture(imageSrc);

    if (this.isDestroyed) return;

    const { planeWidth, planeHeight } = this.calculatePlaneDimensions();
    const ratio = this.calculateTextureRatio(planeWidth, planeHeight);

    this.material = this.createShaderMaterial(ratio);
    this.geometry = this.createPlaneGeometry(planeWidth, planeHeight);

    this.plane = new Mesh(this.geometry, this.material);
    this.scene.add(this.plane);
  }

  /**
   * Load a texture with proper settings
   * @param {string} src - Image source URL
   * @returns {Promise<THREE. Texture>}
   */
  loadTexture(src) {
    return new Promise((resolve, reject) => {
      const loader = new TextureLoader();
      loader.load(
        src,
        (texture) => {
          texture.wrapT = texture.wrapS = RepeatWrapping;
          texture.anisotropy = 0;
          texture.magFilter = LinearFilter;
          texture.minFilter = LinearFilter;
          resolve(texture);
        },
        undefined,
        (error) =>
          reject(new Error(`Failed to load texture: ${error.message}`)),
      );
    });
  }

  calculatePlaneDimensions() {
    const visibleHeight =
      2 *
      Math.tan((this.camera.fov * Math.PI) / 180 / 2) *
      Math.abs(this.options.cameraDistance);
    const visibleWidth = visibleHeight * this.camera.aspect;

    // Fill the entire visible area - plane matches camera frustum exactly
    const planeWidth = visibleWidth;
    const planeHeight = visibleHeight;
    const planeAspectRatio = planeHeight / planeWidth;

    return { planeWidth, planeHeight, planeAspectRatio };
  }

  calculateTextureRatio(planeWidth, planeHeight) {
    const textureAspectRatio =
      this.texture.image.width / this.texture.image.height;
    const planeAspect = planeWidth / planeHeight;

    return new Vector2(
      Math.min(planeAspect / textureAspectRatio, 1.0),
      Math.min(textureAspectRatio / planeAspect, 1.0),
    );
  }

  createShaderMaterial(ratio) {
    return new ShaderMaterial({
      uniforms: {
        hover: { value: 0.0 },
        uTexture: { value: this.texture },
        time: { value: 0 },
        intersect: { value: this.uv },
        ratio: { value: ratio },
        hoverRadius: { value: this.options.hoverRadius },
        speed: { value: this.options.waveSpeed },
        amplitude: { value: this.options.waveAmplitude },
      },
      side: DoubleSide,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
  }

  createPlaneGeometry(planeWidth, planeHeight) {
    const planeAspectRatio = planeHeight / planeWidth;
    return new PlaneGeometry(
      planeWidth,
      planeHeight,
      this.options.planeWidthSegments,
      Math.round(this.options.planeWidthSegments * planeAspectRatio),
    );
  }

  setupEventListeners() {
    if (!this.wrapper) return;

    this.wrapper.addEventListener("mouseenter", this.boundHandleMouseEnter);
    this.wrapper.addEventListener("mousemove", this.boundHandleMouseMove);
    this.wrapper.addEventListener("mouseleave", this.boundHandleMouseLeave);

    // Optional: Handle resize
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.boundHandleResize);
      this.resizeObserver.observe(this.wrapper);
    }
  }

  removeEventListeners() {
    if (!this.wrapper) return;

    this.wrapper.removeEventListener("mouseenter", this.boundHandleMouseEnter);
    this.wrapper.removeEventListener("mousemove", this.boundHandleMouseMove);
    this.wrapper.removeEventListener("mouseleave", this.boundHandleMouseLeave);

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  handleResize(entries) {
    const entry = entries[0];
    if (!entry) return;

    const { width, height } = entry.contentRect;
    if (width === 0 || height === 0) return;

    this.targetWidth = width;
    this.targetHeight = height;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }

  handleMouseEnter() {
    this.isHovering = true;

    if (this.wrapper) {
      this.wrapper.style.cursor = "pointer";
    }

    const duration = this.options.transitionDuration;

    gsap.to(this.plane.material.uniforms.hover, {
      value: 1.0,
      duration,
    });
    gsap.to(this.plane.scale, {
      x: this.options.hoverScale,
      y: this.options.hoverScale,
      duration: duration * 0.7,
    });
  }

  handleMouseMove(e) {
    if (!this.isHovering || !this.wrapper) return;

    const rect = this.wrapper.getBoundingClientRect();

    // Normalized device coordinates for raycaster
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.plane, false);

    if (intersects.length > 0) {
      const { uv } = intersects[0];
      this.uv.x = uv.x;
      this.uv.y = uv.y;

      gsap.to(this.plane.position, {
        x: this.mouse.x * 2,
        y: this.mouse.y * 2,
        duration: this.options.transitionDuration,
      });
    }
  }

  handleMouseLeave() {
    this.isHovering = false;

    if (this.wrapper) {
      this.wrapper.style.cursor = "default";
    }

    const duration = this.options.transitionDuration;

    gsap.to(this.plane.position, { x: 0, y: 0, duration });
    gsap.to(this.plane.scale, { x: 1, y: 1, duration });
    gsap.to(this.plane.material.uniforms.hover, { value: 0.0, duration });
  }

  animate() {
    if (this.isDestroyed) return;

    this.animationFrameId = requestAnimationFrame(() => this.animate());

    this.time += this.options.animationSpeed;

    if (this.plane?.material?.uniforms?.time) {
      this.plane.material.uniforms.time.value = this.time;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Clean up all resources and event listeners
   */
  destroy() {
    this.isDestroyed = true;

    // Stop animation loop
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Remove event listeners
    this.removeEventListeners();

    // Dispose Three.js resources
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }

    if (this.material) {
      this.material.dispose();
      this.material = null;
    }

    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }

    // Remove DOM elements
    if (this.wrapper?.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }

    // Restore original image
    if (this.imgElement) {
      this.imgElement.style.display = "";
    }

    // Clear references
    this.plane = null;
    this.scene = null;
    this.camera = null;
    this.canvas = null;
    this.wrapper = null;
  }
}

// Initialize wave effects for all job images
document.addEventListener("DOMContentLoaded", () => {
  if (!isWebGLAvailable()) {
    console.warn("WebGL not available, wave effects disabled");
    return;
  }

  const jobImages = document.querySelectorAll(".pic img");
  const waveEffects = [];

  const initEffect = (img) => {
    try {
      waveEffects.push(new ImageWaveEffect(img));
    } catch (error) {
      console.error("Failed to initialize wave effect:", error);
    }
  };

  jobImages.forEach((img) => {
    if (img.complete && img.naturalWidth > 0) {
      initEffect(img);
    } else {
      img.addEventListener("load", () => initEffect(img), { once: true });
      img.addEventListener(
        "error",
        () => console.warn("Image failed to load:", img.src),
        { once: true },
      );
    }
  });

  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    waveEffects.forEach((effect) => effect.destroy());
  });
});
