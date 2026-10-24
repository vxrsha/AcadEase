
/* ==========================================
   AcadEase — Application JavaScript
   Tasks + Timetable + Attendance + Focus
   Analytics + LocalStorage
   ========================================== */

"use strict";

/* ---------- Storage ---------- */

const STORAGE_KEYS = {
  tasks: "acadease_tasks",
  subjects: "acadease_subjects",
  profile: "acadease_profile",
  theme: "acadease_theme",
  timetable: "acadease_timetable",
  attendance: "acadease_attendance_records",
  studySessions: "acadease_study_sessions",
  studyGoal: "acadease_daily_study_goal"
};

function loadData(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (error) {
    console.error("Could not read storage:", key, error);
    return fallback;
  }
}

function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error("Could not save data:", key, error);
    showToast("Could not save. Check your browser storage.", true);
    return false;
  }
}

function makeId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 9)
  );
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat("en-IN", options).format(date);
}

function formatTime(time) {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return formatDate(date, { hour: "numeric", minute: "2-digit" });
}

function formatMinutes(minutes) {
  const value = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return hours ? `${hours}h ${mins}m` : `${mins} min`;
}

function getElement(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = getElement(id);
  if (element) element.textContent = value;
}

/* ---------- Application state ---------- */

let tasks = loadData(STORAGE_KEYS.tasks, []);
let subjects = loadData(STORAGE_KEYS.subjects, []);
let profile = loadData(STORAGE_KEYS.profile, {});
let timetable = loadData(STORAGE_KEYS.timetable, []);
let attendanceRecords = loadData(STORAGE_KEYS.attendance, {});
let studySessions = loadData(STORAGE_KEYS.studySessions, []);
let dailyStudyGoal = Number(loadData(STORAGE_KEYS.studyGoal, 120)) || 120;

let currentPage = "dashboard";
let attendanceMonth = new Date();
let selectedAttendanceDate = localDateKey();
let subjectStudyChart = null;
let weeklyStudyChart = null;

let timerMode = "focus";
let timerRunning = false;
let timerInterval = null;
let timerEndTimestamp = 0;
let timerRemainingSeconds = 25 * 60;
let timerStartedAt = 0;
let timerInitialSeconds = 25 * 60;
let focusSessionNumber = 1;

/* ---------- Normalize existing saved data ---------- */

// Preserve old attendance totals as historical baseline counts.
// New calendar records are counted separately, so old data is not lost.

subjects = subjects.map(subject => {
  const copy = { ...subject };

  if (!copy.id) copy.id = makeId();

  copy.name = String(copy.name || "Unnamed subject");

  if (!Number.isFinite(Number(copy.baselineAttended))) {
    copy.baselineAttended = Math.max(0, Number(copy.attended) || 0);
  }

  if (!Number.isFinite(Number(copy.baselineTotal))) {
    copy.baselineTotal = Math.max(
      Number(copy.baselineAttended) || 0,
      Number(copy.total) || 0
    );
  }

  copy.baselineAttended = Math.min(
    copy.baselineAttended,
    copy.baselineTotal
  );

  return copy;
});

tasks = Array.isArray(tasks) ? tasks : [];
subjects = Array.isArray(subjects) ? subjects : [];
timetable = Array.isArray(timetable) ? timetable : [];
studySessions = Array.isArray(studySessions) ? studySessions : [];

if (!attendanceRecords || Array.isArray(attendanceRecords)) {
  attendanceRecords = {};
}

// Write the normalized representation without removing existing data.
saveData(STORAGE_KEYS.subjects, subjects);
saveData(STORAGE_KEYS.attendance, attendanceRecords);

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PAGE_NAMES = {
  dashboard: "Dashboard",
  tasks: "My Tasks",
  attendance: "Attendance",
  timetable: "Timetable",
  planner: "Smart Planner",
  focus: "Focus Timer",
  analytics: "Study Analytics"
};

/* ---------- Toasts and modal helpers ---------- */

function showToast(message, isError = false) {
  const container = getElement("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => toast.remove(), 3500);
}

function openModal(id) {
  const modal = getElement(id);
  if (!modal) return;

  modal.classList.add("open");
  document.body.style.overflow = "hidden";

  const firstInput = modal.querySelector(
    "input:not([type=hidden]), select, textarea"
  );

  if (firstInput) {
    window.setTimeout(() => firstInput.focus(), 50);
  }
}

function closeModal(id) {
  const modal = getElement(id);
  if (!modal) return;

  modal.classList.remove("open");

  if (!document.querySelector(".modal-overlay.open")) {
    document.body.style.overflow = "";
  }
}

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    closeModal(button.dataset.close);
  });
});

document.querySelectorAll(".modal-overlay").forEach(modal => {
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal(modal.id);
  });
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    const openModals = document.querySelectorAll(".modal-overlay.open");
    openModals.forEach(modal => closeModal(modal.id));
  }
});

/* ---------- Navigation ---------- */

function navigateTo(page) {
  if (!PAGE_NAMES[page]) return;

  currentPage = page;

  document.querySelectorAll(".page").forEach(section => {
    section.classList.toggle("active", section.id === `${page}Page`);
  });

  document.querySelectorAll(".nav-item[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  setText("pageHeading", PAGE_NAMES[page]);

  const sidebar = getElement("sidebar");
  if (sidebar) sidebar.classList.remove("open");

  if (page === "attendance") {
    renderAttendanceCalendar();
    renderSelectedDayClasses();
    renderSubjects();
  }

  if (page === "timetable") renderTimetable();

  if (page === "focus") {
    updateTimerDisplay();
    renderRecentSessions();
    renderFocusStats();
    populateFocusSubjectOptions();
  }

  if (page === "analytics") renderAnalytics();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-item[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    navigateTo(button.dataset.page);
  });
});

document.querySelectorAll("[data-go]").forEach(button => {
  button.addEventListener("click", () => {
    navigateTo(button.dataset.go);
  });
});

const menuToggle = getElement("menuToggle");
if (menuToggle) {
  menuToggle.addEventListener("click", () => {
    getElement("sidebar")?.classList.toggle("open");
  });
}

/* ---------- Theme and profile ---------- */

function applyTheme(theme) {
  document.body.classList.toggle("dark-theme", theme === "dark");
  const icon = getElement("themeToggle")?.querySelector("i");

  if (icon) {
    icon.className = theme === "dark"
      ? "fa-solid fa-sun"
      : "fa-solid fa-moon";
  }
}

applyTheme(loadData(STORAGE_KEYS.theme, "light"));

getElement("themeToggle")?.addEventListener("click", () => {
  const newTheme = document.body.classList.contains("dark-theme")
    ? "light"
    : "dark";

  saveData(STORAGE_KEYS.theme, newTheme);
  applyTheme(newTheme);
  renderAnalytics();
});

