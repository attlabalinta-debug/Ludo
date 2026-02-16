const STORAGE_KEY = "weekly-organizer-v1";

const table = document.getElementById("scheduleTable");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");
const statusLabel = document.getElementById("status");
const boardIdInput = document.getElementById("boardId");
const connectBtn = document.getElementById("connectBtn");
const connectionStatus = document.getElementById("connectionStatus");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const passengerFields = ["passenger_1", "passenger_2", "passenger_3", "passenger_4", "passenger_5"];

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

const setAuthStatus = (text) => {
  authStatus.textContent = `Állapot: ${text}`;
  authStatus.style.color = "#b45309";
};

const setConnectionStatus = (text) => {
  connectionStatus.textContent = `Kapcsolat: ${text}`;
  connectionStatus.style.color = "#b45309";
};

const disableRemoteControls = () => {
  loginBtn.disabled = true;
  logoutBtn.disabled = true;
  connectBtn.disabled = true;
  authEmail.disabled = true;
  authPassword.disabled = true;
  boardIdInput.disabled = true;

  setAuthStatus("helyi mód");
  setConnectionStatus("helyi");
};

const init = () => {
  disableRemoteControls();

  const saved = loadData();
  fillInputs(saved);

  const handleTableEdit = () => {
    const current = readInputs();
    updateTotalsFromInputs();
    saveData(current);
    setStatus(`Mentés: ${new Date().toLocaleTimeString("hu-HU")}`);
  };

  table.addEventListener("input", handleTableEdit);
  table.addEventListener("change", handleTableEdit);

  resetBtn.addEventListener("click", () => {
    const cleared = cloneData(defaultData);
    fillInputs(cleared);
    saveData(cleared);
    setStatus("Mentés: minden törölve");
  });

  exportBtn.addEventListener("click", exportToCsv);
};

init();
