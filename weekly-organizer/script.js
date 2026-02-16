const STORAGE_KEY = "weekly-organizer-v1";
const BOARD_STORAGE_KEY = "weekly-organizer-board";

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

const table = document.getElementById("scheduleTable");
const refreshBtn = document.getElementById("refreshBtn");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");
const statusLabel = document.getElementById("status");
const boardIdInput = document.getElementById("boardId");
const connectBtn = document.getElementById("connectBtn");
const connectionStatus = document.getElementById("connectionStatus");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");
const authUsernameInput = document.getElementById("authUsername");
const authPasswordInput = document.getElementById("authPassword");

const DEFAULT_BOARD_ID = "heti-szervezo";

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
  });
};

const fillInputs = (data) => {
  const inputs = table.querySelectorAll("input[data-day][data-field]");
  inputs.forEach((input) => {
    const day = input.dataset.day;
    const field = input.dataset.field;

    if (input.type === "checkbox") {
      input.checked = Boolean(data?.[day]?.[field]);
    } else {
      input.value = data?.[day]?.[field] ?? "";
    }
  });

  updateTotalsFromInputs();
};

const readInputs = () => {
  const data = cloneData(defaultData);
  const inputs = table.querySelectorAll("input[data-day][data-field]");

  inputs.forEach((input) => {
    const day = input.dataset.day;
    const field = input.dataset.field;

    if (input.type === "checkbox") {
      data[day][field] = input.checked;
    } else {
      data[day][field] = input.value.trim();
    }
  });

  return data;
};

const exportToCsv = () => {
  const data = readInputs();
  const header = ["Day", ...passengerFields, "osszesen", "Driver"];

  const rows = days.map((day) => {
    const total = passengerFields.reduce((count, field) => count + (data[day][field] ? 1 : 0), 0);
    const row = [
      day,
      ...passengerFields.map((field) => (data[day][field] ? "igaz" : "hamis")),
      total,
      data[day].driver || "",
    ];

    return row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",");
  });

  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "weekly-organizer.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  const saved = loadData();
  fillInputs(saved);

  const boardFromStorage = localStorage.getItem(BOARD_STORAGE_KEY) || DEFAULT_BOARD_ID;
  if (!localStorage.getItem(BOARD_STORAGE_KEY)) {
    localStorage.setItem(BOARD_STORAGE_KEY, boardFromStorage);
  }
  boardIdInput.value = boardFromStorage;

  const handleTableEdit = () => {
    if (isRemoteUpdate) {
      return;
    }

    const current = readInputs();
    updateTotalsFromInputs();
    saveData(current);
    setStatus(`Mentés: ${new Date().toLocaleTimeString("hu-HU")}`);

    sendToRemote(current).catch((error) => {
      console.error("Remote save error", error);
      setConnectionStatus("hibás kapcsolat");
    });
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

  resetBtn.addEventListener("click", () => {
    const cleared = cloneData(defaultData);
    fillInputs(cleared);
    saveData(cleared);
    setStatus("Mentés: minden törölve");

    sendToRemote(cleared).catch((error) => {
      console.error("Remote save error", error);
      setConnectionStatus("hibás kapcsolat");
    });
  });

  exportBtn.addEventListener("click", exportToCsv);

  const firebaseReady = await initFirebase();
  if (!firebaseReady) {
    return;
  }

  const setAuthStatusFromError = (error, fallbackText = "hibás belépés") => {
    const code = error?.code || "";

    if (code === "auth/configuration-not-found") {
      hasAuthError = false;
      isAuthBypassed = true;
      isAuthed = false;
      setAuthStatus("bejelentkezve (auth nélkül)", true);
      const boardId = boardIdInput.value.trim() || boardFromStorage;
      if (boardId) {
        connectToBoard(boardId);
      }
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

    const normalizedUsername = String(username || "").trim();
    const normalizedPassword = String(password || "");

    if (!normalizedUsername || !normalizedPassword) {
      hasAuthError = true;
      setAuthStatus("add meg a felhasználót és jelszót");
      return;
    }

    const email = toEmailFromUsername(normalizedUsername);

    try {
      await firebaseFns.signInWithEmailAndPassword(auth, email, normalizedPassword);
      setAuthStatus("bejelentkezve", true);
      return;
    } catch (error) {
      const code = error?.code || "";

      if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
        await firebaseFns.createUserWithEmailAndPassword(auth, email, normalizedPassword);
        setAuthStatus("bejelentkezve", true);
        return;
      }

      if (code === "auth/email-already-in-use") {
        await firebaseFns.signInWithEmailAndPassword(auth, email, normalizedPassword);
        setAuthStatus("bejelentkezve", true);
        return;
      }

      throw error;
    }
  };

  loginBtn.addEventListener("click", async () => {
    const username = authUsernameInput?.value || "";
    const password = authPasswordInput?.value || "";

    try {
      await loginWithCredentials(username, password);
    } catch (error) {
      console.error("Login error", error);
      setAuthStatusFromError(error, `hibás belépés (${String(username).trim() || "ismeretlen"})`);
    }
  });

  logoutBtn.addEventListener("click", async () => {
    if (isAuthBypassed) {
      isAuthBypassed = false;
      hasAuthError = false;
      setAuthStatus("kijelentkezve");
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

  setAuthStatus("nincs bejelentkezés");

  firebaseFns.onAuthStateChanged(auth, (user) => {
    if (isAuthBypassed) {
      setAuthStatus("bejelentkezve (auth nélkül)", true);
      return;
    }

    isAuthed = Boolean(user);
    if (isAuthed) {
      hasAuthError = false;
      setAuthStatus("bejelentkezve", true);
      const boardId = boardIdInput.value.trim() || boardFromStorage;
      if (boardId) {
        connectToBoard(boardId);
      }
      return;
    }

    if (!hasAuthError) {
      setAuthStatus("nincs bejelentkezés");
    }
    setConnectionStatus("helyi");
    disconnectRemote();
  });
};

init().catch((error) => {
  console.error("Init error", error);
  setStatus("Hiba történt");
});