function renderProfile() {
  const name = String(profile.name || "Student");
  const course = String(profile.course || "Your academic space");
  const initial = name.trim().charAt(0).toUpperCase() || "S";

  setText("profileName", name);
  setText("topProfileName", name);
  setText("profileCourse", course);
  setText("profileAvatar", initial);
  setText("topAvatar", initial);
  setText("welcomeMessage", `Let's make today productive, ${name}!`);

  if (getElement("studentName")) {
    getElement("studentName").value = profile.name || "";
  }

  if (getElement("studentCourse")) {
    getElement("studentCourse").value = profile.course || "";
  }
}

function openProfileModal() {
  renderProfile();
  openModal("profileModal");
}

getElement("profileSettingsBtn")?.addEventListener("click", openProfileModal);
getElement("topProfileBtn")?.addEventListener("click", openProfileModal);

getElement("profileForm")?.addEventListener("submit", event => {
  event.preventDefault();

  profile = {
    ...profile,
    name: getElement("studentName").value.trim(),
    course: getElement("studentCourse").value.trim()
  };

  saveData(STORAGE_KEYS.profile, profile);
  renderProfile();
  closeModal("profileModal");
  showToast("Profile saved!");
});

renderProfile();

/* ---------- Tasks ---------- */

function isTaskCompleted(task) {
  return task.completed === true || task.status === "completed";
}

function normalizeTask(task) {
  return {
    ...task,
    id: task.id || makeId(),
    title: String(task.title || "Untitled task"),
    subject: task.subject || "",
    category: task.category || "Assignment",
    dueDate: task.dueDate || "",
    priority: task.priority || "medium",
    description: task.description || "",
    completed: isTaskCompleted(task)
  };
}

tasks = tasks.map(normalizeTask);
saveData(STORAGE_KEYS.tasks, tasks);

function saveTasks() {
  saveData(STORAGE_KEYS.tasks, tasks);
  renderTasks();
  renderDashboard();
}

function openTaskModal(taskId = "") {
  const task = tasks.find(item => String(item.id) === String(taskId));

  getElement("taskForm").reset();
  setText("taskModalTitle", task ? "Edit task" : "Add a task");
  getElement("taskId").value = task?.id || "";
  getElement("taskTitle").value = task?.title || "";
  getElement("taskSubject").value = task?.subject || "";
  getElement("taskCategory").value = task?.category || "Assignment";
  getElement("taskDueDate").value = task?.dueDate || "";
  getElement("taskPriority").value = task?.priority || "medium";
  getElement("taskDescription").value = task?.description || "";

  openModal("taskModal");
}

getElement("addTaskBtn")?.addEventListener("click", () => openTaskModal());
getElement("welcomeAddTaskBtn")?.addEventListener("click", () => openTaskModal());

getElement("taskForm")?.addEventListener("submit", event => {
  event.preventDefault();

  const id = getElement("taskId").value;

  const data = {
    id: id || makeId(),
    title: getElement("taskTitle").value.trim(),
    subject: getElement("taskSubject").value.trim(),
    category: getElement("taskCategory").value,
    dueDate: getElement("taskDueDate").value,
    priority: getElement("taskPriority").value,
    description: getElement("taskDescription").value.trim(),
    completed: tasks.find(task => String(task.id) === String(id))
      ?.completed || false
  };

  if (!data.title) {
    showToast("Please enter a task title.", true);
    return;
  }

  if (id) {
    tasks = tasks.map(task => String(task.id) === String(id) ? data : task);
  } else {
    tasks.unshift(data);
  }

  closeModal("taskModal");
  saveTasks();
  showToast(id ? "Task updated!" : "Task added!");
});

function toggleTask(id) {
  tasks = tasks.map(task => {
    if (String(task.id) !== String(id)) return task;

    const completed = !isTaskCompleted(task);
    return { ...task, completed, status: completed ? "completed" : "pending" };
  });

  saveTasks();
}

function deleteTask(id) {
  if (!confirm("Delete this task?")) return;

  tasks = tasks.filter(task => String(task.id) !== String(id));
  saveTasks();
  showToast("Task deleted.");
}

