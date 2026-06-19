// ==========================================
// 1. GLOBAL STATE & CONFIGURATION
// ==========================================
const SPREADSHEET_API_URL = "https://script.google.com/macros/s/AKfycbyxGGP_Tx8tKV3t85YElCXdV0MGT3HKJErRhKCjvPvew-QZm7NGRbAUYgWd-RzsXTPmfQ/exec";

let state = {
    tasks: [],
    activeTab: 'current',
    currentlyEditingTaskId: null,
    nextTaskTargetDueDate: null,
    currentCalendarWeekAnchor: new Date(), 
    currentCalendarMonthAnchor: new Date(),
    activeTimelineDatePicker: null 
};

let localDraggedTaskId = null;

// ==========================================
// 2. UNIFIED INITIALIZATION LIFECYCLE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Instantly pull from local machine so everything is responsive right away
    loadLocalFallbackData();
    
    // 2. Bind all interface tools and layout tracking listeners
    setupEventListeners();
    setupCalendarResizer(); 
    initCelebrationCanvas();
    initTimelineWatchdogEngine();
    initSafeMobileEngine();
    
    // 3. Initial layout draw pass
    render();

    // 4. Fire off cloud request safely in the background
    syncWithCloudSpreadsheet();
});

// ==========================================
// 3. SECURE BACKGROUND CLOUD DATA LAYER
// ==========================================
function loadLocalFallbackData() {
    const data = localStorage.getItem('focusFlowData');
    if (data) {
        try {
            let parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                state.tasks = sanitizeTaskSchema(parsed);
                [...new Set(state.tasks.map(x => x.dueDate))].forEach(d => normalizeDayOrders(d));
            } else {
                generateDefaultSeedTasks();
            }
        } catch (e) {
            generateDefaultSeedTasks();
        }
    } else {
        generateDefaultSeedTasks();
    }
}

function sanitizeTaskSchema(rawTasks) {
    return rawTasks.map(t => {
        if (!t.id) t.id = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        if (!t.dueDate) t.dueDate = getTodayDateString();
        if (t.dayOrder === undefined) t.dayOrder = 0;
        
        // Ensure accurate boolean status checks out of spreadsheet texts
        t.completed = String(t.completed).toLowerCase() === 'true';
        t.slotExecutionTriggered = String(t.slotExecutionTriggered).toLowerCase() === 'true';
        
        if (!Array.isArray(t.subTasks)) {
            try {
                t.subTasks = typeof t.subTasks === 'string' ? JSON.parse(t.subTasks) : [];
            } catch(e) {
                t.subTasks = [];
            }
        }
        if (!t.notes) t.notes = "";
        if (!t.scheduledTimeSlot) t.scheduledTimeSlot = null;
        return t;
    });
}

async function syncWithCloudSpreadsheet() {
    if (!SPREADSHEET_API_URL || SPREADSHEET_API_URL.includes("https://script.google.com/macros/s/AKfycbyxGGP_Tx8tKV3t85YElCXdV0MGT3HKJErRhKCjvPvew-QZm7NGRbAUYgWd-RzsXTPmfQ/exec")) return;
    
    try {
        const response = await fetch(SPREADSHEET_API_URL);
        const parsed = await response.json();
        
        if (Array.isArray(parsed) && parsed.length > 0) {
            state.tasks = sanitizeTaskSchema(parsed);
            [...new Set(state.tasks.map(x => x.dueDate))].forEach(d => normalizeDayOrders(d));
            localStorage.setItem('focusFlowData', JSON.stringify(state.tasks));
            render();
            console.log("Cloud sync successful. Spreadsheet matches application matrix.");
        }
    } catch (err) {
        console.warn("Cloud connection sleeping. Continuing utilizing baseline machine cache.");
    }
}

function saveToLocalStorage() {
    // Always store locally instantly so buttons respond instantly
    localStorage.setItem('focusFlowData', JSON.stringify(state.tasks));

    // Ship data to the cloud spreadsheet quietly in the background
    pushToCloudSpreadsheet();
}

async function pushToCloudSpreadsheet() {
    if (!SPREADSHEET_API_URL || SPREADSHEET_API_URL.includes("https://script.google.com/macros/s/AKfycbyxGGP_Tx8tKV3t85YElCXdV0MGT3HKJErRhKCjvPvew-QZm7NGRbAUYgWd-RzsXTPmfQ/exec")) return;
    
    try {
        const payloadBlob = JSON.stringify(state.tasks);
        await fetch(SPREADSHEET_API_URL, {
            method: 'POST',
            mode: 'no-cors', 
            body: JSON.stringify(state.tasks)
        });
        console.log("Cloud sync stream uploaded securely.");
    } catch (e) {
        console.error("Cloud push failed. Task queued locally until next change: ", e);
    }
}

function generateDefaultSeedTasks() {
    state.tasks = [{
        id: 'seed-1', title: 'Welcome to your FocusFlow board!', term: 'short', priority: 'high',
        dateCreated: getTodayDateString(), dueDate: getTodayDateString(), completed: false,
        dayOrder: 0, subTasks: [], notes: "Write down notes inside this context panel.",
        scheduledTimeSlot: null, slotExecutionTriggered: false
    }];
    localStorage.setItem('focusFlowData', JSON.stringify(state.tasks));
}

function getTodayDateString() {
    const d = new Date();
    return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
}

function resetCreationFormContext() {
    state.nextTaskTargetDueDate = null;
    const inp = document.getElementById('task-date');
    if (inp) inp.value = getTodayDateString();
}

function getSortedTasksForDate(dateStr) {
    return state.tasks
        .filter(t => t.dueDate === dateStr && !t.completed)
        .sort((a, b) => (a.dayOrder || 0) - (b.dayOrder || 0));
}

function normalizeDayOrders(dateStr) {
    state.tasks.filter(t => t.dueDate === dateStr && !t.completed)
               .sort((a,b) => (a.dayOrder || 0) - (b.dayOrder || 0))
               .forEach((t, i) => { t.dayOrder = i; });
}

