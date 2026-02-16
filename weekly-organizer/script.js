const STORAGE_KEY = "weekly-organizer-v1";
const BOARD_STORAGE_KEY = "weekly-organizer-board";
const AUTH_BYPASS_SESSION_KEY = "weekly-organizer-auth-bypass-session";
const AUTH_SESSION_KEY = "weekly-organizer-auth-session";

const FIREBASE_APP_URL = "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
const FIREBASE_DB_URL = "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
const FIREBASE_AUTH_URL = "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = window.WEEKLY_ORGANIZER_FIREBASE_CONFIG || {
  apiKey: "<IDE_AZ_API_KEY-T>",
  authDomain: "<IDE_AZ_AUTH_DOMAIN-T>",
  databaseURL: "<IDE_AZ_DATABASE_URL-T>",
  projectId: "<IDE_AZ_PROJECT_ID-T>",
  storageBucket: "<IDE_AZ_STORAGE_BUCKET-T>",
  messagingSenderId: "<IDE_AZ_SENDER_ID-T>",
  appId: "<IDE_AZ_APP_ID-T>",
};

const appConfig = window.WEEKLY_ORGANIZER_APP_CONFIG || {};
const AUTH_MODE = appConfig.authMode === "debug" ? "debug" : "production";
const ENABLE_AGGRESSIVE_MOBILE_AUTO_LOGIN = AUTH_MODE === "debug";

const table = document.getElementById("scheduleTable");
const tableWrap = document.querySelector(".table-wrap");
const refreshBtn = document.getElementById("refreshBtn");
const resetBtn = document.getElementById("resetBtn");
const statusLabel = document.getElementById("status");
const passengerLegend = document.getElementById("passengerLegend");
const driverLegend = document.getElementById("driverLegend");
const boardIdInput = document.getElementById("boardId");
const connectBtn = document.getElementById("connectBtn");
const connectionStatus = document.getElementById("connectionStatus");
const syncToggleBtn = document.getElementById("syncToggleBtn");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");
const authToggleBtn = document.getElementById("authToggleBtn");
const authUsernameInput = document.getElementById("authUsername");
const authPasswordInput = document.getElementById("authPassword");
const appBody = document.body;
const authPanel = document.querySelector(".auth");
const syncPanel = document.querySelector(".sync");

const DEFAULT_BOARD_ID = "heti-szervezo";
const RESET_PASSWORD = "ludovika";
const LOCAL_FALLBACK_USERNAME = "ludovika";
const LOCAL_FALLBACK_PASSWORD = "ludovika";
const LOCAL_FALLBACK_USERNAME_NORMALIZED = LOCAL_FALLBACK_USERNAME
  .normalize("NFKC")
  .trim()
  .toLowerCase();
const LOCAL_FALLBACK_PASSWORD_NORMALIZED = LOCAL_FALLBACK_PASSWORD
  .normalize("NFKC")
  .trim()
  .toLowerCase();

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const passengerFields = ["passenger_1", "passenger_2", "passenger_3", "passenger_4", "passenger_5"];

let firebaseFns = null;
let db = null;
let auth = null;
let currentRef = null;
let unsubscribeRemote = null;
let isAuthed = false;
let isRemoteUpdate = false;
let hasAuthError = false;
let isAuthBypassed = false;
let authInputTouched = false;
let isForcingTabScopedSignOut = false;
let isLoginAttemptInProgress = false;
let isMobileAuthPanelExpanded = false;
let isMobileSyncPanelExpanded = false;
let lastKnownLoggedInState = false;
const authSessionFallbackStore = {
  [AUTH_BYPASS_SESSION_KEY]: "0",
  [AUTH_SESSION_KEY]: "0",
};
const blinkingRows = new Set();
let rowBlinkTickerId = null;
let isRowBlinkOn = true;

const getSessionFlag = (key) => {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return authSessionFallbackStore[key] === "1";
  }
};