function renderTaskRow(task) {
  const completed = isTaskCompleted(task);

  return `
    <div class="task-row ${completed ? "completed" : ""}">
      <input class="task-check" type="checkbox"
        aria-label="Mark ${escapeHTML(task.title)} complete"
        ${completed ? "checked" : ""}
        data-task-action="toggle" data-id="${escapeHTML(task.id)}">
      <div class="task-row-content">
        <div class="task-row-title">${escapeHTML(task.title)}</div>
        <div class="task-meta">
          ${task.subject ? `<span><i class="fa-solid fa-book"></i> ${escapeHTML(task.subject)}</span>` : ""}
          ${task.dueDate ? `<span><i class="fa-regular fa-calendar"></i> ${escapeHTML(task.dueDate)}</span>` : ""}
          <span>${escapeHTML(task.category)}</span>
          <span class="priority-badge priority-${escapeHTML(task.priority)}">${escapeHTML(task.priority.toUpperCase())}</span>
        </div>
      </div>
      <div class="task-row-actions">
        <button class="small-action" data-task-action="edit" data-id="${escapeHTML(task.id)}" aria-label="Edit task"><i class="fa-solid fa-pen"></i></button>
        <button class="small-action delete" data-task-action="delete" data-id="${escapeHTML(task.id)}" aria-label="Delete task"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
}

function renderTasks() {
  const query = (getElement("taskSearch")?.value || "").trim().toLowerCase();
  const statusFilter = getElement("taskFilter")?.value || "all";
  const priorityFilterValue = getElement("priorityFilter")?.value || "all";

  const filtered = tasks.filter(task => {
    const text = `${task.title} ${task.subject} ${task.description} ${task.category}`.toLowerCase();

    if (query && !text.includes(query)) return false;
    if (statusFilter === "completed" && !isTaskCompleted(task)) return false;
    if (statusFilter === "pending" && isTaskCompleted(task)) return false;
    if (priorityFilterValue !== "all" && task.priority !== priorityFilterValue) return false;

    return true;
  });

  const list = getElement("taskList");
  if (list) {
    list.innerHTML = filtered.length
      ? filtered.map(renderTaskRow).join("")
      : `<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>No matching tasks. Add a task to get started.</p></div>`;
  }

  const total = tasks.length;
  const completed = tasks.filter(isTaskCompleted).length;
  const pending = total - completed;
  const todayKey = localDateKey();

  const overdue = tasks.filter(task =>
    !isTaskCompleted(task) && task.dueDate && task.dueDate < todayKey
  ).length;

  setText("totalTasks", total);
  setText("pendingTasks", pending);
  setText("completedTasks", completed);
  setText("completionRate", `${total ? Math.round(completed / total * 100) : 0}% completion`);

  setText("taskPageTotal", total);
  setText("taskPagePending", pending);
  setText("taskPageCompleted", completed);
  setText("taskPageOverdue", overdue);
  setText("sidebarTaskCount", pending);
}

getElement("taskList")?.addEventListener("click", event => {
  const button = event.target.closest("[data-task-action]");
  if (!button) return;

  const { taskAction, id } = button.dataset;

  if (taskAction === "edit") openTaskModal(id);
  if (taskAction === "delete") deleteTask(id);
});

getElement("taskList")?.addEventListener("change", event => {
  const checkbox = event.target.closest('[data-task-action="toggle"]');
  if (checkbox) toggleTask(checkbox.dataset.id);
});

["taskSearch", "taskFilter", "priorityFilter"].forEach(id => {
  getElement(id)?.addEventListener(
    id === "taskSearch" ? "input" : "change",
    renderTasks
  );
});

/* ---------- Subjects and attendance model ---------- */

function getSubject(id) {
  return subjects.find(subject => String(subject.id) === String(id));
}

function getClassById(id) {
  return timetable.find(item => String(item.id) === String(id));
}

function getRecordKey(classId, dateKey) {
  return `${dateKey}__${classId}`;
}

function getRecord(classId, dateKey) {
  return attendanceRecords[getRecordKey(classId, dateKey)] || null;
}

function getSubjectRecords(subjectId) {
  return Object.values(attendanceRecords).filter(record =>
    String(record.subjectId) === String(subjectId)
  );
}

function getSubjectStats(subject) {
  const records = getSubjectRecords(subject.id);

  let present = 0;
  let absent = 0;
  let cancelled = 0;

  records.forEach(record => {
    if (record.status === "present") present++;
    else if (record.status === "absent") absent++;
    else if (record.status === "cancelled") cancelled++;
  });

  const baselineAttended = Number(subject.baselineAttended) || 0;
  const baselineTotal = Number(subject.baselineTotal) || 0;

  const attended = baselineAttended + present;
  const total = baselineTotal + present + absent;
  const percentage = total ? Math.round(attended / total * 100) : 0;

  return {
    attended,
    total,
    percentage,
    present,
    absent,
    cancelled,
    baselineAttended,
    baselineTotal
  };
}

function getOverallAttendance() {
  let attended = 0;
  let total = 0;

  subjects.forEach(subject => {
    const stats = getSubjectStats(subject);
    attended += stats.attended;
    total += stats.total;
  });

  return {
    attended,
    total,
    percentage: total ? Math.round(attended / total * 100) : 0
  };
}

function getClassesForDate(dateKey) {
  const date = dateFromKey(dateKey);
  const day = date.getDay();

  return timetable
    .filter(item => Number(item.day) === day)
    .filter(item => getSubject(item.subjectId))
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
}

function getClassesForSubjectOnDate(subjectId, dateKey) {
  return getClassesForDate(dateKey).filter(item =>
    String(item.subjectId) === String(subjectId)
  );
}

function getStatusLabel(status) {
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  if (status === "cancelled") return "Cancelled";
  return "Unmarked";
}

function getClassesNeeded(subject) {
  const stats = getSubjectStats(subject);

  if (stats.percentage >= 75) return 0;

  // Minimum consecutive attended classes needed to reach 75%.
  return Math.max(0, Math.ceil((0.75 * stats.total - stats.attended) / 0.25));
}

function saveSubjects() {
  saveData(STORAGE_KEYS.subjects, subjects);
}

function saveAttendanceRecords() {
  saveData(STORAGE_KEYS.attendance, attendanceRecords);
}

function populateSubjectSelects() {
  const selects = [
    getElement("timetableSubject"),
    getElement("focusSubject")
  ];

  selects.forEach(select => {
    if (!select) return;

    const previous = select.value;
    const isFocusSelect = select.id === "focusSubject";

    select.innerHTML = isFocusSelect
      ? '<option value="">General study</option>'
      : '<option value="">Choose a subject</option>';

    subjects.forEach(subject => {
      const option = document.createElement("option");
      option.value = subject.id;
      option.textContent = subject.name;
      select.appendChild(option);
    });

    if ([...select.options].some(option => option.value === previous)) {
      select.value = previous;
    }
  });
}

function openSubjectModal(subjectId = "") {
  const subject = getSubject(subjectId);

  getElement("subjectForm").reset();
  setText("subjectModalTitle", subject ? "Edit subject" : "Add subject");

  getElement("subjectId").value = subject?.id || "";
  getElement("subjectName").value = subject?.name || "";
  getElement("subjectAttended").value = subject?.baselineAttended ?? 0;
  getElement("subjectTotal").value = subject?.baselineTotal ?? 0;

  openModal("subjectModal");
}

getElement("addSubjectBtn")?.addEventListener("click", () => openSubjectModal());
getElement("manageTimetableSubjectsBtn")?.addEventListener("click", () => {
  navigateTo("attendance");
  openSubjectModal();
});

getElement("subjectForm")?.addEventListener("submit", event => {
  event.preventDefault();

  const id = getElement("subjectId").value;
  const name = getElement("subjectName").value.trim();
  const attended = Math.max(0, Number(getElement("subjectAttended").value) || 0);
  const total = Math.max(0, Number(getElement("subjectTotal").value) || 0);

  if (!name) return showToast("Enter a subject name.", true);
  if (attended > total) return showToast("Attended classes cannot exceed total classes.", true);

  const existing = getSubject(id);

  const subject = {
    ...(existing || {}),
    id: id || makeId(),
    name,
    baselineAttended: attended,
    baselineTotal: total
  };

  // Keep legacy fields aligned for compatibility with the earlier app.
  subject.attended = attended;
  subject.total = total;

  if (id) {
    subjects = subjects.map(item => String(item.id) === String(id) ? subject : item);
  } else {
    subjects.push(subject);
  }

  saveSubjects();
  populateSubjectSelects();
  closeModal("subjectModal");
  renderAll();

  showToast(id ? "Subject updated!" : "Subject added!");
});

function deleteSubject(id) {
  const subject = getSubject(id);
  if (!subject) return;

  if (!confirm(`Delete "${subject.name}" and its timetable classes?`)) return;

  const removedClassIds = timetable
    .filter(item => String(item.subjectId) === String(id))
    .map(item => String(item.id));

  subjects = subjects.filter(item => String(item.id) !== String(id));
  timetable = timetable.filter(item => String(item.subjectId) !== String(id));

  Object.keys(attendanceRecords).forEach(key => {
    const record = attendanceRecords[key];

    if (
      String(record.subjectId) === String(id) ||
      removedClassIds.includes(String(record.classId))
    ) {
      delete attendanceRecords[key];
    }
  });

  saveSubjects();
  saveData(STORAGE_KEYS.timetable, timetable);
  saveAttendanceRecords();
  populateSubjectSelects();
  renderAll();
  showToast("Subject and related timetable classes deleted.");
}

function renderSubjects() {
  const list = getElement("subjectList");
  if (!list) return;

  const overall = getOverallAttendance();
  setText("attendancePageOverall", `${overall.percentage}%`);
  setText("attendancePageMessage", overall.total ? `${overall.attended} of ${overall.total} classes attended` : "Record your first class");
  setText("subjectCount", subjects.length);
  setText("classesAttended", overall.attended);

  const lowCount = subjects.filter(subject => {
    const stats = getSubjectStats(subject);
    return stats.total > 0 && stats.percentage < 75;
  }).length;

  setText("lowAttendanceCount", lowCount);

  if (!subjects.length) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-book-open"></i>
        <h3>No subjects yet</h3>
        <p>Add your subjects first, then build your weekly timetable.</p>
        <button class="primary-btn" id="emptyAddSubjectBtn"><i class="fa-solid fa-plus"></i> Add subject</button>
      </div>`;
    return;
  }

  list.innerHTML = subjects.map(subject => {
    const stats = getSubjectStats(subject);
    const needed = getClassesNeeded(subject);
    const hasClasses = stats.total > 0;
    const isGood = stats.percentage >= 75;

    let message = "No classes recorded yet";
    if (hasClasses && isGood) message = "At or above 75% target";
    else if (hasClasses) message = `Attend ${needed} consecutive classes to reach 75%`;

    return `
      <div class="subject-card">
        <div class="subject-card-header">
          <div>
            <h4>${escapeHTML(subject.name)}</h4>
            <p>${stats.attended} attended out of ${stats.total} counted classes</p>
            <span class="subject-status ${isGood ? "good" : "low"}">${escapeHTML(message)}</span>
          </div>
          <strong class="subject-percent">${stats.percentage}%</strong>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${isGood ? "" : "low"}" style="width:${stats.percentage}%"></div>
        </div>
        <div class="subject-details">
          <span>Present: ${stats.present}</span>
          <span>Absent: ${stats.absent}</span>
          <span>Cancelled: ${stats.cancelled}</span>
        </div>
        <div class="subject-actions">
          <button class="secondary-btn" data-subject-action="edit" data-id="${escapeHTML(subject.id)}"><i class="fa-solid fa-pen"></i> Edit</button>
          <button class="delete-subject-btn" data-subject-action="delete" data-id="${escapeHTML(subject.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
        </div>
      </div>`;
  }).join("");
}