// ==========================================
// 4. RUNNING FOOTER DRAWER RESIZER
// ==========================================
function setupCalendarResizer() {
    const resizer = document.getElementById('calendar-resizer');
    const footer = document.getElementById('calendar-footer');
    if (!resizer || !footer) return;

    const savedHeight = localStorage.getItem('focusFlowCalendarHeight');
    if (savedHeight) document.documentElement.style.setProperty('--calendar-height', savedHeight + 'px');

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.body.classList.add('calendar-dragging');
        const startY = e.clientY;
        const startHeight = footer.offsetHeight;

        function onMouseMove(moveEvent) {
            let h = startHeight + (startY - moveEvent.clientY);
            h = Math.max(120, Math.min(450, h));
            document.documentElement.style.setProperty('--calendar-height', h + 'px');
            localStorage.setItem('focusFlowCalendarHeight', h);
        }
        function onMouseUp() {
            document.body.classList.remove('calendar-dragging');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        }
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
}

// ==========================================
// 5. AUDIO-VISUAL SYSTEM CELEBRATIONS
// ==========================================
let canvasCtx = null;
let activeParticles = [];

function initCelebrationCanvas() {
    const c = document.getElementById('celebration-canvas');
    if (!c) return; canvasCtx = c.getContext('2d');
    window.addEventListener('resize', () => { c.width = window.innerWidth; c.height = window.innerHeight; });
    c.width = window.innerWidth; c.height = window.innerHeight;
}

function triggerAudioVisualCelebration() {
    triggerAudioChime();
    if (!canvasCtx) return;
    for (let i = 0; i < 80; i++) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = 3 + Math.random() * 6;
        activeParticles.push({
            x: canvasCtx.canvas.width / 2, y: canvasCtx.canvas.height * 0.4,
            vx: Math.cos(angle) * velocity, vy: (Math.sin(angle) * velocity) - 2,
            size: 3 + Math.random() * 4, color: ['#ff4d4d', '#ffb703', '#3a86ff', '#00b4d8'][Math.floor(Math.random() * 4)],
            alpha: 1, decay: 0.015 + Math.random() * 0.02, gravity: 0.15
        });
    }
    if (activeParticles.length === 80) requestAnimationFrame(updateParticlesLoop);
}

function triggerAudioChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx(); const now = ctx.currentTime;
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq, now + (i * 0.07));
            gain.gain.setValueAtTime(0.1, now + (i * 0.07));
            gain.gain.exponentialRampToValueAtTime(0.0001, now + (i * 0.07) + 0.3);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + (i * 0.07)); osc.stop(now + (i * 0.07) + 0.35);
        });
    } catch (err) {}
}

function updateParticlesLoop() {
    canvasCtx.clearRect(0, 0, canvasCtx.canvas.width, canvasCtx.canvas.height);
    for (let i = activeParticles.length - 1; i >= 0; i--) {
        const p = activeParticles[i];
        p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.alpha -= p.decay;
        if (p.alpha <= 0) { activeParticles.splice(i, 1); continue; }
        canvasCtx.save(); canvasCtx.globalAlpha = p.alpha; canvasCtx.fillStyle = p.color;
        canvasCtx.beginPath(); canvasCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2); canvasCtx.fill(); canvasCtx.restore();
    }
    if (activeParticles.length > 0) requestAnimationFrame(updateParticlesLoop);
}

// ==========================================
// 6. BACKGROUND CHRONO WATCHDOG ENGINE
// ==========================================
function initTimelineWatchdogEngine() {
    setInterval(() => {
        const now = new Date(); const todayStr = getTodayDateString();
        const hr = String(now.getHours()).padStart(2, '0');
        const min = now.getMinutes() >= 30 ? "30" : "00";
        const timeMatchStr = `${hr}:${min}`;

        let mutated = false;
        state.tasks.forEach(t => {
            if (t.dueDate === todayStr && !t.completed && t.scheduledTimeSlot === timeMatchStr && !t.slotExecutionTriggered) {
                t.slotExecutionTriggered = true; mutated = true;
                let activeList = state.tasks.filter(tk => tk.dueDate === todayStr && !tk.completed && tk.id !== t.id);
                activeList.sort((a, b) => (a.dayOrder || 0) - (b.dayOrder || 0));
                activeList.unshift(t);
                activeList.forEach((tk, idx) => { tk.dayOrder = idx; });
                triggerAudioChime();
            }
        });
        if (mutated) { saveToLocalStorage(); render(); }
    }, 15000); 
}