const setSessionFlag = (key, enabled) => {
  const value = enabled ? "1" : "0";
  authSessionFallbackStore[key] = value;

  try {
    if (enabled) {
      sessionStorage.setItem(key, "1");
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
  }
};

const isInAppCompactBrowser = () => {
  const ua = navigator.userAgent || "";
  return /(FBAN|FBAV|Messenger|Instagram)/i.test(ua);
};

const isCompactViewport = () => {
  if (window.innerWidth <= 900) {
    return true;
  }

  if (window.matchMedia?.("(max-width: 900px)")?.matches) {
    return true;
  }

  if (window.matchMedia?.("(pointer: coarse)")?.matches) {
    return true;
  }

  return isInAppCompactBrowser();
};

const updateMobileAuthPanel = (isLoggedIn) => {
  const isMobile = isCompactViewport();
  appBody.classList.toggle("auth-mobile", isMobile);

  if (!authPanel || !authToggleBtn) {
    return;
  }

  const canCollapse = isMobile && isLoggedIn;
  authToggleBtn.hidden = !canCollapse;

  if (!canCollapse) {
    authPanel.classList.remove("is-collapsed");
    authToggleBtn.textContent = "Belépés ▼";
    return;
  }

  const shouldCollapse = !isMobileAuthPanelExpanded;
  authPanel.classList.toggle("is-collapsed", shouldCollapse);
  authToggleBtn.textContent = shouldCollapse ? "Belépés ▼" : "Belépés ▲";
};

const updateMobileSyncPanel = (isLoggedIn) => {
  const isMobile = isCompactViewport();

  if (!syncPanel || !syncToggleBtn) {
    return;
  }

  const canCollapse = isMobile && isLoggedIn;
  syncToggleBtn.hidden = !canCollapse;

  if (!canCollapse) {
    syncPanel.classList.remove("is-collapsed");
    syncToggleBtn.textContent = "Tábla ▼";
    return;
  }

  const shouldCollapse = !isMobileSyncPanelExpanded;
  syncPanel.classList.toggle("is-collapsed", shouldCollapse);
  syncToggleBtn.textContent = shouldCollapse ? "Tábla ▼" : "Tábla ▲";
};

const updateUiForAuthState = (isLoggedIn) => {
  if (isLoggedIn !== lastKnownLoggedInState) {
    isMobileAuthPanelExpanded = false;
    isMobileSyncPanelExpanded = false;
    lastKnownLoggedInState = isLoggedIn;
  }
  appBody.classList.toggle("auth-locked", !isLoggedIn);
  appBody.classList.toggle("auth-mobile", isCompactViewport());
  updateMobileAuthPanel(isLoggedIn);
  updateMobileSyncPanel(isLoggedIn);
};

const clearAuthInputsIfUntouched = () => {
  if (authInputTouched) {
    return;
  }
  if (authUsernameInput) {
    authUsernameInput.value = "";
  }
  if (authPasswordInput) {
    authPasswordInput.value = "";
  }
};

const setAuthInputsLocked = (locked) => {
  if (authUsernameInput) {
    authUsernameInput.readOnly = locked;
  }
  if (authPasswordInput) {
    authPasswordInput.readOnly = locked;
  }
};

const cloneData = (value) => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const defaultData = days.reduce((acc, day) => {
  acc[day] = {
    passenger_1: false,
    passenger_2: false,
    passenger_3: false,
    passenger_4: false,
    passenger_5: false,
    driver: "",
  };
  return acc;
}, {});

const parsePassengerValue = (value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "igen", "igaz", "yes", "on"].includes(normalized);
  }
  return false;
};

const normalizeCredentialValue = (value) => {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
};

const blurActiveInput = () => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return;
  }

  if (active.tagName === "INPUT" || active.tagName === "TEXTAREA") {
    active.blur();
  }
};

const normalizeData = (rawData) => {
  const normalized = cloneData(defaultData);

  days.forEach((day) => {
    const sourceDay = rawData?.[day] ?? {};

    passengerFields.forEach((field) => {
      normalized[day][field] = parsePassengerValue(sourceDay[field]);
    });

    normalized[day].driver = typeof sourceDay.driver === "string" ? sourceDay.driver : "";
  });

  return normalized;
};

const saveData = (data) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