getElement("subjectList")?.addEventListener("click", event => {
  if (event.target.closest("#emptyAddSubjectBtn")) {
    openSubjectModal();
    return;
  }

  const button = event.target.closest("[data-subject-action]");
  if (!button) return;

  if (button.dataset.subjectAction === "edit") {
    openSubjectModal(button.dataset.id);
  } else if (button.dataset.subjectAction === "delete") {
    deleteSubject(button.dataset.id);
  }
});

/* ---------- Weekly timetable ---------- */

function saveTimetable() {
  saveData(STORAGE_KEYS.timetable, timetable);
}

function openTimetableModal(classId = "") {
  const item = timetable.find(entry => String(entry.id) === String(classId));

  if (!subjects.length) {
    showToast("Add a subject before creating a timetable class.", true);
    navigateTo("attendance");
    openSubjectModal();
    return;
  }

  populateSubjectSelects();
  getElement("timetableForm").reset();

  setText("timetableModalTitle", item ? "Edit timetable class" : "Add timetable class");
  getElement("timetableClassId").value = item?.id || "";
  getElement("timetableSubject").value = item?.subjectId || "";
  getElement("timetableDay").value = String(item?.day ?? 1);
  getElement("timetableStart").value = item?.startTime || "09:00";
  getElement("timetableEnd").value = item?.endTime || "10:00";
  getElement("timetableRoom").value = item?.room || "";
  getElement("timetableNote").value = item?.note || "";

  openModal("timetableModal");
}

getElement("addTimetableClassBtn")?.addEventListener("click", () => openTimetableModal());
getElement("emptyAddTimetableBtn")?.addEventListener("click", () => openTimetableModal());

getElement("timetableForm")?.addEventListener("submit", event => {
  event.preventDefault();

  const id = getElement("timetableClassId").value;
  const subjectId = getElement("timetableSubject").value;
  const day = Number(getElement("timetableDay").value);
  const startTime = getElement("timetableStart").value;
  const endTime = getElement("timetableEnd").value;

  if (!getSubject(subjectId)) {
    showToast("Choose a valid subject.", true);
    return;
  }

  if (!startTime || !endTime || endTime <= startTime) {
    showToast("End time must be later than start time.", true);
    return;
  }

  const duplicate = timetable.find(item =>
    String(item.id) !== String(id) &&
    Number(item.day) === day &&
    item.startTime < endTime &&
    item.endTime > startTime
  );

  if (duplicate) {
    const otherSubject = getSubject(duplicate.subjectId);
    const confirmOverlap = confirm(
      `This time overlaps with ${otherSubject?.name || "another class"}. Save anyway?`
    );

    if (!confirmOverlap) return;
  }

  const data = {
    id: id || makeId(),
    subjectId,
    day,
    startTime,
    endTime,
    room: getElement("timetableRoom").value.trim(),
    note: getElement("timetableNote").value.trim()
  };

  if (id) {
    timetable = timetable.map(item => String(item.id) === String(id) ? data : item);
  } else {
    timetable.push(data);
  }

  timetable.sort((a, b) =>
    Number(a.day) - Number(b.day) ||
    String(a.startTime).localeCompare(String(b.startTime))
  );

  saveTimetable();
  closeModal("timetableModal");
  renderAll();
  showToast(id ? "Timetable class updated!" : "Timetable class added!");
});

function deleteTimetableClass(id) {
  const item = getClassById(id);
  if (!item) return;

  if (!confirm("Delete this recurring timetable class? Existing attendance records for it will also be removed.")) return;

  timetable = timetable.filter(entry => String(entry.id) !== String(id));

  Object.keys(attendanceRecords).forEach(key => {
    if (String(attendanceRecords[key].classId) === String(id)) {
      delete attendanceRecords[key];
    }
  });

  saveTimetable();
  saveAttendanceRecords();
  renderAll();
  showToast("Timetable class deleted.");
}