// ==========================================
// 7. GLOBAL INTERFACE EVEN RUNTIME LISTENERS
// ==========================================
function setupEventListeners() {
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const el = document.activeElement.tagName.toLowerCase();
            if (el === 'input' || el === 'select' || el === 'textarea' || document.activeElement.isContentEditable) return;
            e.preventDefault();
            const modal = document.getElementById('add-task-modal');
            if (modal && !modal.classList.contains('active')) {
                resetCreationFormContext(); modal.classList.add('active');
                setTimeout(() => { document.getElementById('task-title-input')?.focus(); }, 50);
            }
        }
    });

    document.querySelectorAll('.tab-btn').forEach(b => {
        b.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
            e.target.classList.add('active');
            state.activeTab = e.target.getAttribute('data-tab');
            render();
        });
    });

    document.getElementById('queue-toggle-square').addEventListener('click', () => {
        const collapsed = document.getElementById('sidebar-queue-panel').classList.toggle('collapsed');
        const wrap = document.getElementById('app-workspace-layout');
        if (collapsed) wrap.classList.add('sidebar-collapsed-layout');
        else wrap.classList.remove('sidebar-collapsed-layout');
        renderQueuePanel();
    });

    const addModal = document.getElementById('add-task-modal');
    document.getElementById('open-add-modal').addEventListener('click', () => { resetCreationFormContext(); addModal.classList.add('active'); setTimeout(() => { document.getElementById('task-title-input')?.focus(); }, 50); });
    document.getElementById('close-modal').addEventListener('click', () => { addModal.classList.remove('active'); resetCreationFormContext(); });

    document.getElementById('task-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const titleInp = document.getElementById('task-title-input');
        const finalDate = state.nextTaskTargetDueDate || document.getElementById('task-date').value || getTodayDateString();
        
        state.tasks.push({
            id: 'task_' + Date.now(), title: titleInp.value, term: document.getElementById('task-term').value,
            priority: document.getElementById('task-priority').value, dateCreated: getTodayDateString(), dueDate: finalDate,
            completed: false, dayOrder: getSortedTasksForDate(finalDate).length, subTasks: [], notes: "",
            scheduledTimeSlot: null, slotExecutionTriggered: false
        });

        saveToLocalStorage(); titleInp.value = ''; addModal.classList.remove('active'); resetCreationFormContext(); render();
    });

    document.getElementById('edit-global-title').addEventListener('input', (e) => { const t = state.tasks.find(x => x.id === state.currentlyEditingTaskId); if(t){ t.title = e.target.value; saveToLocalStorage(); } });
    document.getElementById('edit-global-term').addEventListener('change', (e) => { const t = state.tasks.find(x => x.id === state.currentlyEditingTaskId); if(t){ t.term = e.target.value; saveToLocalStorage(); render(); } });
    document.getElementById('edit-global-priority').addEventListener('change', (e) => { const t = state.tasks.find(x => x.id === state.currentlyEditingTaskId); if(t){ t.priority = e.target.value; saveToLocalStorage(); render(); } });
    document.getElementById('edit-global-date').addEventListener('change', (e) => {
        const t = state.tasks.find(x => x.id === state.currentlyEditingTaskId);
        if(t){ const prev = t.dueDate; t.dueDate = e.target.value; t.scheduledTimeSlot = null; t.slotExecutionTriggered = false; normalizeDayOrders(prev); normalizeDayOrders(e.target.value); saveToLocalStorage(); render(); }
    });
    document.getElementById('edit-global-notes').addEventListener('input', (e) => { const t = state.tasks.find(x => x.id === state.currentlyEditingTaskId); if(t){ t.notes = e.target.value; saveToLocalStorage(); } });

    document.getElementById('edit-global-complete-btn').addEventListener('click', () => { const t = state.tasks.find(x => x.id === state.currentlyEditingTaskId); if(t){ document.getElementById('edit-task-modal').classList.remove('active'); state.currentlyEditingTaskId = null; completeTask(t); } });
    document.getElementById('edit-global-duplicate-btn').addEventListener('click', () => { const t = state.tasks.find(x => x.id === state.currentlyEditingTaskId); if(t){ duplicateTask(t); document.getElementById('edit-task-modal').classList.remove('active'); state.currentlyEditingTaskId = null; } });
    document.getElementById('edit-global-delete-btn').addEventListener('click', () => { const t = state.tasks.find(x => x.id === state.currentlyEditingTaskId); if(t){ document.getElementById('edit-task-modal').classList.remove('active'); deleteTask(t); } });
    document.getElementById('close-edit-modal').addEventListener('click', () => { document.getElementById('edit-task-modal').classList.remove('active'); state.currentlyEditingTaskId = null; render(); if(document.getElementById('full-month-viewport').classList.contains('sliding-active')) renderFullMonthView(); });

    document.getElementById('cal-prev-week').addEventListener('click', () => { state.currentCalendarWeekAnchor.setDate(state.currentCalendarWeekAnchor.getDate() - 7); renderCalendarView(); });
    document.getElementById('cal-today').addEventListener('click', () => { state.currentCalendarWeekAnchor = new Date(); renderCalendarView(); });
    document.getElementById('cal-next-week').addEventListener('click', () => { state.currentCalendarWeekAnchor.setDate(state.currentCalendarWeekAnchor.getDate() + 7); renderCalendarView(); });

    const monthView = document.getElementById('full-month-viewport');
    document.getElementById('toggle-full-calendar').addEventListener('click', () => { state.currentCalendarMonthAnchor = new Date(state.currentCalendarWeekAnchor); renderFullMonthView(); monthView.classList.add('sliding-active'); });
    document.getElementById('close-full-calendar').addEventListener('click', () => { monthView.classList.remove('sliding-active'); renderCalendarView(); });
    document.getElementById('month-prev').addEventListener('click', () => { state.currentCalendarMonthAnchor.setMonth(state.currentCalendarMonthAnchor.getMonth() - 1); renderFullMonthView(); });
    document.getElementById('month-next').addEventListener('click', () => { state.currentCalendarMonthAnchor.setMonth(state.currentCalendarMonthAnchor.getMonth() + 1); renderFullMonthView(); });
    document.getElementById('close-timeline-modal').addEventListener('click', () => { document.getElementById('timeline-scheduler-modal').classList.remove('active'); state.activeTimelineDatePicker = null; render(); });
}

// ==========================================
// 8. CORE ATOMIC DATA MUTATORS
// ==========================================
function completeTask(task) {
    task.completed = true; triggerAudioVisualCelebration();
    normalizeDayOrders(task.dueDate); saveToLocalStorage(); render();
}
function postponeTask(task) {
    const old = task.dueDate; const tom = new Date(); tom.setDate(tom.getDate() + 1);
    const tomStr = tom.toISOString().split('T')[0];
    task.dueDate = tomStr; task.scheduledTimeSlot = null; task.slotExecutionTriggered = false;
    normalizeDayOrders(old); normalizeDayOrders(tomStr); saveToLocalStorage(); render();
}
function deleteTask(task) {
    if (confirm("Delete this workspace item permanently? This action cannot be reversed.")) {
        const d = task.dueDate; state.tasks = state.tasks.filter(x => x.id !== task.id);
        normalizeDayOrders(d); saveToLocalStorage(); render();
    }
}
function duplicateTask(src) {
    const cloneTree = (arr) => arr.map(s => ({ id: 'sub_' + Math.random().toString(36).substr(2,4), title: s.title, completed: s.completed, subTasks: cloneTree(s.subTasks || []) }));
    state.tasks.push({
        id: 'task_' + Date.now(), title: `${src.title} (Copy)`, term: src.term, priority: src.priority,
        dateCreated: getTodayDateString(), dueDate: src.dueDate, completed: false,
        dayOrder: getSortedTasksForDate(src.dueDate).length, subTasks: cloneTree(src.subTasks || []), 
        notes: src.notes || "", scheduledTimeSlot: null, slotExecutionTriggered: false
    });
    saveToLocalStorage(); render();
}