const loadData = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneData(defaultData);
    }
    return normalizeData(JSON.parse(raw));
  } catch {
    return cloneData(defaultData);
  }
};

const setStatus = (message) => {
  statusLabel.textContent = message;
  statusLabel.classList.add("pulse");
  setTimeout(() => statusLabel.classList.remove("pulse"), 300);
};

const setAuthStatus = (text, ok = false) => {
  authStatus.textContent = `Állapot: ${text}`;
  authStatus.style.color = ok ? "#15803d" : "#b45309";
};

const setConnectionStatus = (text, ok = false) => {
  connectionStatus.textContent = `Kapcsolat: ${text}`;
  connectionStatus.style.color = ok ? "#15803d" : "#b45309";
};

const applyRowBlinkState = (row, isOn) => {
  if (!row) {
    return;
  }

  const cells = row.querySelectorAll("td");
  cells.forEach((cell) => {
    cell.style.backgroundColor = isOn ? "rgba(239, 68, 68, 0.55)" : "";
  });

  const rowInputs = row.querySelectorAll("input");
  rowInputs.forEach((input) => {
    input.style.boxShadow = isOn ? "inset 0 0 0 999px rgba(239, 68, 68, 0.25)" : "";
  });
};

const applyBlinkStateToAllRows = () => {
  blinkingRows.forEach((row) => {
    row.classList.toggle("row-total-alert-on", isRowBlinkOn);
    applyRowBlinkState(row, isRowBlinkOn);
  });
};

const ensureBlinkTicker = () => {
  if (rowBlinkTickerId || blinkingRows.size === 0) {
    return;
  }

  rowBlinkTickerId = setInterval(() => {
    isRowBlinkOn = !isRowBlinkOn;
    applyBlinkStateToAllRows();
  }, 1000);
};

const stopBlinkTickerIfIdle = () => {
  if (blinkingRows.size > 0 || !rowBlinkTickerId) {
    return;
  }

  clearInterval(rowBlinkTickerId);
  rowBlinkTickerId = null;
  isRowBlinkOn = true;
};

const setRowBlinking = (row, shouldBlink) => {
  if (!row) {
    return;
  }

  if (!shouldBlink) {
    blinkingRows.delete(row);
    row.classList.remove("row-total-alert", "row-total-alert-on");
    applyRowBlinkState(row, false);
    stopBlinkTickerIfIdle();
    return;
  }

  if (blinkingRows.has(row)) {
    return;
  }

  blinkingRows.add(row);
  row.classList.add("row-total-alert", "row-total-alert-on");
  applyRowBlinkState(row, isRowBlinkOn);
  ensureBlinkTicker();
};

const updateTotalsFromInputs = () => {
  days.forEach((day) => {
    const totalCell = table.querySelector(`[data-total-day="${day}"]`);
    if (!totalCell) {
      return;
    }

    const total = passengerFields.reduce((count, field) => {
      const checkbox = table.querySelector(`input[type="checkbox"][data-day="${day}"][data-field="${field}"]`);
      return count + (checkbox?.checked ? 1 : 0);
    }, 0);

    totalCell.textContent = String(total);

    const row = totalCell.closest("tr");
    setRowBlinking(row, total === 5);
  });
};

const fillInputs = (data) => {
  const fields = table.querySelectorAll("[data-day][data-field]");
  fields.forEach((fieldElement) => {
    const day = fieldElement.dataset.day;
    const field = fieldElement.dataset.field;

    if (fieldElement.tagName === "INPUT") {
      if (fieldElement.type === "checkbox") {
        fieldElement.checked = Boolean(data?.[day]?.[field]);
      } else {
        fieldElement.value = data?.[day]?.[field] ?? "";
      }
      return;
    }

    if (fieldElement.tagName === "BUTTON" && field === "driver") {
      const driverValue = typeof data?.[day]?.[field] === "string" ? data[day][field] : "";
      fieldElement.dataset.driverValue = driverValue;
      fieldElement.textContent = driverValue || "Kocsivezető";
    }
  });

  updateTotalsFromInputs();
};