function renderTimetable() {
  const container = getElement("weeklyTimetable");
  if (!container) return;

  if (!timetable.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-calendar-plus"></i>
        <h3>Your timetable starts here</h3>
        <p>Add your first class and assign its subject, day and time.</p>
        <button class="primary-btn" id="emptyAddTimetableBtn"><i class="fa-solid fa-plus"></i> Add your first class</button>
      </div>`;
    return;
  }

  container.innerHTML = DAY_NAMES.map((dayName, dayIndex) => {
    const dayClasses = timetable
      .filter(item => Number(item.day) === dayIndex)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    return `
      <div class="timetable-day">
        <div class="timetable-day-header">
          <strong>${dayName}</strong>
          <span>${dayClasses.length} class${dayClasses.length === 1 ? "" : "es"}</span>
        </div>
        ${dayClasses.length ? dayClasses.map(item => {
          const subject = getSubject(item.subjectId);

          return `
            <div class="timetable-class">
              <strong>${escapeHTML(subject?.name || "Unknown subject")}</strong>
              <time>${escapeHTML(formatTime(item.startTime))} – ${escapeHTML(formatTime(item.endTime))}</time>
              ${item.room ? `<small><i class="fa-solid fa-location-dot"></i> ${escapeHTML(item.room)}</small>` : ""}
              ${item.note ? `<small>${escapeHTML(item.note)}</small>` : ""}
              <div class="timetable-class-actions">
                <button data-timetable-action="edit" data-id="${escapeHTML(item.id)}" aria-label="Edit class"><i class="fa-solid fa-pen"></i></button>
                <button data-timetable-action="delete" data-id="${escapeHTML(item.id)}" aria-label="Delete class"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>`;
        }).join("") : `<div class="timetable-empty-day">No classes</div>`}
      </div>`;
  }).join("");
}

getElement("weeklyTimetable")?.addEventListener("click", event => {
  if (event.target.closest("#emptyAddTimetableBtn")) {
    openTimetableModal();
    return;
  }

  const button = event.target.closest("[data-timetable-action]");
  if (!button) return;

  if (button.dataset.timetableAction === "edit") {
    openTimetableModal(button.dataset.id);
  } else if (button.dataset.timetableAction === "delete") {
    deleteTimetableClass(button.dataset.id);
  }
});

/* ---------- Per-class attendance recording ---------- */

function openAttendanceRecordModal(classId, dateKey) {
  const item = getClassById(classId);
  const subject = item && getSubject(item.subjectId);

  if (!item || !subject) {
    showToast("This timetable class is no longer available.", true);
    return;
  }

  const date = dateFromKey(dateKey);
  const existing = getRecord(classId, dateKey);

  setText("classAttendanceTitle", subject.name);
  setText(
    "classAttendanceSubtitle",
    `${formatDate(date, { weekday: "long", day: "numeric", month: "long" })} · ${formatTime(item.startTime)}–${formatTime(item.endTime)}`
  );

  getElement("attendanceRecordClassId").value = classId;
  getElement("attendanceRecordDate").value = dateKey;

  document.querySelectorAll('input[name="classAttendanceStatus"]').forEach(radio => {
    radio.checked = radio.value === existing?.status;
  });

  openModal("classAttendanceModal");
}

getElement("classAttendanceForm")?.addEventListener("submit", event => {
  event.preventDefault();

  const classId = getElement("attendanceRecordClassId").value;
  const dateKey = getElement("attendanceRecordDate").value;
  const item = getClassById(classId);

  if (!item || !getSubject(item.subjectId)) {
    showToast("The class or subject no longer exists.", true);
    closeModal("classAttendanceModal");
    return;
  }

  const selected = document.querySelector('input[name="classAttendanceStatus"]:checked');

  if (!selected) {
    showToast("Choose an attendance status.", true);
    return;
  }

  const key = getRecordKey(classId, dateKey);

  attendanceRecords[key] = {
    classId,
    subjectId: item.subjectId,
    date: dateKey,
    status: selected.value,
    updatedAt: new Date().toISOString()
  };

  saveAttendanceRecords();
  closeModal("classAttendanceModal");
  renderAll();
  showToast(`Attendance saved: ${selected.value}.`);
});

function renderSelectedDayClasses() {
  const container = getElement("selectedDayClasses");
  if (!container) return;

  const date = dateFromKey(selectedAttendanceDate);
  setText("selectedAttendanceDate", formatDate(date, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }));

  const classes = getClassesForDate(selectedAttendanceDate);

  if (!classes.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-calendar-day"></i>
        <p>No classes are scheduled for this day.</p>
      </div>`;
    return;
  }

  container.innerHTML = classes.map(item => {
    const subject = getSubject(item.subjectId);
    const record = getRecord(item.id, selectedAttendanceDate);
    const status = record?.status || "unmarked";

    return `
      <div class="class-attendance-row">
        <div class="class-time">${escapeHTML(formatTime(item.startTime))}<br>${escapeHTML(formatTime(item.endTime))}</div>
        <div class="class-attendance-info">
          <strong>${escapeHTML(subject?.name || "Unknown subject")}</strong>
          <small>${item.room ? escapeHTML(item.room) + " · " : ""}${escapeHTML(item.note || "Scheduled class")}</small>
        </div>
        <span class="class-status-pill ${status}">${escapeHTML(getStatusLabel(status))}</span>
        <button class="class-record-btn" data-attendance-action="record" data-id="${escapeHTML(item.id)}" data-date="${escapeHTML(selectedAttendanceDate)}">
          ${record ? "Update" : "Mark"}
        </button>
      </div>`;
  }).join("");
}

getElement("selectedDayClasses")?.addEventListener("click", event => {
  const button = event.target.closest('[data-attendance-action="record"]');
  if (!button) return;

  openAttendanceRecordModal(button.dataset.id, button.dataset.date);
});

/* ---------- Monthly attendance calendar ---------- */

function getDaySummary(dateKey) {
  const classes = getClassesForDate(dateKey);
  let present = 0;
  let absent = 0;
  let cancelled = 0;
  let unmarked = 0;

  classes.forEach(item => {
    const status = getRecord(item.id, dateKey)?.status;

    if (status === "present") present++;
    else if (status === "absent") absent++;
    else if (status === "cancelled") cancelled++;
    else unmarked++;
  });

  return { classes, present, absent, cancelled, unmarked };
}