// ==========================================
// 9. OBJECT ARCHITECTURE LAYOUT PRESENTERS
// ==========================================
function createPriorityBoxMarkup(task, callback) {
    const b = document.createElement('div'); b.className = `priority-box priority-box-${task.priority}`;
    const s = document.createElement('select'); s.className = "priority-dropdown-select";
    s.innerHTML = `<option value="low" ${task.priority==='low'?'selected':''}>Blue</option><option value="medium" ${task.priority==='medium'?'selected':''}>Yellow</option><option value="high" ${task.priority==='high'?'selected':''}>Red</option>`;
    s.addEventListener('change', (e) => { e.stopPropagation(); task.priority = e.target.value; saveToLocalStorage(); b.className = `priority-box priority-box-${task.priority}`; if(callback) callback(); });
    b.appendChild(s); return b;
}

function openGlobalEditModal(taskId) {
    const t = state.tasks.find(x => x.id === taskId); if (!t) return;
    state.currentlyEditingTaskId = taskId;
    
    document.getElementById('edit-global-title').value = t.title;
    document.getElementById('edit-global-notes').value = t.notes || '';
    
    const pSel = document.getElementById('edit-global-priority'); pSel.innerHTML = `<option value="low">Blue Tier</option><option value="medium">Yellow Tier</option><option value="high">Red Tier</option>`; pSel.value = t.priority;
    const tSel = document.getElementById('edit-global-term'); tSel.innerHTML = `<option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option>`; tSel.value = t.term;
    document.getElementById('edit-global-date').value = t.dueDate;
    document.getElementById('edit-global-complete-btn').style.display = t.completed ? 'none' : 'inline-block';

    const treeContainer = document.getElementById('edit-modal-subtasks-tree'); treeContainer.innerHTML = '';
    renderSubtaskTree(treeContainer, t, t, 1);
    
    document.getElementById('edit-task-modal').classList.add('active');
    setTimeout(() => { document.getElementById('edit-global-title')?.focus(); }, 50);
}

function renderSubtaskTree(parentDom, root, scope, lvl) {
    if (lvl > 3) return; const ul = document.createElement('ul'); if (lvl === 1) ul.className = "task-tree";
    scope.subTasks.forEach(sub => {
        const li = document.createElement('li'); const lbl = document.createElement('label');
        const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = sub.completed;
        chk.addEventListener('change', () => { sub.completed = chk.checked; saveToLocalStorage(); openGlobalEditModal(root.id); });
        
        const txt = document.createElement('span'); txt.innerText = sub.title; txt.contentEditable = true;
        if (sub.completed) txt.className = "task-done";
        txt.addEventListener('blur', () => { sub.title = txt.innerText; saveToLocalStorage(); });

        lbl.appendChild(chk); lbl.appendChild(txt); li.appendChild(lbl);
        if (lvl < 3) renderSubtaskTree(li, root, sub, lvl + 1);
        ul.appendChild(li);
    });
    const addLi = document.createElement('li'); addLi.innerHTML = `<input type="text" placeholder="+ Add milestone..." class="inline-add-input" style="background:transparent; border:none; border-bottom:1px dashed var(--border-color); color:var(--text-muted); outline:none; font-size:0.85rem;">`;
    addLi.querySelector('input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.value.trim() !== '') {
            scope.subTasks.push({ id: 'sub_' + Math.random().toString(36).substr(2,4), title: e.target.value.trim(), completed: false, subTasks: [] });
            saveToLocalStorage(); openGlobalEditModal(root.id);
        }
    });
    ul.appendChild(addLi); parentDom.appendChild(ul);
}

// ==========================================
// 10. DRAG & DROP TASKS SORTING RE-ORDERS
// ==========================================
function handleDragStart(e, id) { localDraggedTaskId = id; e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; }
function handleDragOverSort(e, targetTask, element) {
    if (!localDraggedTaskId || localDraggedTaskId === targetTask.id) return;
    const dragged = state.tasks.find(x => x.id === localDraggedTaskId);
    if (!dragged || dragged.dueDate !== targetTask.dueDate) return;

    e.preventDefault(); const box = element.getBoundingClientRect();
    const mid = (e.clientY - box.top) > (box.height / 2);
    let list = getSortedTasksForDate(targetTask.dueDate);
    const dIdx = list.indexOf(dragged); const tIdx = list.indexOf(targetTask);

    if (mid && dIdx < tIdx) { list.splice(dIdx, 1); list.splice(tIdx, 0, dragged); }
    else if (!mid && dIdx > tIdx) { list.splice(dIdx, 1); list.splice(tIdx, 0, dragged); }
    else return;

    list.forEach((t, i) => t.dayOrder = i); saveToLocalStorage(); render();
}

// ==========================================
// 11. CENTRAL PRESENTATION RENDERING CORE
// ==========================================
function render() {
    renderMainContent();
    renderQueuePanel();
    renderCalendarView();
    renderSafeMobileView(); 
}

