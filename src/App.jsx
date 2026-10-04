import { useState, useEffect, useRef } from "react";
import "./App.css";
import FixMyBatch from "./FixMyBatch";
import ReferenceStyle from "./ReferenceStyle";

// Load an image URL into an <img> element (used for canvas processing)
const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Average color of an image (downscaled for speed)
const getColorStats = (img) => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  let r = 0,
    g = 0,
    b = 0,
    count = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue; // skip transparent pixels
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }

  if (!count) return { r: 128, g: 128, b: 128 };
  return { r: r / count, g: g / count, b: b / count };
};

function App() {
  /* ================= STATE ================= */

  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [screen, setScreen] = useState("landing");
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [masterImage, setMasterImage] = useState(null);
  const [appliedToAll, setAppliedToAll] = useState(false);

  const [background, setBackground] = useState("white");
  const [outputSize, setOutputSize] = useState("square");
  const [cropMode, setCropMode] = useState("smart");
  const [outputFormat, setOutputFormat] = useState("JPG");
  const [quality, setQuality] = useState("High");
  const [smartCrop, setSmartCrop] = useState(true);
  const [command, setCommand] = useState("");
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [toast, setToast] = useState("");
  const [comparePosition, setComparePosition] = useState(50);

  // Keep latest values in refs so we can free blob URLs on unmount
  const imagesRef = useRef([]);
  const masterRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    masterRef.current = masterImage;
  }, [masterImage]);

  // Smart crop indicator always follows the selected crop mode
  useEffect(() => {
    setSmartCrop(cropMode === "smart");
  }, [cropMode]);

  useEffect(() => {
    return () => {
      clearTimeout(toastTimer.current);
      imagesRef.current.forEach((image) => {
        URL.revokeObjectURL(image.url);
        if (image.processedUrl) URL.revokeObjectURL(image.processedUrl);
      });
      if (masterRef.current?.isExternal) {
        URL.revokeObjectURL(masterRef.current.url);
      }
    };
  }, []);

  /* ================= HELPERS ================= */

  // One toast helper: auto-hides, and a new toast resets the timer
  const showToast = (message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  };

  const getDimensions = () =>
    outputSize === "square"
      ? [1080, 1080]
      : outputSize === "portrait"
        ? [1080, 1350]
        : [1920, 1080];

  const aspectValue =
    outputSize === "square"
      ? "1 / 1"
      : outputSize === "portrait"
        ? "4 / 5"
        : "16 / 9";

  // Draw one image onto a canvas using the current settings
  const renderImage = async (image, masterStats) => {
    const img = await loadImage(image.url);
    const [width, height] = getDimensions();

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Background (JPG cannot be transparent, so it falls back to white)
    if (background === "transparent" && outputFormat !== "JPG") {
      ctx.clearRect(0, 0, width, height);
    } else {
      ctx.fillStyle = background === "black" ? "#000000" : "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }

    // Fit = whole image visible, Fill/Smart = cover the frame
    const scale =
      cropMode === "fit"
        ? Math.min(width / img.width, height / img.height)
        : Math.max(width / img.width, height / img.height);

    const drawWidth = img.width * scale;
    const drawHeight = img.height * scale;
    const x = (width - drawWidth) / 2;
    // Smart crop keeps the upper-middle area (where subjects usually are)
    const focusY = cropMode === "smart" ? 0.4 : 0.5;
    const y =
      drawHeight > height
        ? -(drawHeight - height) * focusY
        : (height - drawHeight) / 2;

    ctx.drawImage(img, x, y, drawWidth, drawHeight);

    // ===== MASTER STYLE: match color/tone of the master image =====
    if (masterStats) {
      const src = getColorStats(img);
      const STRENGTH = 0.7; // 0 = no change, 1 = full match

      const gain = (m, s) =>
        1 + (Math.min(1.4, Math.max(0.7, m / Math.max(s, 1))) - 1) * STRENGTH;

      const gr = gain(masterStats.r, src.r);
      const gg = gain(masterStats.g, src.g);
      const gb = gain(masterStats.b, src.b);

      // Only touch the photo area (not the letterbox background)
      const sx = Math.max(0, Math.floor(x));
      const sy = Math.max(0, Math.floor(y));
      const sw = Math.min(width, Math.ceil(x + drawWidth)) - sx;
      const sh = Math.min(height, Math.ceil(y + drawHeight)) - sy;

      if (sw > 0 && sh > 0) {
        const imageData = ctx.getImageData(sx, sy, sw, sh);
        const d = imageData.data;

        for (let i = 0; i < d.length; i += 4) {
          d[i] = Math.min(255, d[i] * gr);
          d[i + 1] = Math.min(255, d[i + 1] * gg);
          d[i + 2] = Math.min(255, d[i + 2] * gb);
        }

        ctx.putImageData(imageData, sx, sy);
      }
    }

    const mimeType =
      outputFormat === "PNG"
        ? "image/png"
        : outputFormat === "WEBP"
          ? "image/webp"
          : "image/jpeg";

    const qualityValue =
      quality === "Standard" ? 0.7 : quality === "High" ? 0.88 : 0.98;

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, mimeType, qualityValue)
    );

    return URL.createObjectURL(blob);
  };

  /* ================= AUTH ================= */

  const handleLogin = (event) => {
    event.preventDefault();

    if (!authEmail || !authPassword) {
      showToast("Please enter email and password");
      return;
    }

    setUser({
      name: authEmail.split("@")[0],
      email: authEmail,
    });

    setAuthPassword("");
    setScreen("dashboard");
  };

  const handleRegister = (event) => {
    event.preventDefault();

    if (!authName || !authEmail || !authPassword) {
      showToast("Please fill all fields");
      return;
    }

    setUser({
      name: authName,
      email: authEmail,
    });

    setAuthPassword("");
    setScreen("dashboard");
  };

  const handleLogout = () => {
    setUser(null);
    setScreen("landing");
  };

  /* ================= IMAGES ================= */

  // Add files (used by both the file picker and drag & drop)
  const addFiles = (fileList) => {
    const files = Array.from(fileList).filter((file) =>
      file.type.startsWith("image/")
    );

    if (!files.length) return;

    const newImages = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      name: file.name,
      url: URL.createObjectURL(file),
      processedUrl: null,
      status: "READY",
    }));

    setImages((previous) => [...previous, ...newImages]);
    setProcessed(false);
    setShowResults(false);
    setAppliedToAll(false);
  };

  // Image upload (file picker)
  const handleUpload = (event) => {
    addFiles(event.target.files);
    // Reset so the same file can be selected again
    event.target.value = "";
  };

  // Drag & drop
  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  // Remove image
  const removeImage = (id) => {
    const target = images.find((image) => image.id === id);
    if (target) {
      URL.revokeObjectURL(target.url);
      if (target.processedUrl) URL.revokeObjectURL(target.processedUrl);
    }

    setImages((previous) => previous.filter((image) => image.id !== id));

    if (selectedImage?.id === id) setSelectedImage(null);

    if (masterImage?.id === id) {
      setMasterImage(null);
      setAppliedToAll(false);
    }

    setProcessed(false);
  };

  /* ================= MASTER STYLE ================= */

  // Upload a master image directly from the Master Style box
  const handleMasterUpload = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !file.type.startsWith("image/")) return;

    if (masterImage?.isExternal) URL.revokeObjectURL(masterImage.url);

    setMasterImage({
      id: `master-${Date.now()}`,
      file,
      name: file.name,
      url: URL.createObjectURL(file),
      isExternal: true, // not part of the batch
    });

    setAppliedToAll(false);
    showToast("✦ Master image added");
  };

  const clearMaster = () => {
    if (masterImage?.isExternal) URL.revokeObjectURL(masterImage.url);
    setMasterImage(null);
    setAppliedToAll(false);
  };

  // Apply master style
  const handleApplyMaster = () => {
    if (!masterImage) return;

    setAppliedToAll(true);
    setProcessed(false);
    showToast("✦ Master style applied — now process your batch");
  };

  /* ================= AI COMMAND ================= */

  const handleCommand = () => {
    if (!command.trim()) return;

    const text = command.toLowerCase();
    let changes = [];

    if (text.includes("square") || text.includes("1:1")) {
      setOutputSize("square");
      changes.push("Square");
    }

    if (text.includes("portrait") || text.includes("4:5")) {
      setOutputSize("portrait");
      changes.push("Portrait");
    }

    if (text.includes("landscape") || text.includes("16:9")) {
      setOutputSize("landscape");
      changes.push("Landscape");
    }

    if (text.includes("white")) {
      setBackground("white");
      changes.push("White background");
    }

    if (text.includes("black")) {
      setBackground("black");
      changes.push("Black background");
    }

    if (text.includes("transparent") || text.includes("clear")) {
      setBackground("transparent");
      changes.push("Transparent background");
    }

    if (text.includes("smart")) {
      setCropMode("smart");
      changes.push("Smart crop");
    }

    if (text.includes("fill")) {
      setCropMode("fill");
      changes.push("Fill crop");
    }

    if (text.includes("fit")) {
      setCropMode("fit");
      changes.push("Fit crop");
    }

    if (text.includes("webp")) {
      setOutputFormat("WEBP");
      changes.push("WEBP");
    }

    if (text.includes("png")) {
      setOutputFormat("PNG");
      changes.push("PNG");
    }

    if (text.includes("jpg") || text.includes("jpeg")) {
      setOutputFormat("JPG");
      changes.push("JPG");
    }

    if (text.includes("maximum")) {
      setQuality("Maximum");
      changes.push("Maximum quality");
    }

    if (text.includes("high")) {
      setQuality("High");
      changes.push("High quality");
    }

    if (text.includes("standard")) {
      setQuality("Standard");
      changes.push("Standard quality");
    }

    if (changes.length > 0) {
      showToast(`✦ Applied: ${changes.join(" · ")}`);
    } else {
      showToast(`Pixel AI understood: "${command}"`);
    }

    setCommand("");
  };

  /* ================= PROCESS BATCH ================= */

  const handleProcess = async () => {
    if (!images.length) {
      showToast("Upload images first!");
      return;
    }

    // Free previous results
    images.forEach((image) => {
      if (image.processedUrl) URL.revokeObjectURL(image.processedUrl);
    });

    setProcessing(true);
    setImages((previous) =>
      previous.map((image) => ({
        ...image,
        processedUrl: null,
        status: "PROCESSING",
      }))
    );

    setProcessed(false);
    setShowResults(false);
    setProcessingStep(0);
    setProcessingProgress(0);

    const steps = [
      "Analyzing images",
      "Smart cropping",
      "Applying visual style",
      "Finalizing batch",
    ];

    // Progress animation
    const animation = new Promise((resolve) => {
      let step = 0;

      const interval = setInterval(() => {
        step++;

        setProcessingStep(step);
        setProcessingProgress(Math.round((step / steps.length) * 100));

        if (step >= steps.length) {
          clearInterval(interval);
          resolve();
        }
      }, 700);
    });

    // Master style stats (computed once for the whole batch)
    let masterStats = null;
    if (appliedToAll && masterImage) {
      try {
        masterStats = getColorStats(await loadImage(masterImage.url));
      } catch (error) {
        console.error("Could not read master image", error);
      }
    }

    // Real image processing (runs at the same time as the animation)
    const rendering = Promise.all(
      images.map(async (image) => {
        try {
          return { id: image.id, url: await renderImage(image, masterStats) };
        } catch (error) {
          console.error("Could not process", image.name, error);
          return { id: image.id, url: null };
        }
      })
    );

    const [, rendered] = await Promise.all([animation, rendering]);
    await wait(600);

    setImages((previous) =>
      previous.map((image) => {
        const result = rendered.find((item) => item.id === image.id);

        return {
          ...image,
          processedUrl: result?.url || null,
          status: "DONE",
        };
      })
    );

    showToast("✓ Batch processing complete");

    setProcessing(false);
    setProcessed(true);
    setShowResults(true);
  };

  // Download all processed images
  const handleDownloadAll = () => {
    images.forEach((image, index) => {
      setTimeout(() => {
        const link = document.createElement("a");
        link.href = image.processedUrl || image.url;
        link.download = `pixel-ai-${index + 1}.${outputFormat.toLowerCase()}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, index * 350);
    });

    showToast("✓ Download started for all images");
  };

  // Before / After slider position
  const updateCompare = (clientX, element) => {
    const rect = element.getBoundingClientRect();
    const position = ((clientX - rect.left) / rect.width) * 100;

    setComparePosition(Math.min(100, Math.max(0, position)));
  };

  /* ================= TOAST (shared by every screen) ================= */

  const toastView = toast && (
    <div className="toast-notification">
      <span>✓</span>
      {toast}
    </div>
  );

  /* ================= SCREENS ================= */

  if (screen === "auth") {
    return (
      <div className="auth-page">
        {toastView}

        <div className="auth-card">
          <div className="auth-logo">
            <span>✦</span> Pixel AI
          </div>

          <h1>
            {authMode === "login" ? "Welcome back" : "Create your account"}
          </h1>

          <p className="auth-subtitle">
            {authMode === "login"
              ? "Sign in to continue to Pixel AI"
              : "Start transforming your images with Pixel AI"}
          </p>

          <form onSubmit={authMode === "login" ? handleLogin : handleRegister}>
            {authMode === "register" && (
              <input
                type="text"
                placeholder="Full name"
                value={authName}
                onChange={(event) => setAuthName(event.target.value)}
              />
            )}

            <input
              type="email"
              placeholder="Email address"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
            />

            <input
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
            />

            <button type="submit" className="auth-submit">
              {authMode === "login" ? "Sign In →" : "Create Account →"}
            </button>
          </form>

          <div className="auth-switch">
            {authMode === "login"
              ? "Don't have an account?"
              : "Already have an account?"}

            <button
              type="button"
              onClick={() =>
                setAuthMode(authMode === "login" ? "register" : "login")
              }
            >
              {authMode === "login" ? " Sign Up" : " Sign In"}
            </button>
          </div>

          <button
            type="button"
            className="auth-back"
            onClick={() => setScreen("landing")}
          >
            ← Back to home
          </button>
        </div>
      </div>
    );
  }

  if (screen === "fix-batch") {
    return <FixMyBatch images={images} onBack={() => setScreen("studio")} />;
  }

  if (screen === "reference-style") {
    return (
      <ReferenceStyle images={images} onBack={() => setScreen("studio")} />
    );
  }

  if (screen === "landing") {
    return (
      <div className="landing-page">
        {toastView}

        <header className="landing-header">
          <div className="logo-area">
            <div className="logo-mark">P</div>

            <div>
              <h1>Pixel AI</h1>
              <p>Batch Image Studio</p>
            </div>
          </div>

          <div className="landing-actions">
            {user ? (
              <button
                className="landing-start"
                onClick={() => setScreen("dashboard")}
              >
                Dashboard →
              </button>
            ) : (
              <>
                <button
                  className="landing-login"
                  onClick={() => {
                    setAuthMode("login");
                    setScreen("auth");
                  }}
                >
                  Sign In
                </button>

                <button
                  className="landing-start"
                  onClick={() => {
                    setAuthMode("register");
                    setScreen("auth");
                  }}
                >
                  Get Started →
                </button>
              </>
            )}
          </div>
        </header>

        <main className="landing-main">
          <span className="landing-tag">✦ INTELLIGENT IMAGE PROCESSING</span>

          <h2>
            One batch.
            <br />
            <span>Every image consistent.</span>
          </h2>

          <p className="landing-description">
            Transform multiple images at once with consistent sizing, smart
            cropping, backgrounds and visual styling.
          </p>

          <div className="landing-buttons">
            <button
              className="landing-primary"
              onClick={() => {
                if (user) {
                  setScreen("dashboard");
                } else {
                  setAuthMode("register");
                  setScreen("auth");
                }
              }}
            >
              Start Creating →
            </button>

            <button
              className="landing-secondary"
              onClick={() => setScreen("studio")}
            >
              Try Studio
            </button>
          </div>

          <div className="landing-features">
            <div>
              <span>✦</span>
              <strong>Batch Processing</strong>
              <small>Transform multiple images together</small>
            </div>

            <div>
              <span>◈</span>
              <strong>Smart Consistency</strong>
              <small>Keep every image visually aligned</small>
            </div>

            <div>
              <span>◇</span>
              <strong>AI Powered</strong>
              <small>Simple commands, faster workflows</small>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (screen === "dashboard") {
    return (
      <div className="dashboard-page">
        {toastView}

        <header className="dashboard-header">
          <div className="logo-area">
            <div className="logo-mark">P</div>

            <div>
              <h1>Pixel AI</h1>
              <p>Batch Image Studio</p>
            </div>
          </div>

          <div className="dashboard-user">
            <div className="user-avatar">
              {user?.name?.charAt(0).toUpperCase()}
            </div>

            <div>
              <strong>{user?.name}</strong>
              <span>{user?.email}</span>
            </div>

            <button onClick={handleLogout}>Logout</button>
          </div>
        </header>

        <main className="dashboard-container">
          <section className="dashboard-welcome">
            <div>
              <span className="dashboard-tag">✦ PIXEL AI WORKSPACE</span>

              <h2>Welcome back, {user?.name}</h2>

              <p>Transform multiple images into a consistent visual batch.</p>
            </div>

            <button
              className="new-batch-button"
              onClick={() => setScreen("studio")}
            >
              + New Batch
            </button>
          </section>

          <section className="dashboard-stats">
            <div className="dashboard-stat-card">
              <span>PROJECTS</span>
              <strong>0</strong>
              <small>Your saved batches</small>
            </div>

            <div className="dashboard-stat-card">
              <span>IMAGES</span>
              <strong>{images.length}</strong>
              <small>Current batch</small>
            </div>

            <div className="dashboard-stat-card">
              <span>AI ENGINE</span>
              <strong>READY</strong>
              <small>System status</small>
            </div>
          </section>

          <section className="dashboard-content">
            <div className="dashboard-main-card">
              <div>
                <span className="card-label">QUICK START</span>
                <h3>Start a new image batch</h3>
                <p>
                  Upload your images and let Pixel AI handle cropping, sizing,
                  backgrounds and consistency.
                </p>
              </div>

              <button onClick={() => setScreen("studio")}>
                Open Studio →
              </button>
            </div>

            <div className="dashboard-side-card">
              <span className="card-label">RECENT ACTIVITY</span>

              <div className="empty-activity">
                <span>✦</span>
                <strong>No projects yet</strong>
                <p>Your processed batches will appear here.</p>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (screen === "studio") {
    return (
      <div className="pixel-app">
        {toastView}

        {/* ================= HEADER ================= */}

        <header className="top-header">
          <div
            className="logo-area"
            style={{ cursor: "pointer" }}
            onClick={() => setScreen(user ? "dashboard" : "landing")}
          >
            <div className="logo-mark">P</div>

            <div>
              <h1>Pixel AI</h1>
              <p>Batch Image Studio</p>
            </div>
          </div>

          <div className="header-status">
            <span className="status-dot"></span>
            AI Engine Ready
          </div>

          <div className="auth-actions">
            <button
              className="header-login"
              onClick={() => setScreen(user ? "dashboard" : "landing")}
            >
              {user ? "← Dashboard" : "← Home"}
            </button>

            {!user && (
              <>
                <button
                  className="header-login"
                  onClick={() => {
                    setAuthMode("login");
                    setScreen("auth");
                  }}
                >
                  Sign In
                </button>

                <button
                  className="header-signup"
                  onClick={() => {
                    setAuthMode("register");
                    setScreen("auth");
                  }}
                >
                  Get Started
                </button>
              </>
            )}
          </div>
        </header>

        {/* ================= MAIN ================= */}

        <main className="main-container">
          {/* HERO */}

          <section className="hero-section">
            <div className="hero-text">
              <span className="tag">✦ INTELLIGENT IMAGE PROCESSING</span>

              <h2>
                One batch.
                <br />
                <span>Every image consistent.</span>
              </h2>

              <p>
                Upload your images once and let Pixel AI handle cropping,
                sizing, alignment and backgrounds automatically.
              </p>
            </div>
          </section>

          {/* ================= AI COMMAND ================= */}

          <section className="ai-command">
            <div className="ai-icon">✦</div>

            <div className="command-content">
              <label htmlFor="ai-command-input">
                Tell Pixel AI what you want
              </label>

              <input
                id="ai-command-input"
                type="text"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleCommand();
                }}
                placeholder="Example: Make all images square with a white background..."
              />
            </div>

            <button onClick={handleCommand}>Run AI →</button>
          </section>

          {/* ================= AI TOOLS ================= */}

          <section className="ai-tools-section">
            <div className="ai-tools-header">
              <div>
                <span>✦ PIXEL AI TOOLS</span>
                <h3>Let AI handle the difficult parts.</h3>
                <p>
                  Choose an intelligent tool to analyze, improve or style your
                  entire batch.
                </p>
              </div>

              <div className="ai-tools-badge">● AI READY</div>
            </div>

            <div className="ai-tools-grid">
              {/* FIX MY BATCH */}

              <div className="ai-tool-card fix-tool">
                <div className="ai-tool-icon">✨</div>

                <div className="ai-tool-content">
                  <span className="ai-tool-label">AUTOMATIC CLEANUP</span>

                  <h4>Fix My Batch</h4>

                  <p>
                    Detect inconsistent dimensions, cropping, backgrounds,
                    empty space and alignment issues automatically.
                  </p>

                  <div className="ai-tool-features">
                    <span>Dimensions</span>
                    <span>Smart Crop</span>
                    <span>Alignment</span>
                  </div>

                  <button onClick={() => setScreen("fix-batch")}>
                    ✨ Fix My Batch →
                  </button>
                </div>
              </div>

              {/* REFERENCE STYLE */}

              <div className="ai-tool-card reference-tool">
                <div className="ai-tool-icon">◈</div>

                <div className="ai-tool-content">
                  <span className="ai-tool-label">STYLE TRANSFER</span>

                  <h4>Reference Style</h4>

                  <p>
                    Upload one reference image and make your entire batch
                    follow its visual style automatically.
                  </p>

                  <div className="ai-tool-features">
                    <span>Color</span>
                    <span>Tone</span>
                    <span>Visual Style</span>
                  </div>

                  <button onClick={() => setScreen("reference-style")}>
                    ◈ Use Reference Style →
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ================= WORKSPACE ================= */}

          <section className="workspace">
            {/* LEFT SIDE */}

            <div className="upload-section">
              <div className="section-header">
                <div>
                  <span>01</span>
                  <h3>Your Image Batch</h3>
                </div>

                <p>{images.length} images</p>
              </div>

              {/* UPLOAD BOX */}

              <label
                className={`upload-box ${dragging ? "dragging" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleUpload}
                />

                <div className="upload-symbol">↑</div>

                <h3>Drop your images here</h3>

                <p>
                  or <strong>browse files</strong>
                </p>

                <small>JPG · PNG · WEBP</small>
              </label>

              {/* IMAGE GRID */}

              {images.length > 0 && (
                <div className="image-grid">
                  {images.map((image) => (
                    <div
                      className={`image-card ${
                        selectedImage?.id === image.id ? "selected" : ""
                      }`}
                      key={image.id}
                      onClick={() => setSelectedImage(image)}
                    >
                      <img src={image.url} alt={image.name} />

                      <button
                        className="master-button"
                        onClick={(event) => {
                          event.stopPropagation();

                          // Free a previously uploaded external master
                          if (masterImage?.isExternal) {
                            URL.revokeObjectURL(masterImage.url);
                          }

                          setMasterImage(image);
                          setSelectedImage(image);
                          setAppliedToAll(false);
                        }}
                      >
                        {masterImage?.id === image.id
                          ? "★ Master"
                          : "Set as Master"}
                      </button>

                      <button
                        className="delete-image"
                        aria-label={`Remove ${image.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeImage(image.id);
                        }}
                      >
                        ×
                      </button>

                      <div
                        className={`image-status ${image.status.toLowerCase()}`}
                      >
                        {image.status === "DONE"
                          ? "✓ DONE"
                          : image.status === "PROCESSING"
                            ? "◌ PROCESSING"
                            : "● READY"}
                      </div>

                      <div className="image-name">{image.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* RIGHT SIDE */}

            <aside className="control-panel">
              <div className="section-header">
                <div>
                  <span>02</span>
                  <h3>AI Transformation</h3>
                </div>
              </div>

              {/* LIVE PREVIEW */}

              <div className="live-preview-box">
                <div className="live-preview-header">
                  <div>
                    <span className="preview-kicker">✦ LIVE PREVIEW</span>
                    <strong>Transformation Preview</strong>
                  </div>

                  {selectedImage && (
                    <span className="preview-live">● LIVE</span>
                  )}
                </div>

                <div
                  className={`preview-stage ${outputSize}`}
                  style={{
                    background:
                      background === "transparent"
                        ? "linear-gradient(45deg, #252525 25%, #333 25%, #333 50%, #252525 50%, #252525 75%, #333 75%)"
                        : background,
                  }}
                >
                  {selectedImage ? (
                    <img
                      src={selectedImage.url}
                      alt="Live transformation preview"
                      style={{
                        objectFit: cropMode === "fit" ? "contain" : "cover",
                        objectPosition:
                          cropMode === "smart" ? "50% 40%" : "50% 50%",
                      }}
                    />
                  ) : (
                    <div className="empty-preview">
                      <span>✦</span>
                      <p>Select an image to preview</p>
                    </div>
                  )}
                </div>

                {selectedImage && (
                  <div className="preview-meta">
                    <span>
                      {outputSize === "square"
                        ? "1080 × 1080"
                        : outputSize === "portrait"
                          ? "1080 × 1350"
                          : "1920 × 1080"}
                    </span>

                    <span>{cropMode.toUpperCase()}</span>

                    <span>{background.toUpperCase()}</span>

                    <span>{outputFormat}</span>
                  </div>
                )}
              </div>

              {/* MASTER STYLE */}

              <div className="master-style">
                <div className="master-header">
                  <div>
                    <span className="master-number">03</span>

                    <div>
                      <strong>Master Style</strong>
                      <p>Choose one image as the visual reference</p>
                    </div>
                  </div>

                  {masterImage && <span className="master-ready">● READY</span>}
                </div>

                {masterImage ? (
                  <div className="master-preview">
                    <img src={masterImage.url} alt="Master" />

                    <div className="master-info">
                      <strong>{masterImage.name}</strong>
                      <span>This image controls the batch style</span>
                    </div>

                    <button onClick={clearMaster}>Change</button>
                  </div>
                ) : (
                  <label className="master-empty master-upload">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleMasterUpload}
                    />

                    <span>↑</span>

                    <div>
                      <strong>Upload a master image</strong>
                      <p>
                        Click here, or use "Set as Master" on any batch image
                      </p>
                    </div>
                  </label>
                )}

                <button
                  className={
                    masterImage
                      ? "apply-all-button"
                      : "apply-all-button disabled"
                  }
                  disabled={!masterImage}
                  onClick={handleApplyMaster}
                >
                  {appliedToAll
                    ? "✓ Style Applied to All"
                    : "Apply Master Style →"}
                </button>
              </div>

              {/* OUTPUT SIZE */}

              <div className="control-group">
                <label>Output Size</label>

                <div className="size-buttons">
                  <button
                    className={outputSize === "square" ? "active" : ""}
                    onClick={() => setOutputSize("square")}
                  >
                    <strong>Square</strong>
                    <span>1080 × 1080</span>
                  </button>

                  <button
                    className={outputSize === "portrait" ? "active" : ""}
                    onClick={() => setOutputSize("portrait")}
                  >
                    <strong>Portrait</strong>
                    <span>1080 × 1350</span>
                  </button>

                  <button
                    className={outputSize === "landscape" ? "active" : ""}
                    onClick={() => setOutputSize("landscape")}
                  >
                    <strong>Landscape</strong>
                    <span>1920 × 1080</span>
                  </button>
                </div>
              </div>

              {/* BACKGROUND */}

              <div className="control-group">
                <label>Background</label>

                <div className="background-buttons">
                  <button
                    className={background === "white" ? "active" : ""}
                    onClick={() => setBackground("white")}
                  >
                    White
                  </button>

                  <button
                    className={background === "black" ? "active" : ""}
                    onClick={() => setBackground("black")}
                  >
                    Black
                  </button>

                  <button
                    className={background === "transparent" ? "active" : ""}
                    onClick={() => setBackground("transparent")}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* CROP MODE */}

              <div className="control-group">
                <label>Crop Mode</label>

                <div className="crop-buttons">
                  <button
                    className={cropMode === "smart" ? "active" : ""}
                    onClick={() => setCropMode("smart")}
                  >
                    <strong>✦ Smart</strong>
                    <span>Keep subject centered</span>
                  </button>

                  <button
                    className={cropMode === "fill" ? "active" : ""}
                    onClick={() => setCropMode("fill")}
                  >
                    <strong>Fill</strong>
                    <span>Cover the frame</span>
                  </button>

                  <button
                    className={cropMode === "fit" ? "active" : ""}
                    onClick={() => setCropMode("fit")}
                  >
                    <strong>Fit</strong>
                    <span>Show full image</span>
                  </button>
                </div>
              </div>

              {/* OUTPUT FORMAT */}

              <div className="control-group">
                <label>Output Format</label>

                <div className="format-row">
                  {["JPG", "PNG", "WEBP"].map((format) => (
                    <button
                      key={format}
                      className={outputFormat === format ? "active" : ""}
                      onClick={() => setOutputFormat(format)}
                    >
                      {format}
                    </button>
                  ))}
                </div>
              </div>

              {/* QUALITY */}

              <div className="control-group">
                <label>Quality</label>

                <div className="format-row">
                  {["Standard", "High", "Maximum"].map((level) => (
                    <button
                      key={level}
                      className={quality === level ? "active" : ""}
                      onClick={() => setQuality(level)}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* BATCH CONSISTENCY */}

              <div className="consistency-card">
                <div className="consistency-icon">✦</div>

                <div>
                  <strong>Batch Consistency</strong>
                  <p>Pixel AI will use the same visual rules for every image.</p>
                </div>

                <span className="check">✓</span>
              </div>

              {/* PROCESSING PANEL */}

              {processing && (
                <div className="processing-panel">
                  <div className="processing-top">
                    <div>
                      <span className="processing-kicker">
                        ✦ PIXEL AI ENGINE
                      </span>

                      <strong>
                        {processingStep === 0 && "Preparing your batch..."}
                        {processingStep === 1 && "Analyzing your images..."}
                        {processingStep === 2 && "Smart cropping your images..."}
                        {processingStep === 3 && "Applying visual style..."}
                        {processingStep === 4 && "Finalizing your batch..."}
                      </strong>
                    </div>

                    <span className="processing-percent">
                      {processingProgress}%
                    </span>
                  </div>

                  <div className="processing-bar">
                    <div
                      className="processing-fill"
                      style={{
                        width: `${processingProgress}%`,
                      }}
                    />
                  </div>

                  <div className="processing-steps">
                    <span className={processingStep >= 1 ? "done" : ""}>
                      {processingStep >= 1 ? "✓" : "○"} Analyzing
                    </span>

                    <span className={processingStep >= 2 ? "done" : ""}>
                      {processingStep >= 2 ? "✓" : "○"} Cropping
                    </span>

                    <span className={processingStep >= 3 ? "done" : ""}>
                      {processingStep >= 3 ? "✓" : "○"} Styling
                    </span>

                    <span className={processingStep >= 4 ? "done" : ""}>
                      {processingStep >= 4 ? "✓" : "○"} Finalizing
                    </span>
                  </div>
                </div>
              )}

              {/* PROCESS BUTTON */}

              <button
                className="process-button"
                onClick={handleProcess}
                disabled={processing}
              >
                {processing
                  ? "◌ Processing Batch..."
                  : processed
                    ? "✓ Batch Processed"
                    : "✦ Process Entire Batch"}
              </button>
            </aside>
          </section>

          {/* ================= AI RESULTS ================= */}

          {showResults && (
            <section className="results-section">
              <div className="results-header">
                <div>
                  <span className="results-tag">✦ AI RESULT</span>

                  <h3>Batch transformation complete</h3>

                  <p>
                    Pixel AI applied the selected visual rules across your
                    batch.
                  </p>
                </div>

                <span className="results-status">✓ COMPLETE</span>
              </div>

              {/* ================= BATCH INSIGHTS ================= */}

              <div className="batch-insights">
                <div className="insights-heading">
                  <div>
                    <span>✦ BATCH INSIGHTS</span>
                    <strong>Transformation Summary</strong>
                  </div>

                  <span className="insights-complete">✓ READY</span>
                </div>

                <div className="insights-grid">
                  <div className="insight-card">
                    <span>IMAGES</span>
                    <strong>{images.length}</strong>
                    <small>Processed</small>
                  </div>

                  <div className="insight-card">
                    <span>CONSISTENCY</span>
                    <strong>96%</strong>
                    <small>Visual match</small>
                  </div>

                  <div className="insight-card">
                    <span>OUTPUT</span>
                    <strong>
                      {outputSize === "square"
                        ? "1:1"
                        : outputSize === "portrait"
                          ? "4:5"
                          : "16:9"}
                    </strong>
                    <small>{outputFormat}</small>
                  </div>

                  <div className="insight-card">
                    <span>QUALITY</span>
                    <strong>{quality}</strong>
                    <small>Export quality</small>
                  </div>
                </div>
              </div>

              <div className="results-grid">
                {images.map((image) => (
                  <div className="result-card" key={image.id}>
                    <div
                      className="comparison-slider"
                      style={{ aspectRatio: aspectValue }}
                      onMouseDown={(event) =>
                        updateCompare(event.clientX, event.currentTarget)
                      }
                      onMouseMove={(event) => {
                        if (event.buttons !== 1) return;
                        updateCompare(event.clientX, event.currentTarget);
                      }}
                      onTouchMove={(event) =>
                        updateCompare(
                          event.touches[0].clientX,
                          event.currentTarget
                        )
                      }
                    >
                      {/* AFTER (processed image) */}
                      <div className="comparison-after">
                        <img
                          src={image.processedUrl || image.url}
                          alt={`After ${image.name}`}
                          draggable={false}
                        />
                      </div>

                      {/* BEFORE (original image) */}
                      <div
                        className="comparison-before"
                        style={{
                          width: `${comparePosition}%`,
                        }}
                      >
                        <img
                          src={image.url}
                          alt={`Before ${image.name}`}
                          draggable={false}
                          style={{
                            width: `${10000 / Math.max(comparePosition, 1)}%`,
                            objectFit: "contain",
                            background: "#111",
                          }}
                        />
                      </div>

                      <span className="compare-label before">BEFORE</span>

                      <span className="compare-label after">AFTER</span>

                      {/* DIVIDER */}
                      <div
                        className="comparison-divider"
                        style={{
                          left: `${comparePosition}%`,
                        }}
                      >
                        <span>↔</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button className="download-button" onClick={handleDownloadAll}>
                ↓ Download All Results
              </button>
            </section>
          )}

          {/* ================= BOTTOM INFO ================= */}

          <section className="info-strip">
            <div>
              <div>
                <strong>{images.length}</strong>
                <span>Images uploaded</span>
              </div>
            </div>

            <div>
              <div>
                <strong>{smartCrop ? "ON" : "OFF"}</strong>
                <span>Smart crop</span>
              </div>
            </div>

            <div>
              <div>
                <strong>{background.toUpperCase()}</strong>
                <span>Background</span>
              </div>
            </div>

            <div>
              <div>
                <strong>AI</strong>
                <span>Batch engine</span>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return null;
}

export default App;