function renderAttendanceCalendar() {
  const calendar = getElement("attendanceCalendar");
  if (!calendar) return;

  setText("attendanceCalendarTitle", formatDate(attendanceMonth, {
    month: "long",
    year: "numeric"
  }));

  const year = attendanceMonth.getFullYear();
  const month = attendanceMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = localDateKey();

  let html = SHORT_DAYS.map(day =>
    `<div class="calendar-weekday">${day}</div>`
  ).join("");

  for (let i = 0; i < firstDay; i++) {
    html += `<div class="calendar-day empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateKey = localDateKey(date);
    const summary = getDaySummary(dateKey);

    const dots = [
      ...Array(Math.min(summary.present, 4)).fill("present"),
      ...Array(Math.min(summary.absent, 4)).fill("absent"),
      ...Array(Math.min(summary.cancelled, 4)).fill("cancelled")
    ].slice(0, 8);

    if (!dots.length && summary.unmarked) dots.push("unmarked");

    const isToday = dateKey === todayKey;
    const isSelected = dateKey === selectedAttendanceDate;

    html += `
      <button class="calendar-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}"
        data-calendar-date="${dateKey}" aria-label="${escapeHTML(formatDate(date, { day: "numeric", month: "long", year: "numeric" }))}, ${summary.classes.length} scheduled classes">
        <span class="day-number">${day}</span>
        <span class="day-dots">${dots.map(status => `<i class="legend-dot ${status}"></i>`).join("")}</span>
        <span class="day-class-count">${summary.classes.length ? `${summary.classes.length} class${summary.classes.length === 1 ? "" : "es"}` : "—"}</span>
      </button>`;
  }

  calendar.innerHTML = html;
}

getElement("attendanceCalendar")?.addEventListener("click", event => {
  const button = event.target.closest("[data-calendar-date]");
  if (!button) return;

  selectedAttendanceDate = button.dataset.calendarDate;
  renderAttendanceCalendar();
  renderSelectedDayClasses();
});

function shiftAttendanceMonth(amount) {
  attendanceMonth = new Date(
    attendanceMonth.getFullYear(),
    attendanceMonth.getMonth() + amount,
    1
  );
  renderAttendanceCalendar();
}

getElement("attendancePrevMonth")?.addEventListener("click", () => shiftAttendanceMonth(-1));
getElement("attendanceNextMonth")?.addEventListener("click", () => shiftAttendanceMonth(1));

getElement("attendanceTodayBtn")?.addEventListener("click", () => {
  attendanceMonth = new Date();
  selectedAttendanceDate = localDateKey();
  renderAttendanceCalendar();
  renderSelectedDayClasses();
});

/* ---------- Today's classes and dashboard ---------- */

function renderTodayClasses() {
  const container = getElement("todayClassesPreview");
  if (!container) return;

  const todayKey = localDateKey();
  const classes = getClassesForDate(todayKey);

  if (!classes.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-calendar-plus"></i>
        <p>No classes scheduled today. Add or update your weekly timetable.</p>
      </div>`;
    return;
  }

  container.innerHTML = classes.map(item => {
    const subject = getSubject(item.subjectId);
    const status = getRecord(item.id, todayKey)?.status || "unmarked";

    return `
      <div class="class-attendance-row">
        <div class="class-time">${escapeHTML(formatTime(item.startTime))}</div>
        <div class="class-attendance-info">
          <strong>${escapeHTML(subject?.name || "Unknown subject")}</strong>
          <small>${escapeHTML(formatTime(item.endTime))}${item.room ? " · " + escapeHTML(item.room) : ""}</small>
        </div>
        <span class="class-status-pill ${status}">${escapeHTML(getStatusLabel(status))}</span>
      </div>`;
  }).join("");
}

function getStudyMinutesForDate(dateKey) {
  return studySessions
    .filter(session => session.date === dateKey)
    .reduce((sum, session) => sum + (Number(session.minutes) || 0), 0);
}

function renderDashboard() {
  const overall = getOverallAttendance();
  setText("overallAttendance", `${overall.percentage}%`);
  setText(
    "attendanceStatus",
    overall.total
      ? `${overall.attended}/${overall.total} classes attended`
      : "Add your subjects"
  );

  renderTodayClasses();

  const todayMinutes = getStudyMinutesForDate(localDateKey());
  const goalPercent = dailyStudyGoal
    ? Math.min(100, Math.round(todayMinutes / dailyStudyGoal * 100))
    : 0;

  setText("dashboardStudyTime", formatMinutes(todayMinutes));
  setText("dashboardStudyGoalText", `${goalPercent}% of your daily study goal`);
  if (getElement("dashboardStudyProgress")) {
    getElement("dashboardStudyProgress").style.width = `${goalPercent}%`;
  }

  const dashboardTasks = getElement("dashboardTaskList");
  if (dashboardTasks) {
    const upcoming = tasks
      .filter(task => !isTaskCompleted(task))
      .sort((a, b) => {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      })
      .slice(0, 5);

    dashboardTasks.innerHTML = upcoming.length
      ? upcoming.map(renderTaskRow).join("")
      : `<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>You're all caught up. Add a task whenever you need to.</p></div>`;
  }

  const dashboardAttendance = getElement("dashboardAttendanceList");
  if (dashboardAttendance) {
    dashboardAttendance.innerHTML = subjects.length
      ? subjects.slice(0, 5).map(subject => {
          const stats = getSubjectStats(subject);

          return `
            <div class="attendance-item">
              <div class="attendance-item-top">
                <span class="attendance-item-name">${escapeHTML(subject.name)}</span>
                <span class="attendance-percent">${stats.percentage}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill ${stats.percentage < 75 ? "low" : ""}" style="width:${stats.percentage}%"></div>
              </div>
              <div class="attendance-item-bottom">
                <span>${stats.attended}/${stats.total} classes</span>
                <span>${stats.percentage >= 75 ? "On track" : "Below 75%"}</span>
              </div>
            </div>`;
        }).join("")
      : `<div class="empty-state"><i class="fa-solid fa-book"></i><p>Add subjects to track attendance.</p></div>`;
  }

  renderSuggestions();
}

function renderSuggestions() {
  const suggestions = [];

  const pending = tasks.filter(task => !isTaskCompleted(task));
  const overdue = pending.filter(task => task.dueDate && task.dueDate < localDateKey());
  const lowSubjects = subjects.filter(subject => {
    const stats = getSubjectStats(subject);
    return stats.total > 0 && stats.percentage < 75;
  });

  if (!subjects.length) {
    suggestions.push({
      icon: "fa-book",
      title: "Add your subjects",
      body: "Create your subjects before building a timetable."
    });
  }

  if (!timetable.length && subjects.length) {
    suggestions.push({
      icon: "fa-calendar-days",
      title: "Build your timetable",
      body: "Add your recurring weekly classes to generate your attendance calendar."
    });
  }

  if (overdue.length) {
    suggestions.push({
      icon: "fa-clock",
      title: "Review overdue tasks",
      body: `You have ${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}.`
    });
  }

  if (lowSubjects.length) {
    suggestions.push({
      icon: "fa-triangle-exclamation",
      title: "Watch your attendance",
      body: `${lowSubjects.map(subject => subject.name).slice(0, 2).join(", ")} ${lowSubjects.length === 1 ? "is" : "are"} below 75%.`
    });
  }

  if (getStudyMinutesForDate(localDateKey()) < dailyStudyGoal) {
    suggestions.push({
      icon: "fa-stopwatch",
      title: "Start a focus session",
      body: "A short, distraction-free session can help you move toward today's study goal."
    });
  }

  if (!suggestions.length) {
    suggestions.push({
      icon: "fa-star",
      title: "Keep the momentum",
      body: "Your workspace is set up. Keep recording attendance and study sessions consistently."
    });
  }

  const markup = suggestions.map(item => `
    <div class="suggestion-card">
      <i class="fa-solid ${item.icon}"></i>
      <div><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.body)}</p></div>
    </div>`).join("");

  if (getElement("smartSuggestions")) {
    getElement("smartSuggestions").innerHTML = markup;
  }

  if (getElement("plannerSuggestions")) {
    getElement("plannerSuggestions").innerHTML = markup;
  }
}