function renderMainContent() {
    const area = document.getElementById('main-content-area'); if (!area) return; area.innerHTML = '';
    if (state.activeTab === 'current') {
        const today = getSortedTasksForDate(getTodayDateString()); const focus = today[0];
        if (!focus) { area.innerHTML = `<div class="focus-card" style="text-align:center; padding:50px 20px;"><span class="focus-label">BOARD CLEAR</span><h2>No Active Focus Target</h2></div>`; return; }
        
        const card = document.createElement('div'); card.className = "tab-view";
        card.innerHTML = `
            <div class="focus-card">
                <span class="focus-label">ACTIVE OBJECTIVE</span>
                <h1 class="focus-title" id="focus-click">${focus.title}</h1>
                <div class="focus-meta" id="focus-meta-row">
                    <label style="font-size:0.85rem; color:var(--text-muted); display:inline-flex; align-items:center; gap:6px;">Horizon:
                        <select id="focus-inline-term" class="inline-text-select"><option value="short" ${focus.term==='short'?'selected':''}>Short</option><option value="medium" ${focus.term==='medium'?'selected':''}>Medium</option><option value="long" ${focus.term==='long'?'selected':''}>Long</option></select>
                    </label>
                </div>
                <div id="focus-tree-dest"></div>
                <div class="focus-actions">
                    <button class="btn btn-complete" id="f-comp">Complete</button>
                    <button class="btn btn-postpone" id="f-post">Postpone</button>
                    <button class="btn btn-delete" id="f-del">Delete</button>
                </div>
            </div>`;
        area.appendChild(card);
        const row = card.querySelector('#focus-meta-row'); row.insertBefore(createPriorityBoxMarkup(focus, () => render()), row.firstChild);
        document.getElementById('focus-click').addEventListener('click', () => openGlobalEditModal(focus.id));
        document.getElementById('focus-inline-term').addEventListener('change', (e) => { focus.term = e.target.value; saveToLocalStorage(); render(); });
        renderSubtaskTree(document.getElementById('focus-tree-dest'), focus, focus, 1);
        document.getElementById('f-comp').addEventListener('click', () => completeTask(focus));
        document.getElementById('f-post').addEventListener('click', () => postponeTask(focus));
        document.getElementById('f-del').addEventListener('click', () => deleteTask(focus));
    } else {
        renderHorizonTableLists(area);
    }
}

function renderHorizonTableLists(container) {
    const isM = state.activeTab === 'master';
    let list = isM ? state.tasks : state.tasks.filter(t => t.term === state.activeTab && !t.completed);
    if (!isM) { const w = { high: 3, medium: 2, low: 1 }; list.sort((a,b) => w[b.priority] - w[a.priority]); }
    let active = list.filter(x => !x.completed); let comp = list.filter(x => x.completed);

    let html = `<div class="list-view-header"><h2>${state.activeTab.toUpperCase()} TIMELINES</h2></div><table class="task-table"><thead><tr><th>Title</th><th>Horizon</th><th>Target Date</th></tr></thead><tbody id="table-target"></tbody></table>`;
    if(isM) html += `<div class="completed-section-divider" style="margin-top:40px; border-top:2px dashed var(--border-color); padding-top:20px;"><h3>COMPLETED REPOSITORY LOGS</h3></div><table class="task-table"><tbody id="table-comp-target"></tbody></table>`;
    container.innerHTML = html;

    const tBody = container.querySelector('#table-target');
    if(active.length===0) tBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No items matched this filter index.</td></tr>`;
    active.forEach(t => {
        const tr = document.createElement('tr'); tr.setAttribute('data-id', t.id);
        const td = document.createElement('td'); td.className = "table-title-cell";
        const span = document.createElement('span'); span.innerText = t.title; span.addEventListener('click', () => openGlobalEditModal(t.id));
        td.appendChild(createPriorityBoxMarkup(t, () => render())); td.appendChild(span); tr.appendChild(td);
        tr.innerHTML += `<td><select class="table-select" data-field="term"><option value="short" ${t.term==='short'?'selected':''}>Short</option><option value="medium" ${t.term==='medium'?'selected':''}>Medium</option><option value="long" ${t.term==='long'?'selected':''}>Long</option></select></td><td><input type="date" value="${t.dueDate}" class="table-date" data-field="dueDate"></td>`;
        tBody.appendChild(tr);
    });

    if (isM) {
        const cBody = container.querySelector('#table-comp-target');
        if(comp.length===0) cBody.innerHTML = `<tr><td style="text-align:center; color:var(--text-muted);">Empty archive.</td></tr>`;
        comp.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td class="revive-click" style="text-decoration:line-through; color:var(--text-muted); cursor:pointer; width:85%;">${t.title}</td><td><button class="btn revive-btn">Revive</button></td>`;
            tr.querySelector('.revive-click').addEventListener('click', () => openGlobalEditModal(t.id));
            tr.querySelector('.revive-btn').addEventListener('click', () => { t.completed = false; t.dueDate = getTodayDateString(); normalizeDayOrders(t.dueDate); saveToLocalStorage(); render(); });
            cBody.appendChild(tr);
        });
    }

    container.querySelectorAll('[data-field]').forEach(el => el.addEventListener('change', (e) => {
        const t = state.tasks.find(x => x.id === e.target.closest('tr').getAttribute('data-id'));
        if(t) { const prev = t.dueDate; t[e.target.getAttribute('data-field')] = e.target.value; if(e.target.getAttribute('data-field')==='dueDate') { t.scheduledTimeSlot = null; t.slotExecutionTriggered = false; normalizeDayOrders(prev); normalizeDayOrders(e.target.value); } saveToLocalStorage(); render(); }
    }));
}

