import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import * as THREE from "three";
import "../assets/Style/style.css";
import cheetah from "../assets/Image/cheetah.png";

/* =====================================================================
   SETTINGS YOU CAN TUNE  (if the round eyes do not sit exactly on the
   eyes of your cheetah.png, adjust these numbers)

   x / y  = eye centre, in % of the cheetah image (0 = left/top, 100 = right/bottom)
   size   = eye diameter, in % of the cheetah image width

   Set EYE_DEBUG = true to see a red dashed ring around each eye overlay.
   ===================================================================== */
const EYES = {
  left: { x: 37, y: 43 },
  right: { x: 63, y: 43 },
  size: 14,
};
const PUPIL_TRAVEL = 0.2; // how far the black dot can move (fraction of eye size)
const EYE_DEBUG = false;

/* three.js background dots */
const DOT_COUNT = 220; // number of white dots
const DOT_MIN = 3; // smallest dot (px)
const DOT_MAX = 10; // biggest dot (px)
const DOT_SPEED = 0.5; // drift speed (higher = dots move faster)
const MOUSE_PARALLAX = 0.8; // how much the dots shift with the mouse (0 = off)
const CAM_Z = 10; // camera distance
const DEPTH = 6; // how deep the dot cloud is (front/back)

const CLOUD_BAND = 0.18; // thickness of the first white strip (1 = full screen)
const WELCOME_TEXT =
  "Secure access to your digital workspace. Sign in to run through your tasks at full speed and stay in control.";

// soft cheetah spots on the white cloud (left / top in %, size in px)
const SPOTS = [
  { l: 3, t: 14, w: 46, h: 36, r: 20 },
  { l: 9, t: 38, w: 26, h: 22, r: -15 },
  { l: 5, t: 66, w: 40, h: 30, r: 35 },
  { l: 20, t: 8, w: 22, h: 18, r: 0 },
  { l: 22, t: 74, w: 30, h: 24, r: 50 },
  { l: 46, t: 12, w: 34, h: 26, r: -30 },
  { l: 50, t: 72, w: 28, h: 22, r: 10 },
  { l: 76, t: 30, w: 44, h: 34, r: 25 },
  { l: 90, t: 52, w: 32, h: 26, r: -20 },
  { l: 84, t: 74, w: 50, h: 38, r: 40 },
];

let measureCanvas = null; // used to measure where the typed text ends