const readInputs = () => {
  const data = cloneData(defaultData);
  const fields = table.querySelectorAll("[data-day][data-field]");

  fields.forEach((fieldElement) => {
    const day = fieldElement.dataset.day;
    const field = fieldElement.dataset.field;

    if (fieldElement.tagName === "INPUT") {
      if (fieldElement.type === "checkbox") {
        data[day][field] = fieldElement.checked;
      } else {
        data[day][field] = fieldElement.value.trim();
      }
      return;
    }

    if (fieldElement.tagName === "BUTTON" && field === "driver") {
      data[day][field] = (fieldElement.dataset.driverValue || "").trim();
    }
  });

  return data;
};

const isFirebaseConfigured = (config) => {
  return Object.values(config).every((value) => {
    if (!value) {
      return false;
    }
    return !(String(value).includes("<") || String(value).includes("IDE_AZ"));
  });
};

const loadFirebaseFns = async () => {
  if (firebaseFns) {
    return firebaseFns;
  }

  const [appModule, dbModule, authModule] = await Promise.all([
    import(FIREBASE_APP_URL),
    import(FIREBASE_DB_URL),
    import(FIREBASE_AUTH_URL),
  ]);

  firebaseFns = {
    initializeApp: appModule.initializeApp,
    getDatabase: dbModule.getDatabase,
    ref: dbModule.ref,
    onValue: dbModule.onValue,
    off: dbModule.off,
    set: dbModule.set,
    get: dbModule.get,
    getAuth: authModule.getAuth,
    setPersistence: authModule.setPersistence,
    browserSessionPersistence: authModule.browserSessionPersistence,
    onAuthStateChanged: authModule.onAuthStateChanged,
    signInWithEmailAndPassword: authModule.signInWithEmailAndPassword,
    createUserWithEmailAndPassword: authModule.createUserWithEmailAndPassword,
    signOut: authModule.signOut,
  };

  return firebaseFns;
};

const initFirebase = async () => {
  if (!isFirebaseConfigured(firebaseConfig)) {
    setAuthStatus("nincs konfiguráció");
    setConnectionStatus("helyi");
    loginBtn.disabled = false;
    logoutBtn.disabled = false;
    connectBtn.disabled = false;
    return false;
  }

  try {
    const fns = await loadFirebaseFns();
    const app = fns.initializeApp(firebaseConfig);
    db = fns.getDatabase(app);
    auth = fns.getAuth(app);
    try {
      await fns.setPersistence(auth, fns.browserSessionPersistence);
    } catch (error) {
      console.warn("Session persistence setup error", error);
    }
    setAuthStatus("nincs bejelentkezés");
    return true;
  } catch (error) {
    console.error("Firebase init error", error);
    setAuthStatus("hiba a konfigurációban");
    setConnectionStatus("helyi");
    loginBtn.disabled = false;
    logoutBtn.disabled = false;
    connectBtn.disabled = false;
    return false;
  }
};

const disconnectRemote = () => {
  if (currentRef && unsubscribeRemote) {
    firebaseFns.off(currentRef);
    unsubscribeRemote = null;
  }
  currentRef = null;
};

const connectToBoard = (boardId) => {
  if (!db) {
    setConnectionStatus("helyi");
    return;
  }

  if (!isAuthed && !isAuthBypassed) {
    setConnectionStatus("helyi (nincs belépés)");
    return;
  }

  disconnectRemote();

  currentRef = firebaseFns.ref(db, `boards/${boardId}`);
  setConnectionStatus("csatlakozás...");

  unsubscribeRemote = firebaseFns.onValue(
    currentRef,
    (snapshot) => {
      const remoteData = snapshot.val();
      if (remoteData) {
        isRemoteUpdate = true;
        const normalized = normalizeData(remoteData);
        fillInputs(normalized);
        saveData(normalized);
        isRemoteUpdate = false;
        setStatus("Szinkronizálva");
      }
      setConnectionStatus("online", true);
    },
    (error) => {
      console.error("Remote listen error", error);
      setConnectionStatus("hibás kapcsolat");
    }
  );
};

const sendToRemote = async (data) => {
  if (!currentRef) {
    return;
  }
  await firebaseFns.set(currentRef, data);
};