function renderQueuePanel() {
    const wrap = document.getElementById('queue-items-wrapper'); const panel = document.getElementById('sidebar-queue-panel');
    if (!wrap || !panel) return; wrap.innerHTML = '';
    const isCol = panel.classList.contains('collapsed'); const today = getSortedTasksForDate(getTodayDateString());

    for (let i = 0; i < 10; i++) {
        const t = today[i] || null; const div = document.createElement('div');
        div.className = 'queue-item'; div.setAttribute('draggable', t ? 'true' : 'false');
        if (t) {
            if (isCol) { div.innerHTML = `<span class="queue-number">${i+1}</span>`; }
            else {
                div.innerHTML = `<span class="queue-number">${i+1}</span><div class="p-dest"></div><span class="queue-text">${t.title}</span><select class="inline-select"><option value="short" ${t.term==='short'?'selected':''}>Short</option><option value="medium" ${t.term==='medium'?'selected':''}>Med</option><option value="long" ${t.term==='long'?'selected':''}>Long</option></select>`;
                div.querySelector('.p-dest').appendChild(createPriorityBoxMarkup(t, () => render()));
                div.querySelector('.queue-text').addEventListener('click', () => openGlobalEditModal(t.id));
                div.querySelector('.inline-select').addEventListener('change', (e) => { t.term = e.target.value; saveToLocalStorage(); render(); });
            }
            div.addEventListener('dragstart', (e) => handleDragStart(e, t.id));
            div.addEventListener('dragover', (e) => handleDragOverSort(e, t, div));
            div.addEventListener('dragend', () => localDraggedTaskId = null);
        } else {
            div.classList.add('queue-item-empty-clickable');
            div.innerHTML = isCol ? `<span class="queue-number" style="border-style:dashed; background:transparent;">+</span>` : `<span class="queue-number">${i+1}</span><span class="queue-text" style="color:var(--text-muted); font-style:italic;">Empty Slot</span>`;
            div.addEventListener('click', () => { resetCreationFormContext(); state.nextTaskTargetDueDate = getTodayDateString(); document.getElementById('add-task-modal').classList.add('active'); setTimeout(() => { document.getElementById('task-title-input')?.focus(); }, 50); });
            div.addEventListener('dragover', (e) => e.preventDefault());
            div.addEventListener('drop', (e) => {
                e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); const tk = state.tasks.find(x => x.id === id);
                if (tk && tk.dueDate !== getTodayDateString()) { const p = tk.dueDate; tk.dueDate = getTodayDateString(); tk.dayOrder = today.length; normalizeDayOrders(p); normalizeDayOrders(getTodayDateString()); saveToLocalStorage(); render(); }
            });
        }
        wrap.appendChild(div);
    }
}