const Svg = ({ className, sw = 1.8, children }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

function Proj() {
  const rootRef = useRef(null);
  const bgRef = useRef(null);
  const cloudRef = useRef(null);
  const stageRef = useRef(null);
  const mascotRef = useRef(null);
  const emailRef = useRef(null);
  const eyesRef = useRef({ left: {}, right: {} });
  const introRef = useRef(null);
  const quick = useRef({});
  const mouse = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const [phase, setPhase] = useState("intro"); // intro -> ready -> closing -> intro ...
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [focusField, setFocusField] = useState(null); // null | "email" | "password"
  const [typed, setTyped] = useState("");
  const [popup, setPopup] = useState(null);

  /* ---------- three.js : floating white dots in the background ---------- */
  useEffect(() => {
    const host = bgRef.current;
    if (!host) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (err) {
      return undefined; // no WebGL: the black background still works without dots
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = CAM_Z;

    const positions = new Float32Array(DOT_COUNT * 3);
    const speeds = new Float32Array(DOT_COUNT * 3);
    const sizes = new Float32Array(DOT_COUNT);
    const phases = new Float32Array(DOT_COUNT);
    const bounds = { x: 20, y: 10 };

    for (let i = 0; i < DOT_COUNT; i += 1) {
      speeds[i * 3] = (Math.random() - 0.5) * DOT_SPEED * 2;
      speeds[i * 3 + 1] = (Math.random() - 0.5) * DOT_SPEED * 2;
      speeds[i * 3 + 2] = (Math.random() - 0.5) * DOT_SPEED * 0.4;
      sizes[i] = DOT_MIN + Math.random() * (DOT_MAX - DOT_MIN);
      phases[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * (${CAM_Z.toFixed(1)} / -mv.z);
          vAlpha = 0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * 1.2 + aPhase));
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float core = smoothstep(0.5, 0.1, d);
          if (core <= 0.0) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, core * vAlpha);
        }
      `,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);

    const scatter = () => {
      for (let i = 0; i < DOT_COUNT; i += 1) {
        positions[i * 3] = (Math.random() * 2 - 1) * bounds.x;
        positions[i * 3 + 1] = (Math.random() * 2 - 1) * bounds.y;
        positions[i * 3 + 2] = (Math.random() * 2 - 1) * DEPTH;
      }
      geometry.attributes.position.needsUpdate = true;
    };

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      bounds.y = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (CAM_Z + DEPTH);
      bounds.x = bounds.y * camera.aspect;
      scatter();
      if (reduceMotion) renderer.render(scene, camera);
    };

    const target = { x: 0, y: 0 };
    const onMouse = (e) => {
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    let raf = 0;
    const start = performance.now();
    let last = start;

    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = (now - start) / 1000;
      material.uniforms.uTime.value = t;

      for (let i = 0; i < DOT_COUNT; i += 1) {
        const ix = i * 3;
        positions[ix] += speeds[ix] * dt + Math.sin(t * 0.6 + phases[i]) * 0.35 * dt;
        positions[ix + 1] += speeds[ix + 1] * dt + Math.cos(t * 0.5 + phases[i]) * 0.35 * dt;
        positions[ix + 2] += speeds[ix + 2] * dt;

        if (positions[ix] > bounds.x) positions[ix] = -bounds.x;
        else if (positions[ix] < -bounds.x) positions[ix] = bounds.x;
        if (positions[ix + 1] > bounds.y) positions[ix + 1] = -bounds.y;
        else if (positions[ix + 1] < -bounds.y) positions[ix + 1] = bounds.y;
        if (positions[ix + 2] > DEPTH) positions[ix + 2] = -DEPTH;
        else if (positions[ix + 2] < -DEPTH) positions[ix + 2] = DEPTH;
      }
      geometry.attributes.position.needsUpdate = true;

      camera.position.x += (target.x * MOUSE_PARALLAX - camera.position.x) * 0.04;
      camera.position.y += (-target.y * MOUSE_PARALLAX * 0.6 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduceMotion) {
      window.addEventListener("mousemove", onMouse);
      raf = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  /* ---------- make both pupils look at a screen point ---------- */
  const lookAt = useCallback((tx, ty) => {
    ["left", "right"].forEach((side) => {
      const el = eyesRef.current[side]?.eye;
      const q = quick.current[side];
      if (!el || !q) return;
      const r = el.getBoundingClientRect();
      const dx = tx - (r.left + r.width / 2);
      const dy = ty - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const reach = r.width * PUPIL_TRAVEL * Math.min(1, dist / 140);
      q.x((dx / dist) * reach);
      q.y((dy / dist) * reach);
    });
  }, []);

  /* ---------- look at the caret inside the email box ---------- */
  const lookAtEmail = useCallback(() => {
    const input = emailRef.current;
    if (!input) return;
    const r = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;

    if (!measureCanvas) measureCanvas = document.createElement("canvas");
    const c2d = measureCanvas.getContext("2d");
    c2d.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const caretIndex = input.selectionStart ?? input.value.length;
    const textWidth = c2d.measureText(input.value.slice(0, caretIndex)).width;

    const x = r.left + padL + Math.min(textWidth, r.width - padL - padR);
    lookAt(x, r.top + r.height / 2);
  }, [lookAt]);

  /* ---------- one-time setup: pupils + intro timeline ---------- */
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      // smooth pupil movement
      ["left", "right"].forEach((side) => {
        const pupil = eyesRef.current[side].pupil;
        quick.current[side] = {
          x: gsap.quickTo(pupil, "x", { duration: 0.28, ease: "power3.out" }),
          y: gsap.quickTo(pupil, "y", { duration: 0.28, ease: "power3.out" }),
        };
      });
      gsap.set([eyesRef.current.left.lid, eyesRef.current.right.lid], {
        scaleY: 0,
        transformOrigin: "50% 100%",
      });

      // intro: thin white strip -> spreads to full cloud -> form + cheetah pop in
      gsap.set(cloudRef.current, { scaleX: 0, scaleY: CLOUD_BAND, transformOrigin: "50% 50%" });
      gsap.set(stageRef.current, { autoAlpha: 0 });
      gsap.set(".ch-reveal", { y: 28, autoAlpha: 0 });
      gsap.set(mascotRef.current, { scale: 0.4, y: 50, autoAlpha: 0, transformOrigin: "50% 100%" });

      const tl = gsap.timeline({
        paused: true,
        onComplete: () => setPhase("ready"),
        onReverseComplete: () => {
          // fresh start, like a page refresh
          setEmail("");
          setPassword("");
          setShowPass(false);
          setRemember(true);
          setFocusField(null);
          setTyped("");
          setPhase("intro");
          tl.timeScale(1).play(0);
        },
      });

      tl.to(cloudRef.current, { scaleX: 1, duration: 0.9, ease: "power3.out" })
        .to(cloudRef.current, { scaleY: 1, duration: 1.6, ease: "power3.inOut" }, "+=0.3")
        .to(stageRef.current, { autoAlpha: 1, duration: 0.5, ease: "power1.out" }, "-=0.8")
        .to(
          ".ch-reveal",
          { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.08, ease: "power3.out" },
          "<0.1"
        )
        .to(
          mascotRef.current,
          { scale: 1, y: 0, autoAlpha: 1, duration: 0.9, ease: "back.out(1.6)" },
          "<0.1"
        );

      introRef.current = tl;
      tl.play(0);
    }, rootRef);

    return () => ctx.revert();
  }, []);

  /* ---------- eyes follow the cursor (unless a field is focused) ---------- */
  const focusRef = useRef(null);
  useEffect(() => {
    const onMove = (e) => {
      mouse.current = { x: e.clientX, y: e.clientY };
      if (focusRef.current) return; // while typing, eyes stay on the field
      lookAt(e.clientX, e.clientY);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [lookAt]);

  /* ---------- focus changes: email = watch the field, password = close eyes ---------- */
  useEffect(() => {
    focusRef.current = focusField;
    const { left, right } = eyesRef.current;
    if (!left?.lid || !right?.lid) return;

    const shut = focusField === "password";
    gsap.to([left.lid, right.lid], {
      scaleY: shut ? 1 : 0,
      duration: shut ? 0.4 : 0.3,
      ease: "power2.inOut",
      overwrite: "auto",
    });

    if (focusField === "email") {
      lookAtEmail();
    } else if (!shut) {
      lookAt(mouse.current.x, mouse.current.y);
    }
  }, [focusField, lookAt, lookAtEmail]);

  /* ---------- typing effect on the right side ---------- */
  useEffect(() => {
    if (phase !== "ready") return undefined;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(WELCOME_TEXT.slice(0, i));
      if (i >= WELCOME_TEXT.length) clearInterval(id);
    }, 26);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "ready") lookAt(mouse.current.x, mouse.current.y);
  }, [phase, lookAt]);

  /* ---------- actions ---------- */
  const handleSignIn = (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setPopup({
        type: "error",
        title: "Missing details",
        text: "Enter your email and password to sign in.",
      });
      return;
    }
    setPopup({
      type: "success",
      title: "Signed in",
      text: `Welcome back, ${email.trim()}. The cheetah is ready to run.`,
    });
  };

  const handleCreate = () => {
    if (phase !== "ready" || !introRef.current) return;
    setPopup(null);
    setTyped("");
    setPhase("closing");
    introRef.current.timeScale(1.7).reverse(); // cloud closes, then intro replays fresh
  };

  /* ---------- render ---------- */
  return (
    <div className="ch-page" ref={rootRef}>
      {/* 1. black background (three.js adds the white dots canvas in here) */}
      <div className="ch-bg" ref={bgRef} aria-hidden="true" />

      {/* 2. cloud : thin strip that spreads to the full screen */}
      <svg
        className="ch-cloud"
        ref={cloudRef}
        viewBox="0 0 1500 700"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="chCloudFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf8" />
            <stop offset="1" stopColor="#fff1d6" />
          </linearGradient>
        </defs>
        <path
          fill="url(#chCloudFill)"
          d="M-10,0 L850,0 C905,35 1010,90 1140,95 C1170,70 1300,70 1360,148 C1385,120 1470,130 1510,163 L1510,612 C1490,690 1222,690 1202,612 C1180,690 913,690 893,612 C871,690 611,690 589,612 C567,690 306,690 284,612 C262,690 10,690 -10,612 Z"
        />
      </svg>

      {/* 3. form + cheetah + welcome text */}
      <div className="ch-stage" ref={stageRef}>
        <div className="ch-spots" aria-hidden="true">
          {SPOTS.map((s, i) => (
            <span
              key={i}
              className="ch-spot"
              style={{
                left: `${s.l}%`,
                top: `${s.t}%`,
                width: s.w,
                height: s.h,
                transform: `rotate(${s.r}deg)`,
              }}
            />
          ))}
        </div>

        <div className="ch-left">
          <div className="ch-head ch-reveal">
            <h1 className="ch-title">Hello!</h1>
            <p className="ch-sub">Sign in to your account</p>
          </div>

          <div className="ch-mascot" ref={mascotRef}>
            <div className="ch-tilt">
              <img className="ch-mascot-img" src={cheetah} alt="Cheetah mascot" draggable={false} />
              {["left", "right"].map((side) => (
                <div
                  key={side}
                  className={`ch-ceye${EYE_DEBUG ? " is-debug" : ""}`}
                  ref={(el) => {
                    eyesRef.current[side].eye = el;
                  }}
                  style={{
                    left: `${EYES[side].x}%`,
                    top: `${EYES[side].y}%`,
                    width: `${EYES.size}%`,
                  }}
                >
                  <span
                    className="ch-pupil"
                    ref={(el) => {
                      eyesRef.current[side].pupil = el;
                    }}
                  />
                  <span
                    className="ch-lid"
                    ref={(el) => {
                      eyesRef.current[side].lid = el;
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <form className="ch-form" onSubmit={handleSignIn} noValidate>
            <div className="ch-field ch-reveal">
              <Svg className="ch-ico">
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="m4 7 8 6 8-6" />
              </Svg>
              <input
                ref={emailRef}
                className="ch-input"
                type="email"
                placeholder="Email Address"
                aria-label="Email address"
                autoComplete="email"
                value={email}
                onFocus={() => setFocusField("email")}
                onBlur={() => setFocusField(null)}
                onChange={(e) => {
                  setEmail(e.target.value);
                  lookAtEmail();
                }}
                onKeyUp={lookAtEmail}
                onClick={lookAtEmail}
              />
            </div>

            <div className="ch-field ch-reveal">
              <Svg className="ch-ico">
                <rect x="5" y="11" width="14" height="9" rx="3" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </Svg>
              <input
                className="ch-input"
                type={showPass ? "text" : "password"}
                placeholder="Password"
                aria-label="Password"
                autoComplete="current-password"
                value={password}
                onFocus={() => setFocusField("password")}
                onBlur={() => setFocusField(null)}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="ch-toggle"
                aria-label={showPass ? "Hide password" : "Show password"}
                onMouseDown={(e) => e.preventDefault()} /* keep focus in the password box */
                onClick={() => setShowPass((v) => !v)}
              >
                {showPass ? (
                  <Svg>
                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                    <path d="M3 3l18 18" />
                  </Svg>
                ) : (
                  <Svg>
                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </Svg>
                )}
              </button>
            </div>

            <div className="ch-row ch-reveal">
              <label className="ch-check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span className="ch-box">
                  <Svg sw={3.2}>
                    <path d="m5 12 5 5 9-10" />
                  </Svg>
                </span>
                Remember me
              </label>
              <button type="button" className="ch-link">
                Forgot password?
              </button>
            </div>

            <button type="submit" className="ch-btn ch-reveal">
              SIGN IN
            </button>

            <p className="ch-create ch-reveal">
              Don&apos;t have an account?{" "}
              <button type="button" className="ch-link" onClick={handleCreate}>
                Create
              </button>
            </p>
          </form>
        </div>

        <div className="ch-right">
          <div className="ch-reveal">
            <h2 className="ch-welcome">Welcome Back!</h2>
            <p className="ch-typed">
              {typed}
              <span className="ch-caret" />
            </p>
          </div>
        </div>
      </div>

      {/* 4. sign-in popup */}
      {popup && (
        <div className="ch-modal" role="dialog" aria-modal="true" onClick={() => setPopup(null)}>
          <div className="ch-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className={`ch-modal-badge${popup.type === "error" ? " is-error" : ""}`}>
              {popup.type === "error" ? (
                <Svg sw={2.4}>
                  <path d="M12 7v6" />
                  <path d="M12 17h.01" />
                </Svg>
              ) : (
                <Svg sw={2.6}>
                  <path d="m5 12 5 5 9-10" />
                </Svg>
              )}
            </div>
            <h3 className="ch-modal-title">{popup.title}</h3>
            <p className="ch-modal-text">{popup.text}</p>
            <button type="button" className="ch-btn" onClick={() => setPopup(null)}>
              {popup.type === "error" ? "TRY AGAIN" : "CONTINUE"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Proj;