const refreshData = async () => {
  if (currentRef) {
    try {
      const snapshot = await firebaseFns.get(currentRef);
      if (snapshot.exists()) {
        const normalized = normalizeData(snapshot.val());
        fillInputs(normalized);
        saveData(normalized);
        setStatus("Frissítve (online)");
        return;
      }
    } catch (error) {
      console.error("Manual refresh error", error);
    }
  }

  const latest = loadData();
  fillInputs(latest);
  setStatus("Frissítve");
};

const init = async () => {
  updateUiForAuthState(false);
  setAuthInputsLocked(false);
  clearAuthInputsIfUntouched();

  const markAuthInputTouched = () => {
    authInputTouched = true;
  };

  authUsernameInput?.addEventListener("input", markAuthInputTouched);
  authPasswordInput?.addEventListener("input", markAuthInputTouched);

  authToggleBtn?.addEventListener("click", () => {
    if (!isCompactViewport() || (!isAuthed && !isAuthBypassed)) {
      return;
    }

    isMobileAuthPanelExpanded = !isMobileAuthPanelExpanded;
    updateMobileAuthPanel(true);
  });

  syncToggleBtn?.addEventListener("click", () => {
    if (!isCompactViewport() || (!isAuthed && !isAuthBypassed)) {
      return;
    }

    isMobileSyncPanelExpanded = !isMobileSyncPanelExpanded;
    updateMobileSyncPanel(true);
  });

  window.addEventListener("resize", () => {
    const isLoggedIn = isAuthed || isAuthBypassed;
    appBody.classList.toggle("auth-mobile", isCompactViewport());
    updateMobileAuthPanel(isLoggedIn);
    updateMobileSyncPanel(isLoggedIn);
  });

  setTimeout(clearAuthInputsIfUntouched, 150);
  setTimeout(clearAuthInputsIfUntouched, 700);
  window.addEventListener("pageshow", () => {
    setTimeout(clearAuthInputsIfUntouched, 50);
  });

  const saved = loadData();
  fillInputs(saved);

  const jumpToUtasDriverColumnsOnMobile = () => {
    if (!tableWrap || !isCompactViewport()) {
      return;
    }

    const firstRow = table.querySelector("tbody tr");
    const utasCell = firstRow?.querySelector("td:nth-child(7)");
    if (!utasCell) {
      return;
    }

    const targetLeft = utasCell.offsetLeft - 8;
    const safeLeft = Math.max(0, targetLeft);
    tableWrap.scrollLeft = safeLeft;

    try {
      tableWrap.scrollTo({
        left: safeLeft,
        behavior: "smooth",
      });
    } catch {
      tableWrap.scrollLeft = safeLeft;
    }
  };

  const jumpFromDriverLegend = () => {
    jumpToUtasDriverColumnsOnMobile();
  };

  const jumpFromPassengerLegend = () => {
    if (!tableWrap || !isCompactViewport()) {
      return;
    }

    tableWrap.scrollLeft = 0;
    try {
      tableWrap.scrollTo({
        left: 0,
        behavior: "smooth",
      });
    } catch {
      tableWrap.scrollLeft = 0;
    }
  };

  const persistCurrentData = () => {
    const current = readInputs();
    updateTotalsFromInputs();
    saveData(current);
    setStatus(`Mentés: ${new Date().toLocaleTimeString("hu-HU")}`);

    sendToRemote(current).catch((error) => {
      console.error("Remote save error", error);
      setConnectionStatus("hibás kapcsolat");
    });
  };

  passengerLegend?.addEventListener("click", jumpFromPassengerLegend);
  passengerLegend?.addEventListener("touchstart", jumpFromPassengerLegend, { passive: true });
  passengerLegend?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    jumpFromPassengerLegend();
  });

  driverLegend?.addEventListener("click", jumpFromDriverLegend);
  driverLegend?.addEventListener("touchstart", jumpFromDriverLegend, { passive: true });
  driverLegend?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    jumpFromDriverLegend();
  });

  const boardFromStorage = localStorage.getItem(BOARD_STORAGE_KEY) || DEFAULT_BOARD_ID;
  if (!localStorage.getItem(BOARD_STORAGE_KEY)) {
    localStorage.setItem(BOARD_STORAGE_KEY, boardFromStorage);
  }
  boardIdInput.value = boardFromStorage;

  const connectAndRefreshAfterLogin = () => {
    const boardId = boardIdInput.value.trim() || boardFromStorage;
    if (boardId) {
      connectToBoard(boardId);
    }

    refreshData().catch((error) => {
      console.error("Auto refresh after login error", error);
    });
  };

  const handleTableEdit = () => {
    if (isRemoteUpdate) {
      return;
    }

    persistCurrentData();
  };

  table.addEventListener("input", handleTableEdit);
  table.addEventListener("change", handleTableEdit);

  refreshBtn.addEventListener("click", () => {
    refreshData();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    const latest = loadData();
    fillInputs(latest);
  });

  let lastResetRequestAt = 0;

  const runResetFlow = () => {
    const now = Date.now();
    if (now - lastResetRequestAt < 700) {
      return;
    }
    lastResetRequestAt = now;

    let enteredPassword = null;
    try {
      enteredPassword = window.prompt("Add meg a törlési jelszót:", "");
    } catch {
      setStatus("A böngésző letiltotta a jelszókérést");
      return;
    }

    if (enteredPassword === null) {
      if (isInAppCompactBrowser()) {
        setStatus("Messenger letiltotta a jelszókérést: Nyisd meg külső böngészőben");
        return;
      }
      setStatus("Törlés megszakítva");
      return;
    }

    if (String(enteredPassword) !== RESET_PASSWORD) {
      setStatus("Hibás jelszó, törlés megszakítva");
      return;
    }

    const cleared = cloneData(defaultData);
    fillInputs(cleared);
    saveData(cleared);
    setStatus("Mentés: minden törölve");

    sendToRemote(cleared).catch((error) => {
      console.error("Remote save error", error);
      setConnectionStatus("hibás kapcsolat");
    });
  };

  resetBtn.addEventListener("click", runResetFlow);
  resetBtn.addEventListener(
    "touchend",
    (event) => {
      event.preventDefault();
      runResetFlow();
    },
    { passive: false }
  );
  resetBtn.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") {
      return;
    }
    event.preventDefault();
    runResetFlow();
  });

  const firebaseReady = await initFirebase();
  if (!firebaseReady) {
    updateUiForAuthState(false);
    return;
  }

  const setAuthStatusFromError = (error, fallbackText = "hibás belépés") => {
    const code = error?.code || "";

    if (code === "auth/configuration-not-found") {
      hasAuthError = false;
      isAuthBypassed = true;
      isAuthed = false;
      setSessionFlag(AUTH_BYPASS_SESSION_KEY, true);
      setSessionFlag(AUTH_SESSION_KEY, false);
      setAuthStatus("bejelentkezve (auth nélkül)", true);
      updateUiForAuthState(true);
      connectAndRefreshAfterLogin();
      return;
    }

    if (code === "auth/operation-not-allowed") {
      hasAuthError = true;
      setAuthStatus("Email/jelszó belépés nincs engedélyezve");
      return;
    }

    if (code === "auth/network-request-failed") {
      hasAuthError = true;
      setAuthStatus("nincs internet vagy hálózati hiba");
      return;
    }

    if (code === "auth/invalid-api-key") {
      hasAuthError = true;
      setAuthStatus("hibás Firebase API kulcs");
      return;
    }

    if (code === "auth/web-storage-unsupported") {
      hasAuthError = true;
      setAuthStatus("böngésző tárhely tiltva (mobil/privát mód)");
      return;
    }

    if (code === "auth/unauthorized-domain") {
      hasAuthError = true;
      setAuthStatus("nem engedélyezett domain (mobil host)");
      return;
    }

    hasAuthError = true;
    const suffix = code ? ` (${code})` : "";
    setAuthStatus(`${fallbackText}${suffix}`);
  };

  const toEmailFromUsername = (username) => {
    if (username.includes("@")) {
      return username;
    }
    return `${username}@ludovika.local`;
  };

  const loginWithCredentials = async (username, password) => {
    hasAuthError = false;
    isAuthBypassed = false;
    isLoginAttemptInProgress = true;

    const normalizedUsername = String(username || "").trim();
    const normalizedPassword = String(password || "");
    const normalizedUsernameForFallback = normalizeCredentialValue(normalizedUsername);
    const normalizedPasswordForFallback = normalizeCredentialValue(normalizedPassword);

    if (!normalizedUsername || !normalizedPassword) {
      isLoginAttemptInProgress = false;
      hasAuthError = true;
      setAuthStatus("add meg a felhasználót és jelszót");
      return;
    }

    const email = toEmailFromUsername(normalizedUsername);
    const isLocalFallbackCredential =
      normalizedUsernameForFallback === LOCAL_FALLBACK_USERNAME_NORMALIZED &&
      normalizedPasswordForFallback === LOCAL_FALLBACK_PASSWORD_NORMALIZED;

    if (isLocalFallbackCredential) {
      isAuthBypassed = true;
      isAuthed = false;
      hasAuthError = false;
      setSessionFlag(AUTH_BYPASS_SESSION_KEY, true);
      setSessionFlag(AUTH_SESSION_KEY, false);
      setAuthStatus("bejelentkezve (helyi mód)", true);
      updateUiForAuthState(true);
      connectAndRefreshAfterLogin();
      isLoginAttemptInProgress = false;
      return;
    }

    try {
      setSessionFlag(AUTH_SESSION_KEY, true);
      await firebaseFns.signInWithEmailAndPassword(auth, email, normalizedPassword);
      setAuthStatus("bejelentkezve", true);
      return;
    } catch (error) {
      const code = error?.code || "";
      const canUseLocalFallback =
        isLocalFallbackCredential &&
        [
          "auth/network-request-failed",
          "auth/unauthorized-domain",
          "auth/configuration-not-found",
          "auth/operation-not-allowed",
          "auth/web-storage-unsupported",
          "auth/internal-error",
          "auth/invalid-credential",
          "auth/user-not-found",
          "auth/wrong-password",
        ].includes(code);

      if (canUseLocalFallback) {
        isAuthBypassed = true;
        isAuthed = false;
        hasAuthError = false;
        setSessionFlag(AUTH_BYPASS_SESSION_KEY, true);
        setSessionFlag(AUTH_SESSION_KEY, false);
        setAuthStatus("bejelentkezve (helyi mód)", true);
        updateUiForAuthState(true);
        connectAndRefreshAfterLogin();
        return;
      }

      setSessionFlag(AUTH_SESSION_KEY, false);
      throw error;
    } finally {
      isLoginAttemptInProgress = false;
    }
  };

  const handleLoginClick = async () => {
    const username = authUsernameInput?.value || "";
    const password = authPasswordInput?.value || "";

    blurActiveInput();

    try {
      await loginWithCredentials(username, password);
    } catch (error) {
      console.error("Login error", error);
      setAuthStatusFromError(error, `hibás belépés (${String(username).trim() || "ismeretlen"})`);
    }
  };

  const tryAutoLocalLogin = async () => {
    const username = normalizeCredentialValue(authUsernameInput?.value || "");
    const password = normalizeCredentialValue(authPasswordInput?.value || "");

    if (username !== LOCAL_FALLBACK_USERNAME_NORMALIZED || password !== LOCAL_FALLBACK_PASSWORD_NORMALIZED) {
      return;
    }

    if (isAuthBypassed || isAuthed || isLoginAttemptInProgress) {
      return;
    }

    await handleLoginClick();
  };

  loginBtn.addEventListener("click", handleLoginClick);
  if (ENABLE_AGGRESSIVE_MOBILE_AUTO_LOGIN) {
    loginBtn.addEventListener("touchend", (event) => {
      event.preventDefault();
      handleLoginClick();
    });
    loginBtn.addEventListener("pointerup", (event) => {
      if (event.pointerType !== "touch") {
        return;
      }
      event.preventDefault();
      handleLoginClick();
    });
  }

  const handleLoginEnter = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    handleLoginClick();
  };

  authUsernameInput?.addEventListener("keydown", handleLoginEnter);
  authPasswordInput?.addEventListener("keydown", handleLoginEnter);
  if (ENABLE_AGGRESSIVE_MOBILE_AUTO_LOGIN) {
    authUsernameInput?.addEventListener("change", () => {
      tryAutoLocalLogin();
    });
    authUsernameInput?.addEventListener("input", () => {
      tryAutoLocalLogin();
    });
    authPasswordInput?.addEventListener("change", () => {
      tryAutoLocalLogin();
    });
    authPasswordInput?.addEventListener("input", () => {
      tryAutoLocalLogin();
    });
    authUsernameInput?.addEventListener("blur", () => {
      tryAutoLocalLogin();
    });
    authPasswordInput?.addEventListener("blur", () => {
      tryAutoLocalLogin();
    });
    setTimeout(() => {
      tryAutoLocalLogin();
    }, 300);
  }

  logoutBtn.addEventListener("click", async () => {
    if (isAuthBypassed) {
      isAuthBypassed = false;
      hasAuthError = false;
      setSessionFlag(AUTH_BYPASS_SESSION_KEY, false);
      setSessionFlag(AUTH_SESSION_KEY, false);
      setAuthStatus("kijelentkezve");
      updateUiForAuthState(false);
      setConnectionStatus("helyi");
      disconnectRemote();
      return;
    }

    if (!auth?.currentUser) {
      hasAuthError = false;
      setAuthStatus("nincs aktív bejelentkezés");
      return;
    }

    try {
      await firebaseFns.signOut(auth);
      hasAuthError = false;
      setSessionFlag(AUTH_BYPASS_SESSION_KEY, false);
      setSessionFlag(AUTH_SESSION_KEY, false);
      setAuthStatus("kijelentkezve");
    } catch (error) {
      console.error("Logout error", error);
      setAuthStatusFromError(error, "kijelentkezési hiba");
    }
  });

  connectBtn.addEventListener("click", () => {
    const boardId = boardIdInput.value.trim();
    if (!boardId) {
      setConnectionStatus("helyi (nincs azonosító)");
      return;
    }
    localStorage.setItem(BOARD_STORAGE_KEY, boardId);
    connectToBoard(boardId);
  });

  const hasBypassSession = getSessionFlag(AUTH_BYPASS_SESSION_KEY);
  if (hasBypassSession) {
    isAuthBypassed = true;
    hasAuthError = false;
    setAuthStatus("bejelentkezve (auth nélkül)", true);
    updateUiForAuthState(true);
    connectAndRefreshAfterLogin();
  }

  if (!hasBypassSession) {
    setAuthStatus("nincs bejelentkezés");
    updateUiForAuthState(false);
  }

  firebaseFns.onAuthStateChanged(auth, (user) => {
    if (isAuthBypassed) {
      setAuthStatus("bejelentkezve (auth nélkül)", true);
      updateUiForAuthState(true);
      connectAndRefreshAfterLogin();
      return;
    }

    isAuthed = Boolean(user);
    if (isAuthed) {
      const hasTabAuthSession = getSessionFlag(AUTH_SESSION_KEY);
      if (!hasTabAuthSession && !isLoginAttemptInProgress && !isForcingTabScopedSignOut) {
        isForcingTabScopedSignOut = true;
        firebaseFns
          .signOut(auth)
          .finally(() => {
            isForcingTabScopedSignOut = false;
          });
        return;
      }

      hasAuthError = false;
      setAuthStatus("bejelentkezve", true);
      updateUiForAuthState(true);
      connectAndRefreshAfterLogin();
      return;
    }

    if (!hasAuthError) {
      setSessionFlag(AUTH_SESSION_KEY, false);
      setAuthStatus("nincs bejelentkezés");
    }
    updateUiForAuthState(false);
    setConnectionStatus("helyi");
    disconnectRemote();
  });
};

init().catch((error) => {
  console.error("Init error", error);
  setStatus("Hiba történt");
});