function renderCalendarView() {
    const grid = document.getElementById('calendar-grid-container'); if (!grid) return; grid.innerHTML = '';
    const trueToday = new Date(); trueToday.setHours(0,0,0,0);
    const trueIdx = trueToday.getDay();

    const baseSunday = new Date(state.currentCalendarWeekAnchor); baseSunday.setDate(baseSunday.getDate() - baseSunday.getDay());

    for (let i = 0; i < 7; i++) {
        const dInst = new Date(baseSunday); dInst.setDate(baseSunday.getDate() + i); dInst.setHours(0,0,0,0);
        const isCurAnchor = (baseSunday.toDateString() === new Date(new Date().setDate(new Date().getDate() - new Date().getDay())).toDateString());
        let isRolled = false;

        if (isCurAnchor && (trueIdx - i > 1)) { dInst.setDate(dInst.getDate() + 7); isRolled = true; }
        const delta = Math.round((dInst.getTime() - trueToday.getTime()) / 86400000);

        let cName = delta === 0 ? 'today' : (delta === -1 ? 'past-day' : (isRolled ? 'upcoming-next-week' : (delta > 0 ? 'upcoming-this-week' : 'past-day')));
        const dStr = new Date(dInst.getTime() - (dInst.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        const dayTasks = getSortedTasksForDate(dStr);

        const dayDiv = document.createElement('div'); dayDiv.className = `calendar-day ${cName}`;
        let headerTxt = `${dInst.getDate()} ${dInst.toLocaleDateString('en-US', { weekday: 'short' })}${(i === 0 || dInst.getDate() === 1) ? ` - ${dInst.toLocaleDateString('en-US', { month: 'long' })}` : ''}`;
        if (delta === 0) headerTxt += ' (Today)'; if (delta === -1) headerTxt += ' (Yesterday)';

        dayDiv.innerHTML = `<div class="day-header" id="hd-trigger-${i}">${headerTxt}</div><ul class="day-tasks"></ul>`;
        grid.appendChild(dayDiv);

        dayDiv.querySelector(`#hd-trigger-${i}`).addEventListener('click', (e) => { e.stopPropagation(); state.activeTimelineDatePicker = dStr; renderTimelineSchedulerOverlay(); document.getElementById('timeline-scheduler-modal').classList.add('active'); });
        dayDiv.addEventListener('click', (e) => { if (e.target.tagName === 'LI' || e.target.closest('li') || e.target.classList.contains('day-header')) return; resetCreationFormContext(); state.nextTaskTargetDueDate = dStr; document.getElementById('add-task-modal').classList.add('active'); const inp = document.getElementById('task-date'); if(inp) inp.value = dStr; setTimeout(() => { document.getElementById('task-title-input')?.focus(); }, 50); });

        const ul = dayDiv.querySelector('.day-tasks');
        dayTasks.forEach(t => {
            const li = document.createElement('li'); li.setAttribute('draggable', 'true');
            const span = document.createElement('span'); span.innerText = t.title; span.style.flex = "1";
            li.appendChild(createPriorityBoxMarkup(t, () => render())); li.appendChild(span);
            li.addEventListener('dragstart', (e) => handleDragStart(e, t.id));
            li.addEventListener('dragover', (e) => handleDragOverSort(e, t, li));
            li.addEventListener('dragend', () => localDraggedTaskId = null);
            span.addEventListener('click', (e) => { e.stopPropagation(); openGlobalEditModal(t.id); });
            ul.appendChild(li);
        });

        dayDiv.addEventListener('dragover', (e) => { if(localDraggedTaskId && state.tasks.find(x=>x.id===localDraggedTaskId)?.dueDate !== dStr) e.preventDefault(); });
        dayDiv.addEventListener('drop', (e) => {
            e.preventDefault(); if (!localDraggedTaskId) return;
            const t = state.tasks.find(x => x.id === localDraggedTaskId);
            if (t && t.dueDate !== dStr) { const prev = t.dueDate; t.dueDate = dStr; t.dayOrder = getSortedTasksForDate(dStr).length; normalizeDayOrders(prev); normalizeDayOrders(dStr); saveToLocalStorage(); localDraggedTaskId = null; render(); }
        });
    }
}

function renderFullMonthView() {
    const container = document.getElementById('month-matrix-container'); const label = document.getElementById('month-display-label');
    if (!container || !label) return; container.innerHTML = '';
    const target = new Date(state.currentCalendarMonthAnchor); const yr = target.getFullYear(); const mo = target.getMonth();
    label.innerText = target.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const offset = new Date(yr, mo, 1).getDay(); const totalDays = new Date(yr, mo + 1, 0).getDate();
    const cellsTotal = offset + totalDays; const iterations = cellsTotal + (7 - (cellsTotal % 7) < 7 ? 7 - (cellsTotal % 7) : 0);

    for (let i = 0; i < iterations; i++) {
        const cellDate = new Date(yr, mo, 1 - offset + i);
        const dStr = new Date(cellDate.getTime() - (cellDate.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        const cell = document.createElement('div'); cell.className = `month-cell ${cellDate.getMonth() !== mo ? 'cell-outside-range' : ''} ${dStr === getTodayDateString() ? 'cell-today' : ''}`;
        
        cell.innerHTML = `<div class="month-cell-header"><span class="month-day-num">${cellDate.getDate()}</span>${(cellDate.getDate() === 1 || i === 0) ? `<span class="month-month-lbl">${cellDate.toLocaleDateString('en-US', { month: 'short' })}</span>` : ''}</div><ul class="month-cell-tasks"></ul>`;
        const ul = cell.querySelector('.month-cell-tasks'); const list = getSortedTasksForDate(dStr);
        
        list.slice(0, 3).forEach(t => {
            const li = document.createElement('li'); li.innerHTML = `<span style="width:6px; height:6px; border-radius:50%; background-color:var(--accent-${t.priority});"></span><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${t.title}</span>`;
            li.addEventListener('click', (e) => { e.stopPropagation(); openGlobalEditModal(t.id); });
            ul.appendChild(li);
        });
        if (list.length > 3) {
            const ind = document.createElement('div'); ind.className = "month-overflow-indicator"; ind.innerText = `+ ${list.length - 3} more`;
            ind.addEventListener('click', (e) => { e.stopPropagation(); openDayPopoverOverlay(dStr); }); cell.appendChild(ind);
        }
        cell.addEventListener('click', () => { resetCreationFormContext(); state.nextTaskTargetDueDate = dStr; document.getElementById('add-task-modal').classList.add('active'); const inp = document.getElementById('task-date'); if(inp) inp.value = dStr; setTimeout(() => { document.getElementById('task-title-input')?.focus(); }, 50); });
        cell.addEventListener('dragover', (e) => e.preventDefault());
        cell.appendChild(ul); container.appendChild(cell);
    }
}

function openDayPopoverOverlay(dateStr) {
    const old = document.getElementById('day-popover-instance'); if (old) old.remove();
    const div = document.createElement('div'); div.id = "day-popover-instance"; div.className = "modal-overlay active";
    div.innerHTML = `<div class="modal-content day-popover-modal"><h3>Agenda: ${new Date(dateStr+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric'})}</h3><ul class="popover-task-list"></ul><div class="modal-actions"><button type="button" class="btn" id="cls-popover">Close</button></div></div>`;
    document.body.appendChild(div);
    const ul = div.querySelector('.popover-task-list');
    getSortedTasksForDate(dateStr).forEach(t => {
        const li = document.createElement('li'); li.innerHTML = `<span class="priority-box priority-box-${t.priority}"></span><span style="flex:1;">${t.title}</span>`;
        li.addEventListener('click', () => { div.remove(); openGlobalEditModal(t.id); }); ul.appendChild(li);
    });
    document.getElementById('cls-popover').addEventListener('click', () => { div.remove(); renderFullMonthView(); });
}

function renderTimelineSchedulerOverlay() {
    const dStr = state.activeTimelineDatePicker; if (!dStr) return;
    document.getElementById('timeline-date-label').innerText = `Schedule Matrix: ${new Date(dStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

    const sidebar = document.getElementById('timeline-sidebar-tasks'); sidebar.innerHTML = '';
    const dayList = state.tasks.filter(t => t.dueDate === dStr && !t.completed);
    
    dayList.filter(t => !t.scheduledTimeSlot).forEach(t => {
        const li = document.createElement('li'); li.className = "timeline-card-item"; li.setAttribute('draggable', 'true');
        li.innerHTML = `<span class="priority-box priority-box-${t.priority}"></span><span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${t.title}</span>`;
        li.addEventListener('dragstart', (e) => handleDragStart(e, t.id));
        li.addEventListener('dragend', () => localDraggedTaskId = null);
        li.addEventListener('click', () => openGlobalEditModal(t.id));
        sidebar.appendChild(li);
    });

    const matrix = document.getElementById('hourly-slots-matrix'); matrix.innerHTML = '';
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 2; m++) {
            const slotVal = `${String(h).padStart(2,'0')}:${m === 0 ? "00" : "30"}`;
            const row = document.createElement('div'); row.className = "time-row-strip";
            row.innerHTML = `<div class="time-label-stamp">${h % 12 === 0 ? 12 : h % 12}:${m === 0 ? "00" : "30"} ${h >= 12 ? "PM" : "AM"}</div><div class="time-slot-dropzone" data-time-slot="${slotVal}"></div>`;
            const dz = row.querySelector('.time-slot-dropzone');
            
            const match = dayList.find(t => t.scheduledTimeSlot === slotVal);
            if (match) {
                const item = document.createElement('div'); item.className = "timeline-card-item";
                item.innerHTML = `<span class="priority-box priority-box-${match.priority}"></span><span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${match.title}</span><button type="button" class="btn-remove-slot">×</button>`;
                item.querySelector('.btn-remove-slot').addEventListener('click', (e) => { e.stopPropagation(); match.scheduledTimeSlot = null; match.slotExecutionTriggered = false; saveToLocalStorage(); renderTimelineSchedulerOverlay(); });
                item.addEventListener('click', () => openGlobalEditModal(match.id)); dz.appendChild(item);
            }
            row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-hover-slot'); });
            row.addEventListener('dragleave', () => row.classList.remove('drag-hover-slot'));
            row.addEventListener('drop', (e) => {
                e.preventDefault(); row.classList.remove('drag-hover-slot'); if (!localDraggedTaskId) return;
                const task = state.tasks.find(x => x.id === localDraggedTaskId);
                if (task) { task.scheduledTimeSlot = slotVal; task.slotExecutionTriggered = false; saveToLocalStorage(); localDraggedTaskId = null; renderTimelineSchedulerOverlay(); }
            });
            matrix.appendChild(row);
        }
    }
}

// ==========================================
// 12. SAFE INDEPENDENT MOBILE WORKSPACE
// ==========================================
function initSafeMobileEngine() {
    const mobAddOverlay = document.getElementById('mobile-add-overlay');
    if (!mobAddOverlay) return; 

    document.getElementById('mob-action-add').addEventListener('click', () => {
        document.getElementById('mob-input-title').value = '';
        mobAddOverlay.classList.add('active-view');
        setTimeout(() => { document.getElementById('mob-input-title').focus(); }, 100);
    });

    document.getElementById('mob-cancel-add').addEventListener('click', () => {
        mobAddOverlay.classList.remove('active-view');
    });

    document.getElementById('mobile-task-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const titleStr = document.getElementById('mob-input-title').value.trim();
        const todayStr = getTodayDateString();
        
        let activeTodayList = state.tasks.filter(tk => tk.dueDate === todayStr && !tk.completed);
        activeTodayList.sort((a, b) => (a.dayOrder || 0) - (b.dayOrder || 0));

        const mobilePushedTopTask = {
            id: 'task_mob_' + Date.now(),
            title: titleStr,
            term: document.getElementById('mob-input-term').value,
            priority: document.getElementById('mob-input-priority').value,
            dateCreated: todayStr,
            dueDate: todayStr,
            completed: false,
            dayOrder: 0, 
            subTasks: [],
            notes: "Created via Mobile Portal Client.",
            scheduledTimeSlot: null,
            slotExecutionTriggered: false
        };

        activeTodayList.unshift(mobilePushedTopTask);
        activeTodayList.forEach((tk, idx) => { tk.dayOrder = idx; });

        state.tasks.push(mobilePushedTopTask);
        saveToLocalStorage(); 
        
        mobAddOverlay.classList.remove('active-view');
        render();
    });

    document.getElementById('mob-action-complete').addEventListener('click', () => {
        const todayList = state.tasks.filter(t => t.dueDate === getTodayDateString() && !t.completed).sort((a, b) => (a.dayOrder || 0) - (b.dayOrder || 0));
        if (todayList.length > 0) completeTask(todayList[0]);
    });

    document.getElementById('mob-action-delete').addEventListener('click', () => {
        const todayList = state.tasks.filter(t => t.dueDate === getTodayDateString() && !t.completed).sort((a, b) => (a.dayOrder || 0) - (b.dayOrder || 0));
        if (todayList.length > 0) deleteTask(todayList[0]);
    });

    document.querySelectorAll('.mobile-dock-slot').forEach(slot => {
        slot.addEventListener('click', () => {
            const targetIndex = parseInt(slot.getAttribute('data-queue-index'), 10);
            const todayList = state.tasks.filter(t => t.dueDate === getTodayDateString() && !t.completed).sort((a, b) => (a.dayOrder || 0) - (b.dayOrder || 0));
            
            if (todayList.length > targetIndex) {
                const currentFocusItem = todayList[0];
                const selectedQueueItem = todayList[targetIndex];

                const tempOrder = currentFocusItem.dayOrder;
                currentFocusItem.dayOrder = selectedQueueItem.dayOrder;
                selectedQueueItem.dayOrder = tempOrder;

                saveToLocalStorage();
                render();
            }
        });
    });
}

function renderSafeMobileView() {
    if (window.innerWidth >= 768) return; 

    const focusStage = document.getElementById('mobile-focus-card-dest');
    if (!focusStage) return;
    focusStage.innerHTML = '';

    const todayList = state.tasks.filter(t => t.dueDate === getTodayDateString() && !t.completed).sort((a, b) => (a.dayOrder || 0) - (b.dayOrder || 0));
    const currentFocus = todayList[0] || null;

    if (!currentFocus) {
        focusStage.innerHTML = `
            <div class="mobile-focus-card">
                <span class="mob-meta-tag">CLEAR HORIZON</span>
                <div class="mob-title-display" style="color:#64748b; font-size:1.25rem;">All items complete!</div>
            </div>`;
    } else {
        const card = document.createElement('div');
        card.className = `mobile-focus-card border-${currentFocus.priority}`;
        card.innerHTML = `
            <span class="mob-meta-tag">${currentFocus.term} Horizon / ${currentFocus.priority.toUpperCase()} Priority</span>
            <div class="mob-title-display">${currentFocus.title}</div>
        `;
        focusStage.appendChild(card);
    }

    for (let slotIdx = 1; slotIdx <= 3; slotIdx++) {
        const slotElement = document.getElementById(`mob-slot-${slotIdx}`);
        if (!slotElement) continue;
        
        slotElement.innerHTML = '';
        slotElement.className = 'mobile-dock-slot';

        const queueItem = todayList[slotIdx] || null;
        if (queueItem) {
            slotElement.classList.add('has-content', `slot-p-${queueItem.priority}`);
            slotElement.innerHTML = `
                <span class="slot-idx-num">#${slotIdx + 1} NEXT</span>
                <span class="slot-title-truncate">${queueItem.title}</span>
            `;
        } else {
            slotElement.innerHTML = `<span class="slot-idx-num" style="color:rgba(255,255,255,0.15);">EMPTY</span>`;
        }
    }
}