/* ---------- Focus timer / Pomodoro ---------- */

function getTimerDuration(mode) {
  const ids = {
    focus: "focusDuration",
    shortBreak: "shortBreakDuration",
    longBreak: "longBreakDuration"
  };

  const fallback = {
    focus: 25,
    shortBreak: 5,
    longBreak: 15
  };

  const value = Number(getElement(ids[mode])?.value);
  return Math.max(1, Math.min(180, value || fallback[mode])) * 60;
}

function setTimerMode(mode) {
  if (!["focus", "shortBreak", "longBreak"].includes(mode)) return;

  if (timerRunning) {
    pauseTimer();
  }

  timerMode = mode;
  timerRemainingSeconds = getTimerDuration(mode);
  timerInitialSeconds = timerRemainingSeconds;

  document.querySelectorAll("[data-focus-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.focusMode === mode);
  });

  updateTimerDisplay();
}

document.querySelectorAll("[data-focus-mode]").forEach(button => {
  button.addEventListener("click", () => setTimerMode(button.dataset.focusMode));
});

function updateTimerDisplay() {
  const seconds = Math.max(0, Math.ceil(timerRemainingSeconds));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  setText("timerDisplay", `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`);

  const labels = {
    focus: "TIME TO FOCUS",
    shortBreak: "SHORT BREAK",
    longBreak: "LONG BREAK"
  };

  setText("timerModeLabel", labels[timerMode]);
  setText("timerSessionLabel", `Session ${focusSessionNumber}`);

  const progress = timerInitialSeconds
    ? Math.min(100, Math.max(0, ((timerInitialSeconds - seconds) / timerInitialSeconds) * 100))
    : 0;

  const ring = getElement("timerRing");
  if (ring) ring.style.setProperty("--timer-progress", `${progress}%`);

  const startButton = getElement("timerStartBtn");
  if (startButton) {
    if (timerRunning) {
      startButton.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
    } else {
      startButton.innerHTML = '<i class="fa-solid fa-play"></i> ' +
        (seconds < timerInitialSeconds ? "Resume" : timerMode === "focus" ? "Start focus" : "Start break");
    }
  }
}

function startTimer() {
  if (timerRunning) {
    pauseTimer();
    return;
  }

  if (timerRemainingSeconds <= 0) {
    timerRemainingSeconds = getTimerDuration(timerMode);
    timerInitialSeconds = timerRemainingSeconds;
  }

  timerRunning = true;
  timerStartedAt = Date.now();
  timerEndTimestamp = timerStartedAt + timerRemainingSeconds * 1000;

  timerInterval = window.setInterval(tickTimer, 250);
  updateTimerDisplay();
}

function tickTimer() {
  if (!timerRunning) return;

  timerRemainingSeconds = Math.max(
    0,
    (timerEndTimestamp - Date.now()) / 1000
  );

  updateTimerDisplay();

  if (timerRemainingSeconds <= 0) {
    completeTimer();
  }
}

function pauseTimer() {
  if (!timerRunning) return;

  timerRemainingSeconds = Math.max(
    0,
    (timerEndTimestamp - Date.now()) / 1000
  );

  timerRunning = false;
  window.clearInterval(timerInterval);
  timerInterval = null;
  updateTimerDisplay();
}

function resetTimer() {
  pauseTimer();
  timerRemainingSeconds = getTimerDuration(timerMode);
  timerInitialSeconds = timerRemainingSeconds;
  updateTimerDisplay();
}

function completeTimer() {
  if (!timerRunning) return;

  timerRunning = false;
  window.clearInterval(timerInterval);
  timerInterval = null;
  timerRemainingSeconds = 0;

  if (timerMode === "focus") {
    recordCompletedFocusSession();
    focusSessionNumber++;
    showToast("Focus session completed! Great work.");
    notifyTimerFinished("Focus session complete", "Take a short break if you need one.");
  } else {
    showToast("Break completed. Ready for another session?");
    notifyTimerFinished("Break complete", "You're ready to focus again.");
  }

  updateTimerDisplay();
  renderAll();

  // Automatically switch to the appropriate break after a focus session.
  if (timerMode === "focus") {
    setTimerMode(focusSessionNumber % 4 === 1 ? "longBreak" : "shortBreak");
  }
}

function notifyTimerFinished(title, body) {
  // Browser notifications are optional and require permission.
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch (error) {
      console.info("Notification unavailable.");
    }
  }
}

getElement("timerStartBtn")?.addEventListener("click", startTimer);
getElement("timerResetBtn")?.addEventListener("click", resetTimer);

["focusDuration", "shortBreakDuration", "longBreakDuration"].forEach(id => {
  getElement(id)?.addEventListener("change", () => {
    if (!timerRunning) {
      timerRemainingSeconds = getTimerDuration(timerMode);
      timerInitialSeconds = timerRemainingSeconds;
      updateTimerDisplay();
    }
  });
});

function recordCompletedFocusSession() {
  const subjectId = getElement("focusSubject")?.value || "";
  const subject = getSubject(subjectId);
  const minutes = Math.max(1, Math.round(timerInitialSeconds / 60));

  studySessions.unshift({
    id: makeId(),
    date: localDateKey(),
    startedAt: new Date(timerEndTimestamp - timerInitialSeconds * 1000).toISOString(),
    completedAt: new Date().toISOString(),
    subjectId: subject?.id || "",
    subjectName: subject?.name || "General study",
    note: getElement("focusSessionNote")?.value.trim() || "",
    minutes
  });

  saveData(STORAGE_KEYS.studySessions, studySessions);
}

function populateFocusSubjectOptions() {
  populateSubjectSelects();
}

function renderRecentSessions() {
  const container = getElement("recentStudySessions");
  if (!container) return;

  if (!studySessions.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-stopwatch"></i>
        <p>Your completed focus sessions will appear here.</p>
      </div>`;
    return;
  }

  container.innerHTML = studySessions.slice(0, 8).map(session => `
    <div class="study-session-row">
      <div class="study-session-icon"><i class="fa-solid fa-book-open"></i></div>
      <div class="study-session-info">
        <strong>${escapeHTML(session.subjectName || "General study")}</strong>
        <small>${escapeHTML(session.note || "Focus session")} · ${escapeHTML(session.date || "")}</small>
      </div>
      <span class="study-session-duration">${formatMinutes(session.minutes)}</span>
    </div>`).join("");
}

function getStudyStreak() {
  const studiedDates = new Set(
    studySessions
      .filter(session => Number(session.minutes) > 0)
      .map(session => session.date)
  );

  let streak = 0;
  const cursor = new Date();
  const today = localDateKey();

  // If today has no session yet, allow a streak from yesterday.
  if (!studiedDates.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (studiedDates.has(localDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function renderFocusStats() {
  const today = localDateKey();
  const todaySessions = studySessions.filter(session => session.date === today);

  setText("focusTodayTime", formatMinutes(getStudyMinutesForDate(today)));
  setText("focusTodaySessions", todaySessions.length);
  setText("focusStreak", `${getStudyStreak()} days`);
}

/* ---------- Study analytics ---------- */

getElement("studyGoalForm")?.addEventListener("submit", event => {
  event.preventDefault();

  const goal = Number(getElement("dailyStudyGoal").value);

  if (!Number.isFinite(goal) || goal < 15 || goal > 1440) {
    showToast("Choose a daily goal between 15 and 1440 minutes.", true);
    return;
  }

  dailyStudyGoal = goal;
  saveData(STORAGE_KEYS.studyGoal, dailyStudyGoal);
  renderAll();
  showToast("Daily study goal saved!");
});

function getStudyMinutesBySubject() {
  const totals = new Map();

  studySessions.forEach(session => {
    const name = session.subjectName || "General study";
    totals.set(name, (totals.get(name) || 0) + (Number(session.minutes) || 0));
  });

  return [...totals.entries()]
    .map(([name, minutes]) => ({ name, minutes }))
    .filter(item => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

function getLastSevenDays() {
  const days = [];

  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);

    const key = localDateKey(date);

    days.push({
      key,
      label: formatDate(date, { weekday: "short" }),
      minutes: getStudyMinutesForDate(key)
    });
  }

  return days;
}

function renderStudyCharts() {
  const pieCanvas = getElement("subjectStudyChart");
  const barCanvas = getElement("weeklyStudyChart");

  if (typeof Chart === "undefined") {
    setText("subjectChartEmpty", "Charts need an internet connection to load Chart.js.");
    setText("weeklyChartEmpty", "Charts need an internet connection to load Chart.js.");
    return;
  }

  const isDark = document.body.classList.contains("dark-theme");
  const labelColor = isDark ? "#c0bfd3" : "#77788e";
  const gridColor = isDark ? "#39394d" : "#e9eaf2";

  const subjectData = getStudyMinutesBySubject();
  const pieEmpty = getElement("subjectChartEmpty");

  if (pieEmpty) pieEmpty.style.display = subjectData.length ? "none" : "block";

  if (pieCanvas) {
    if (subjectStudyChart) subjectStudyChart.destroy();

    subjectStudyChart = new Chart(pieCanvas, {
      type: "pie",
      data: {
        labels: subjectData.map(item => item.name),
        datasets: [{
          data: subjectData.map(item => item.minutes),
          backgroundColor: [
            "#7567ec", "#27b58a", "#f1a44e", "#4b91e8",
            "#e56c86", "#9a70d5", "#49b8c4", "#b2b34f"
          ],
          borderColor: isDark ? "#1e1e2d" : "#ffffff",
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: labelColor,
              boxWidth: 10,
              padding: 14,
              font: { size: 10, family: "Inter" }
            }
          },
          tooltip: {
            callbacks: {
              label(context) {
                return `${context.label}: ${formatMinutes(context.raw)}`;
              }
            }
          }
        }
      }
    });
  }

  const weekData = getLastSevenDays();
  const weeklyEmpty = getElement("weeklyChartEmpty");

  if (weeklyEmpty) {
    weeklyEmpty.style.display = weekData.some(day => day.minutes > 0) ? "none" : "block";
  }

  if (barCanvas) {
    if (weeklyStudyChart) weeklyStudyChart.destroy();

    weeklyStudyChart = new Chart(barCanvas, {
      type: "bar",
      data: {
        labels: weekData.map(day => day.label),
        datasets: [{
          label: "Study minutes",
          data: weekData.map(day => day.minutes),
          backgroundColor: "#7567ec",
          hoverBackgroundColor: "#5143cf",
          borderRadius: 7,
          maxBarThickness: 35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: labelColor, font: { size: 10, family: "Inter" } },
            grid: { display: false },
            border: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: labelColor,
              precision: 0,
              font: { size: 9, family: "Inter" }
            },
            grid: { color: gridColor },
            border: { display: false }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return ` ${formatMinutes(context.raw)}`;
              }
            }
          }
        }
      }
    });
  }
}

function renderStudyConsistency() {
  const container = getElement("studyConsistencyCalendar");
  if (!container) return;

  const days = getLastSevenDays();

  container.innerHTML = days.map(day => `
    <div class="consistency-day ${day.minutes > 0 ? "studied" : ""}">
      <span>${escapeHTML(day.label)}</span>
      <strong>${day.minutes > 0 ? '<i class="fa-solid fa-check"></i>' : "—"}</strong>
      <small>${formatMinutes(day.minutes)}</small>
    </div>`).join("");
}

function renderAnalytics() {
  const today = localDateKey();
  const totalMinutes = studySessions.reduce(
    (sum, session) => sum + (Number(session.minutes) || 0), 0
  );

  const todayMinutes = getStudyMinutesForDate(today);
  const todayPercent = dailyStudyGoal
    ? Math.min(100, Math.round(todayMinutes / dailyStudyGoal * 100))
    : 0;

  setText("totalStudyTime", formatMinutes(totalMinutes));
  setText("analyticsTodayTime", formatMinutes(todayMinutes));
  setText("analyticsStreak", `${getStudyStreak()} days`);
  setText("totalStudySessions", studySessions.length);

  if (getElement("dailyStudyGoal")) {
    getElement("dailyStudyGoal").value = dailyStudyGoal;
  }

  setText("goalProgressLabel", `${todayMinutes} / ${dailyStudyGoal} minutes`);
  setText("goalProgressPercent", `${todayPercent}%`);

  if (getElement("goalProgressBar")) {
    getElement("goalProgressBar").style.width = `${todayPercent}%`;
  }

  renderStudyCharts();
  renderStudyConsistency();
}

/* ---------- Smart planner ---------- */

function renderPlanner() {
  renderSuggestions();
}

/* ---------- Global rendering ---------- */

function renderAll() {
  renderProfile();
  renderTasks();
  renderSubjects();
  renderTimetable();
  renderAttendanceCalendar();
  renderSelectedDayClasses();
  renderDashboard();
  renderRecentSessions();
  renderFocusStats();
  renderAnalytics();
  renderPlanner();
}

/* ---------- Initial setup ---------- */

function initializeApp() {
  const now = new Date();

  setText("todayDate", formatDate(now, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).toUpperCase());

  if (!selectedAttendanceDate) {
    selectedAttendanceDate = localDateKey();
  }

  attendanceMonth = new Date(
    dateFromKey(selectedAttendanceDate).getFullYear(),
    dateFromKey(selectedAttendanceDate).getMonth(),
    1
  );

  populateSubjectSelects();

  // Restore the timer to its initial focus duration on page load.
  timerMode = "focus";
  timerRemainingSeconds = getTimerDuration("focus");
  timerInitialSeconds = timerRemainingSeconds;
  updateTimerDisplay();

  renderAll();
  navigateTo("dashboard");
}

initializeApp();
