// State variables
let powerChart = null;
let voltageChart = null;
let currentRawVars = {};
let sseSource = null;
let allPlansData = { plans: [], logs: [] };
let allAlertsData = { rules: [], recipients: [], channel_settings: {}, logs: [] };
let allConnectionsData = { nut_server: {}, proxmox_servers: [], vmware_servers: [], messaging_gateways: {}, api_tokens: [] };
let isPollingActive = false;

let currentMainModule = 'status'; // 'status', 'automatization', 'alerts', 'connections'
let currentSubView = 'overview';   // 'overview', 'telemetry', 'vars', 'plans', 'rules', 'contacts', 'logs', 'nut', 'proxmox', 'vmware', 'gateways', 'tokens'
let selectedPlanId = null;
let currentVarCategory = 'all';

// Light theme defaults for SweetAlert2 with Enging Brand Colors
const swalEnging = Swal.mixin({
    background: '#ffffff',
    color: '#1e293b',
    confirmButtonColor: '#e95c0c',
    cancelButtonColor: '#64748b',
    customClass: {
        popup: 'border border-slate-200 rounded-3xl shadow-2xl',
        title: 'text-enging-navy font-bold text-lg',
        htmlContainer: 'text-slate-600 text-sm'
    }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initCharts();
    loadHistoryData();
    loadPlansData();
    loadAlertsData();
    loadConnectionsData();
    
    // Restaura a página e subpágina anterior ao atualizar a página (F5)
    let initModule = 'status';
    let initSubView = 'overview';
    
    const hash = window.location.hash ? window.location.hash.replace(/^#\/?/, '') : '';
    if (hash) {
        const parts = hash.split('/');
        if (parts[0]) initModule = parts[0];
        if (parts[1]) initSubView = parts[1];
    } else {
        const saved = localStorage.getItem('nut_active_route');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.module) initModule = parsed.module;
                if (parsed.subview) initSubView = parsed.subview;
            } catch(e) {}
        }
    }
    
    switchMainView(initModule, initSubView);

    // Polling ativo contínuo a cada 1.5s
    fetchStatusNow();
    setInterval(() => {
        fetchStatusNow(false);
    }, 1500);

    // Conectar SSE para push instantâneo
    connectSSE();
});

// ------------------------------------------------------------- //
// NAVEGAÇÃO ENTRE MÓDULOS E PÁGINAS ESPECÍFICAS                 //
// ------------------------------------------------------------- //

function toggleSidebar(open) {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');
    if (open) {
        sidebar.classList.remove('-translate-x-full');
        backdrop.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('hidden');
    }
}

function switchMainView(moduleName, subViewName = null) {
    currentMainModule = moduleName;
    
    // Ocultar todas as páginas principais
    const vOverview = document.getElementById('view-status-overview');
    const vTelem = document.getElementById('view-status-telemetry');
    const vVars = document.getElementById('view-status-vars');
    const vAuto = document.getElementById('view-automatization');
    const vAlertsRules = document.getElementById('view-alerts-rules');
    const vAlertsContacts = document.getElementById('view-alerts-contacts');
    const vAlertsLogs = document.getElementById('view-alerts-logs');
    
    // Novas páginas de Conexões & APIs
    const vConnNut = document.getElementById('view-conn-nut');
    const vConnProxmox = document.getElementById('view-conn-proxmox');
    const vConnVmware = document.getElementById('view-conn-vmware');
    const vConnGateways = document.getElementById('view-conn-gateways');
    const vConnTokens = document.getElementById('view-conn-tokens');

    if (vOverview) vOverview.classList.add('hidden');
    if (vTelem) vTelem.classList.add('hidden');
    if (vVars) vVars.classList.add('hidden');
    if (vAuto) vAuto.classList.add('hidden');
    if (vAlertsRules) vAlertsRules.classList.add('hidden');
    if (vAlertsContacts) vAlertsContacts.classList.add('hidden');
    if (vAlertsLogs) vAlertsLogs.classList.add('hidden');
    if (vConnNut) vConnNut.classList.add('hidden');
    if (vConnProxmox) vConnProxmox.classList.add('hidden');
    if (vConnVmware) vConnVmware.classList.add('hidden');
    if (vConnGateways) vConnGateways.classList.add('hidden');
    if (vConnTokens) vConnTokens.classList.add('hidden');

    // Elementos da barra de ícones primária
    const iconBtnStatus = document.getElementById('primary-nav-status');
    const iconBtnAuto = document.getElementById('primary-nav-auto');
    const iconBtnAlerts = document.getElementById('primary-nav-alerts');
    const iconBtnConn = document.getElementById('primary-nav-conn');

    const primaryActive = 'primary-tab-btn-active';
    const primaryInactive = 'primary-tab-btn-inactive';

    // Reset ícones primários (Linguetas)
    if (iconBtnStatus) iconBtnStatus.className = primaryInactive;
    if (iconBtnAuto) iconBtnAuto.className = primaryInactive;
    if (iconBtnAlerts) iconBtnAlerts.className = primaryInactive;
    if (iconBtnConn) iconBtnConn.className = primaryInactive;

    const subTitle = document.getElementById('submenu-header-title');
    const subContainer = document.getElementById('submenu-items-container');
    const bcParent = document.getElementById('breadcrumb-parent');
    const bcCurrent = document.getElementById('breadcrumb-current');

    // Helper de classe de botão ativo e inativo no submenu
    const subBtnActive = (label, fn) => `
        <button onclick="${fn}" class="submenu-nav-link-active">
            <span>${label}</span>
            <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-enging-orange"></i>
        </button>
    `;
    const subBtnInactive = (label, fn) => `
        <button onclick="${fn}" class="submenu-nav-link-inactive">
            <span>${label}</span>
            <i data-lucide="chevron-right" class="w-3.5 h-3.5 opacity-30"></i>
        </button>
    `;

    if (moduleName === 'status') {
        if (iconBtnStatus) iconBtnStatus.className = primaryActive;
        if (subTitle) subTitle.innerText = 'STATUS';
        if (bcParent) bcParent.innerText = 'Status';

        currentSubView = subViewName || 'overview';

        if (currentSubView === 'overview') {
            if (vOverview) vOverview.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Overview';
        } else if (currentSubView === 'telemetry') {
            if (vTelem) vTelem.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Telemetria';
            setTimeout(() => {
                if (powerChart) powerChart.resize();
                if (voltageChart) voltageChart.resize();
            }, 50);
        } else if (currentSubView === 'vars') {
            if (vVars) vVars.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Variáveis NUT';
            renderRawVarsTable(currentRawVars);
        }

        if (subContainer) {
            subContainer.innerHTML = `
                ${currentSubView === 'overview' ? subBtnActive('Overview', "switchMainView('status', 'overview')") : subBtnInactive('Overview', "switchMainView('status', 'overview')")}
                ${currentSubView === 'telemetry' ? subBtnActive('Telemetria', "switchMainView('status', 'telemetry')") : subBtnInactive('Telemetria', "switchMainView('status', 'telemetry')")}
                ${currentSubView === 'vars' ? subBtnActive('Variáveis NUT', "switchMainView('status', 'vars')") : subBtnInactive('Variáveis NUT', "switchMainView('status', 'vars')")}
            `;
        }

    } else if (moduleName === 'automatization') {
        if (iconBtnAuto) iconBtnAuto.className = primaryActive;
        if (subTitle) subTitle.innerText = 'AUTOMAÇÃO';
        if (bcParent) bcParent.innerText = 'Automatization';
        if (bcCurrent) bcCurrent.innerText = 'Planos de Desligamento';

        currentSubView = 'plans';
        if (vAuto) vAuto.classList.remove('hidden');

        const plansCount = (allPlansData && allPlansData.plans) ? allPlansData.plans.length : 0;

        if (subContainer) {
            subContainer.innerHTML = `
                <button onclick="switchMainView('automatization', 'plans')" class="submenu-nav-link-active">
                    <span>Planos</span>
                    <span class="px-1.5 py-0.2 rounded bg-enging-orange text-white text-[10px] font-mono font-bold">${plansCount}</span>
                </button>
                <button onclick="openLogsModal()" class="submenu-nav-link-inactive">
                    <span>Histórico Logs</span>
                    <i data-lucide="list" class="w-3.5 h-3.5 opacity-60"></i>
                </button>
            `;
        }

    } else if (moduleName === 'alerts') {
        if (iconBtnAlerts) iconBtnAlerts.className = primaryActive;
        if (subTitle) subTitle.innerText = 'ALERTAS';
        if (bcParent) bcParent.innerText = 'Alertas';

        currentSubView = subViewName || 'rules';

        if (currentSubView === 'rules') {
            if (vAlertsRules) vAlertsRules.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Regras de Alerta';
        } else if (currentSubView === 'contacts') {
            if (vAlertsContacts) vAlertsContacts.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Contatos & Canais';
            refreshWhatsAppStatus();
        } else if (currentSubView === 'logs') {
            if (vAlertsLogs) vAlertsLogs.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Histórico de Envios';
        }

        const rulesCount = (allAlertsData && allAlertsData.rules) ? allAlertsData.rules.length : 0;
        const contactsCount = (allAlertsData && allAlertsData.recipients) ? allAlertsData.recipients.length : 0;

        if (subContainer) {
            subContainer.innerHTML = `
                ${currentSubView === 'rules' ? subBtnActive(`Regras (${rulesCount})`, "switchMainView('alerts', 'rules')") : subBtnInactive(`Regras (${rulesCount})`, "switchMainView('alerts', 'rules')")}
                ${currentSubView === 'contacts' ? subBtnActive(`Contatos (${contactsCount})`, "switchMainView('alerts', 'contacts')") : subBtnInactive(`Contatos (${contactsCount})`, "switchMainView('alerts', 'contacts')")}
                ${currentSubView === 'logs' ? subBtnActive('Histórico Envios', "switchMainView('alerts', 'logs')") : subBtnInactive('Histórico Envios', "switchMainView('alerts', 'logs')")}
            `;
        }

    } else if (moduleName === 'connections') {
        if (iconBtnConn) iconBtnConn.className = primaryActive;
        if (subTitle) subTitle.innerText = 'CONEXÕES & APIS';
        if (bcParent) bcParent.innerText = 'Conexões & APIs';

        currentSubView = subViewName || 'nut';

        if (currentSubView === 'nut') {
            if (vConnNut) vConnNut.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Servidor NUT';
            populateNutConfigForm();
        } else if (currentSubView === 'proxmox') {
            if (vConnProxmox) vConnProxmox.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Proxmox VE APIs';
            renderProxmoxTable();
        } else if (currentSubView === 'vmware') {
            if (vConnVmware) vConnVmware.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'VMware ESXi / vCenter';
            renderVmwareTable();
        } else if (currentSubView === 'gateways') {
            if (vConnGateways) vConnGateways.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Gateways de Mensagens';
            renderGatewaysList();
            refreshWhatsAppStatus();
        } else if (currentSubView === 'tokens') {
            if (vConnTokens) vConnTokens.classList.remove('hidden');
            if (bcCurrent) bcCurrent.innerText = 'Tokens de API & Webhooks';
            renderApiTokensTable();
        }

        const pveCount = (allConnectionsData && allConnectionsData.proxmox_servers) ? allConnectionsData.proxmox_servers.length : 0;
        const vmCount = (allConnectionsData && allConnectionsData.vmware_servers) ? allConnectionsData.vmware_servers.length : 0;
        const tokCount = (allConnectionsData && allConnectionsData.api_tokens) ? allConnectionsData.api_tokens.length : 0;

        if (subContainer) {
            subContainer.innerHTML = `
                ${currentSubView === 'nut' ? subBtnActive('Servidor NUT', "switchMainView('connections', 'nut')") : subBtnInactive('Servidor NUT', "switchMainView('connections', 'nut')")}
                ${currentSubView === 'proxmox' ? subBtnActive(`Proxmox VE (${pveCount})`, "switchMainView('connections', 'proxmox')") : subBtnInactive(`Proxmox VE (${pveCount})`, "switchMainView('connections', 'proxmox')")}
                ${currentSubView === 'vmware' ? subBtnActive(`VMware ESXi (${vmCount})`, "switchMainView('connections', 'vmware')") : subBtnInactive(`VMware ESXi (${vmCount})`, "switchMainView('connections', 'vmware')")}
                ${currentSubView === 'gateways' ? subBtnActive('Gateways APIs', "switchMainView('connections', 'gateways')") : subBtnInactive('Gateways APIs', "switchMainView('connections', 'gateways')")}
                ${currentSubView === 'tokens' ? subBtnActive(`Tokens API (${tokCount})`, "switchMainView('connections', 'tokens')") : subBtnInactive(`Tokens API (${tokCount})`, "switchMainView('connections', 'tokens')")}
            `;
        }
    }

    if (waPollInterval) clearInterval(waPollInterval);
    if (currentSubView === 'gateways' || currentSubView === 'contacts') {
        waPollInterval = setInterval(() => {
            refreshWhatsAppStatus();
        }, 3500);
    }

    try {
        localStorage.setItem('nut_active_route', JSON.stringify({ module: moduleName, subview: currentSubView }));
        history.replaceState(null, '', `#/${moduleName}/${currentSubView}`);
    } catch(e) {}

    toggleSidebar(false);
    lucide.createIcons();
}

// ------------------------------------------------------------- //
// CHART.JS SETUP (TELEMETRIA EM TEMPO REAL)                     //
// ------------------------------------------------------------- //

function initCharts() {
    const powerCanvas = document.getElementById('powerChart');
    const voltageCanvas = document.getElementById('voltageChart');
    if (!powerCanvas || !voltageCanvas) return;

    const powerCtx = powerCanvas.getContext('2d');
    const voltageCtx = voltageCanvas.getContext('2d');

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        elements: {
            line: {
                borderWidth: 1.5,
                tension: 0.25
            },
            point: {
                radius: 0,
                hoverRadius: 4,
                hitRadius: 10
            }
        },
        plugins: {
            legend: {
                labels: {
                    color: '#475569',
                    font: { size: 11, family: 'sans-serif', weight: 'bold' },
                    boxWidth: 12
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: '#ffffff',
                titleColor: '#1e293b',
                bodyColor: '#475569',
                borderColor: '#e2e8f0',
                borderWidth: 1,
                padding: 10,
                boxPadding: 4,
                usePointStyle: true
            }
        },
        scales: {
            x: {
                grid: { color: 'rgba(226, 232, 240, 0.6)', drawTicks: false },
                ticks: { color: '#64748b', font: { size: 10, family: 'monospace' }, maxTicksLimit: 8 }
            },
            y: {
                grid: { color: 'rgba(226, 232, 240, 0.6)' },
                ticks: { color: '#64748b', font: { size: 10, family: 'monospace' } }
            }
        }
    };

    // Power Chart (Watts & Load %)
    powerChart = new Chart(powerCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Potência Real (W)',
                    borderColor: '#e95c0c',
                    backgroundColor: 'rgba(233, 92, 12, 0.06)',
                    data: [],
                    fill: true,
                    tension: 0.25,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    yAxisID: 'y'
                },
                {
                    label: 'Carga (%)',
                    borderColor: '#223546',
                    backgroundColor: 'transparent',
                    data: [],
                    tension: 0.25,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'Watts (W)', color: '#e95c0c', font: { size: 10, weight: 'bold' } },
                    grid: { color: 'rgba(226, 232, 240, 0.6)' },
                    ticks: { color: '#64748b', font: { size: 10 } }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: true, text: 'Carga (%)', color: '#223546', font: { size: 10, weight: 'bold' } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#223546', font: { size: 10 } },
                    min: 0,
                    max: 100
                }
            }
        }
    });

    // Voltage Chart (Input vs Output)
    voltageChart = new Chart(voltageCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Tensão Entrada AC (V)',
                    borderColor: '#223546',
                    backgroundColor: 'transparent',
                    data: [],
                    tension: 0.25,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'Tensão Saída UPS (V)',
                    borderColor: '#184e8e',
                    backgroundColor: 'transparent',
                    data: [],
                    tension: 0.25,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    title: { display: true, text: 'Volts (V)', color: '#475569', font: { size: 10, weight: 'bold' } },
                    grid: { color: 'rgba(226, 232, 240, 0.6)' },
                    ticks: { color: '#64748b', font: { size: 10 } }
                }
            }
        }
    });
}

// Load historical data from API
async function loadHistoryData() {
    try {
        const res = await fetch('/api/history', { cache: 'no-cache' });
        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }
        if (!res.ok) return;
        const history = await res.json();
        
        if (history && history.length > 0 && powerChart && voltageChart) {
            const labels = history.map(p => p.time);
            const watts = history.map(p => p.real_power_w);
            const loadPct = history.map(p => p.load_pct);
            const inVolt = history.map(p => p.input_voltage);
            const outVolt = history.map(p => p.output_voltage);

            powerChart.data.labels = labels;
            powerChart.data.datasets[0].data = watts;
            powerChart.data.datasets[1].data = loadPct;
            powerChart.update('none');

            voltageChart.data.labels = labels;
            voltageChart.data.datasets[0].data = inVolt;
            voltageChart.data.datasets[1].data = outVolt;
            voltageChart.update('none');
        }
    } catch (e) {
        console.error('Erro ao carregar histórico:', e);
    }
}

// Polling ativo contínuo
async function fetchStatusNow(isManual = false) {
    if (isPollingActive && !isManual) return;
    isPollingActive = true;

    const btn = document.getElementById('refresh-btn');
    if (isManual && btn) btn.classList.add('animate-spin');

    try {
        const res = await fetch('/api/status?t=' + Date.now(), { cache: 'no-store' });
        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data && data.connected) {
            updateUI(data);
            appendChartPoint(data);
            if (data.plans_data) {
                syncPlansState(data.plans_data);
            }
        } else if (data && !data.connected) {
            showDisconnected(data.error || 'Sem ligação ao NUT');
        }
    } catch (e) {
        // Ignora
    } finally {
        isPollingActive = false;
        if (isManual && btn) {
            setTimeout(() => btn.classList.remove('animate-spin'), 300);
        }
    }
}

// SSE Push Stream
function connectSSE() {
    if (sseSource) {
        sseSource.close();
    }

    try {
        sseSource = new EventSource('/api/stream');

        sseSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data && data.connected) {
                    updateUI(data);
                    appendChartPoint(data);
                    if (data.plans_data) {
                        syncPlansState(data.plans_data);
                    }
                }
            } catch (e) {}
        };

        sseSource.onerror = () => {
            sseSource.close();
            setTimeout(connectSSE, 5000);
        };
    } catch (e) {}
}

function appendChartPoint(data) {
    if (!powerChart || !voltageChart) return;
    const timeStr = data.formatted_time;
    const maxPoints = 45;

    const lastLabel = powerChart.data.labels[powerChart.data.labels.length - 1];
    if (lastLabel === timeStr) return;

    // Power chart update
    powerChart.data.labels.push(timeStr);
    powerChart.data.datasets[0].data.push(data.output.real_power_w);
    powerChart.data.datasets[1].data.push(data.output.load_pct);
    if (powerChart.data.labels.length > maxPoints) {
        powerChart.data.labels.shift();
        powerChart.data.datasets[0].data.shift();
        powerChart.data.datasets[1].data.shift();
    }
    powerChart.update('none');

    // Voltage chart update
    voltageChart.data.labels.push(timeStr);
    voltageChart.data.datasets[0].data.push(data.input.voltage);
    voltageChart.data.datasets[1].data.push(data.output.voltage);
    if (voltageChart.data.labels.length > maxPoints) {
        voltageChart.data.labels.shift();
        voltageChart.data.datasets[0].data.shift();
        voltageChart.data.datasets[1].data.shift();
    }
    voltageChart.update('none');
}

// Update UI elements across Overview, Telemetria & Variáveis
function updateUI(data) {
    const s = data.status;
    const dev = data.device;
    const batt = data.battery;
    const inp = data.input;
    const bkp = data.bypass;
    const out = data.output;

    // Status Pill & Clock
    const statusPill = document.getElementById('status-pill');
    const statusText = document.getElementById('status-text');
    const lastUpdate = document.getElementById('last-update');

    if (lastUpdate) lastUpdate.innerText = data.formatted_time;
    if (statusText) statusText.innerText = s.label.toUpperCase();

    if (statusPill) {
        if (s.is_on_battery) {
            statusPill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-500/40 bg-amber-50 text-amber-800 text-xs font-bold shadow-xs';
        } else if (s.is_online) {
            statusPill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/40 bg-emerald-50 text-emerald-700 text-xs font-bold shadow-xs';
        }
    }

    // Alarm Banner
    const alarmBanner = document.getElementById('alarm-banner');
    const alarmMsg = document.getElementById('alarm-message');
    const alarmStatusCode = document.getElementById('alarm-status-code');
    
    if (s.has_alarm) {
        if (alarmBanner) alarmBanner.classList.remove('hidden');
        if (alarmMsg) alarmMsg.innerText = s.alarm_text || 'Alerta reportado pelo UPS';
        if (alarmStatusCode) alarmStatusCode.innerText = s.raw;
    } else {
        if (alarmBanner) alarmBanner.classList.add('hidden');
    }

    // Power Flow Section
    setText('flow-in-voltage', inp.voltage.toFixed(1));
    setText('flow-in-freq', inp.frequency.toFixed(1));
    setText('flow-in-current', inp.current.toFixed(1));

    setText('flow-power-factor', out.power_factor.toFixed(2));
    setText('flow-batt-charge', batt.charge_pct.toFixed(0));
    setText('flow-batt-volt', batt.voltage.toFixed(1));
    setText('flow-batt-curr', batt.current.toFixed(2));

    setText('flow-load-watts', out.real_power_w.toFixed(0));
    setText('flow-load-pct', out.load_pct.toFixed(1));
    setText('flow-out-volt', out.voltage.toFixed(1));

    // Bypass Status
    const bypassLed = document.getElementById('bypass-led');
    const bypassDesc = document.getElementById('bypass-status-desc');
    if (bkp.voltage > 10) {
        if (bypassLed) bypassLed.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block';
        if (bypassDesc) bypassDesc.innerText = `${bkp.voltage.toFixed(1)} V (${bkp.frequency.toFixed(1)} Hz) - Normal`;
    } else {
        if (bypassLed) bypassLed.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 inline-block';
        if (bypassDesc) bypassDesc.innerText = `${bkp.voltage.toFixed(1)} V (Inativo / Falha)`;
    }

    // Overview KPI Cards
    setText('kpi-load-pct', `${out.load_pct.toFixed(1)}%`);
    setText('kpi-load-w', `${out.real_power_w.toFixed(0)} W`);
    setText('kpi-load-va', `${out.apparent_power_va.toFixed(0)} VA`);
    const loadBar = document.getElementById('kpi-load-bar');
    if (loadBar) loadBar.style.width = `${Math.min(100, Math.max(0, out.load_pct))}%`;

    setText('kpi-batt-pct', `${batt.charge_pct.toFixed(0)}%`);
    setText('kpi-batt-volt', `${batt.voltage.toFixed(1)} V`);
    setText('kpi-batt-curr', `${batt.current.toFixed(2)} A`);
    const battBar = document.getElementById('kpi-batt-bar');
    if (battBar) battBar.style.width = `${Math.min(100, Math.max(0, batt.charge_pct))}%`;

    setText('kpi-in-volt', `${inp.voltage.toFixed(1)} V`);
    setText('kpi-in-freq', `${inp.frequency.toFixed(2)} Hz`);
    setText('kpi-in-curr', `${inp.current.toFixed(1)} A`);
    setText('kpi-in-pf', inp.power_factor.toFixed(2));

    setText('kpi-out-volt', `${out.voltage.toFixed(1)} V`);
    setText('kpi-out-freq', `${out.frequency.toFixed(2)} Hz`);
    setText('kpi-out-curr', `${out.current.toFixed(1)} A`);
    setText('kpi-out-pf', out.power_factor.toFixed(2));

    // Telemetry Dedicated View Detailed Metrics
    setText('telem-in-volt', `${inp.voltage.toFixed(1)} V`);
    setText('telem-in-freq', `${inp.frequency.toFixed(2)} Hz`);
    setText('telem-in-curr', `${inp.current.toFixed(1)} A`);
    setText('telem-in-pf', inp.power_factor.toFixed(2));

    setText('telem-out-volt', `${out.voltage.toFixed(1)} V`);
    setText('telem-out-freq', `${out.frequency.toFixed(2)} Hz`);
    setText('telem-out-w', `${out.real_power_w.toFixed(0)} W (${out.load_pct.toFixed(1)}%)`);
    setText('telem-out-va', `${out.apparent_power_va.toFixed(0)} VA`);

    setText('telem-batt-pct', `${batt.charge_pct.toFixed(0)}%`);
    setText('telem-batt-volt', `${batt.voltage.toFixed(1)} V`);
    setText('telem-batt-curr', `${batt.current.toFixed(2)} A`);
    setText('telem-bypass-volt', `${bkp.voltage.toFixed(1)} V`);

    // Raw vars
    currentRawVars = data.raw_vars || {};
    if (currentSubView === 'vars') {
        renderRawVarsTable(currentRawVars);
    }
}

function showDisconnected(errMsg) {
    const statusPill = document.getElementById('status-pill');
    const statusText = document.getElementById('status-text');
    if (statusPill) {
        statusPill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full border border-rose-500/40 bg-rose-50 text-rose-700 text-xs font-bold';
    }
    if (statusText) statusText.innerText = 'DESCONECTADO';
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

// ------------------------------------------------------------- //
// ALTERAÇÃO DE SENHA DO UTILIZADOR                             //
// ------------------------------------------------------------- //

function openChangePasswordModal() {
    swalEnging.fire({
        title: 'Alterar Senha de Acesso',
        html: `
            <div class="text-left space-y-3.5 mt-2 font-sans">
                <div>
                    <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Senha Atual</label>
                    <input id="swal-old-pass" type="password" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange" placeholder="Senha atual">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Nova Senha</label>
                    <input id="swal-new-pass" type="password" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange" placeholder="Mínimo 4 caracteres">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Confirmar Nova Senha</label>
                    <input id="swal-conf-pass" type="password" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange" placeholder="Repita a nova senha">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Atualizar Senha',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
            const old_password = document.getElementById('swal-old-pass').value;
            const new_password = document.getElementById('swal-new-pass').value;
            const conf_password = document.getElementById('swal-conf-pass').value;

            if (!old_password) {
                Swal.showValidationMessage('Informe a sua senha atual.');
                return false;
            }
            if (new_password.length < 4) {
                Swal.showValidationMessage('A nova senha deve ter no mínimo 4 caracteres.');
                return false;
            }
            if (new_password !== conf_password) {
                Swal.showValidationMessage('As senhas digitadas não coincidem.');
                return false;
            }
            return { old_password, new_password };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: 'Sucesso!',
                        text: data.message,
                        timer: 2000,
                        showConfirmButton: false
                    });
                } else {
                    swalEnging.fire('Erro', data.message, 'error');
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao alterar senha: ' + e, 'error');
            }
        }
    });
}

// ------------------------------------------------------------- //
// VARIÁVEIS BRUTAS DO NUT (PÁGINA COMPLETA & FILTRAGEM)         //
// ------------------------------------------------------------- //

function setVarCategoryFilter(cat) {
    currentVarCategory = cat;
    
    // Atualizar botões de filtro
    const buttons = document.querySelectorAll('.var-filter-btn');
    buttons.forEach(btn => {
        if (btn.innerText.toLowerCase().includes(cat) || (cat === 'all' && btn.innerText.includes('Todos'))) {
            btn.className = 'var-filter-btn px-3 py-1.5 rounded-lg bg-enging-orange text-white font-bold transition';
        } else {
            btn.className = 'var-filter-btn px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium transition';
        }
    });

    filterRawVars();
}

function filterRawVars() {
    const searchEl = document.getElementById('var-search');
    const query = searchEl ? searchEl.value.toLowerCase().trim() : '';
    const filtered = {};

    for (const [k, v] of Object.entries(currentRawVars)) {
        // Filtro por categoria
        let matchesCategory = true;
        if (currentVarCategory === 'battery') matchesCategory = k.startsWith('battery.');
        else if (currentVarCategory === 'input') matchesCategory = k.startsWith('input.');
        else if (currentVarCategory === 'output') matchesCategory = k.startsWith('output.');
        else if (currentVarCategory === 'ups') matchesCategory = k.startsWith('ups.');
        else if (currentVarCategory === 'device') matchesCategory = k.startsWith('device.');

        // Filtro por texto de pesquisa
        let matchesQuery = true;
        if (query) {
            matchesQuery = k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query);
        }

        if (matchesCategory && matchesQuery) {
            filtered[k] = v;
        }
    }

    renderRawVarsTable(filtered);
}

function renderRawVarsTable(varsObj) {
    const tbody = document.getElementById('raw-vars-tbody');
    if (!tbody) return;

    const keys = Object.keys(varsObj).sort();

    if (keys.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-slate-400 italic">Nenhuma variável encontrada com os filtros selecionados.</td></tr>`;
        return;
    }

    tbody.innerHTML = keys.map(k => {
        const cat = k.split('.')[0] || 'geral';
        const catBadge = cat === 'battery' 
            ? '<span class="px-2 py-0.5 rounded-md bg-blue-50 text-enging-blue text-[10px] font-bold border border-blue-200">bateria</span>'
            : cat === 'input'
            ? '<span class="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">entrada</span>'
            : cat === 'output'
            ? '<span class="px-2 py-0.5 rounded-md bg-orange-50 text-enging-orange text-[10px] font-bold border border-orange-200">saída</span>'
            : '<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold border border-slate-200">' + cat + '</span>';

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3.5 text-enging-navy font-bold">${k}</td>
                <td class="p-3.5 text-slate-800 font-medium">${varsObj[k]}</td>
                <td class="p-3.5 text-right">${catBadge}</td>
            </tr>
        `;
    }).join('');
}

function copyRawVarsJson() {
    navigator.clipboard.writeText(JSON.stringify(currentRawVars, null, 2)).then(() => {
        swalEnging.fire({
            icon: 'success',
            title: 'Copiado!',
            text: 'Todas as variáveis NUT foram copiadas em formato JSON.',
            timer: 1500,
            showConfirmButton: false
        });
    });
}

// ------------------------------------------------------------- //
// ORQUESTRADOR DE MÚLTIPLOS PLANOS (LINGUETAS COM "NOVO PLANO") //
// ------------------------------------------------------------- //

async function loadPlansData() {
    try {
        const res = await fetch('/api/plans', { cache: 'no-cache' });
        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }
        if (!res.ok) return;
        allPlansData = await res.json();
        
        if (!selectedPlanId && allPlansData.plans && allPlansData.plans.length > 0) {
            selectedPlanId = allPlansData.plans[0].id;
        }

        renderPlansTabsAndPanel();
    } catch (e) {
        console.error('Erro ao carregar planos:', e);
    }
}

function syncPlansState(plansData) {
    allPlansData = plansData;
    renderActiveBanners();
    
    if (selectedPlanId) {
        const activePlan = (allPlansData.plans || []).find(p => p.id === selectedPlanId);
        if (activePlan) {
            updateActivePlanStatusUI(activePlan);
        }
    }
}

function renderActiveBanners() {
    const container = document.getElementById('active-plans-banner-container');
    if (!container) return;

    const activePlans = (allPlansData.plans || []).filter(p => p.state && (p.state.status === 'countdown' || p.state.status === 'running'));
    
    if (activePlans.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = activePlans.map(p => {
        const isCountdown = p.state.status === 'countdown';
        const msg = isCountdown 
            ? `Contagem regressiva de segurança: <strong>${p.state.countdown_remaining}s restantes</strong> antes de iniciar o desligamento...`
            : `Desligando alvo atual: <strong>${p.state.current_server || 'Executando alvos em sequência'}</strong>...`;

        return `
            <div class="rounded-2xl border border-rose-300 bg-rose-50 p-4 shadow-md flex items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                    <div class="p-2.5 rounded-xl bg-rose-100 text-rose-600 border border-rose-200">
                        <i data-lucide="shield-alert" class="w-6 h-6 animate-bounce"></i>
                    </div>
                    <div>
                        <h3 class="text-sm font-black text-rose-900 uppercase tracking-wide">PLANO EM EXECUÇÃO: ${p.name}</h3>
                        <p class="text-xs text-rose-800 mt-0.5">${msg}</p>
                    </div>
                </div>
                <button onclick="cancelPlanExecution('${p.id}')" class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition flex items-center gap-2">
                    <i data-lucide="x-octagon" class="w-4 h-4"></i> CANCELAR PLANO
                </button>
            </div>
        `;
    }).join('');

    lucide.createIcons();
}

function selectPlanTab(planId) {
    selectedPlanId = planId;
    renderPlansTabsAndPanel();
}

function renderPlansTabsAndPanel() {
    const tabsBar = document.getElementById('plan-tabs-bar');
    const panelContainer = document.getElementById('active-plan-panel-container');
    if (!tabsBar || !panelContainer) return;

    const plans = allPlansData.plans || [];

    if (plans.length === 0) {
        tabsBar.innerHTML = '';
        panelContainer.innerHTML = `
            <div class="p-10 text-center text-slate-500 rounded-2xl bg-white border border-slate-200 shadow-sm">
                <i data-lucide="layers" class="w-12 h-12 mx-auto mb-3 text-slate-400"></i>
                <h3 class="text-base font-bold text-enging-navy">Nenhum plano configurado</h3>
                <p class="text-xs text-slate-500 mt-1 mb-4">Crie o seu primeiro plano de desligamento em estágios (ex: VMs 60%, Hosts 15%).</p>
                <button onclick="openCreatePlanModal()" class="px-4 py-2.5 rounded-xl bg-enging-orange hover:bg-enging-orange-hover text-white font-bold text-xs shadow-md shadow-enging-orange/20">
                    + Criar Novo Plano
                </button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    if (!selectedPlanId || !plans.some(p => p.id === selectedPlanId)) {
        selectedPlanId = plans[0].id;
    }

    // 1. Renderiza as Linguetas / Tabs (com botão "+ Novo Plano")
    tabsBar.innerHTML = plans.map(p => {
        const isSelected = p.id === selectedPlanId;
        const activeClass = isSelected 
            ? 'bg-white border-enging-orange text-enging-navy shadow-xs font-bold border-b-2'
            : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-enging-navy hover:bg-slate-100 font-medium border-b';

        return `
            <button onclick="selectPlanTab('${p.id}')" class="px-4 py-3 rounded-t-xl border-t border-x ${activeClass} transition flex items-center gap-2.5 whitespace-nowrap text-xs">
                <span class="w-2 h-2 rounded-full ${p.enabled ? 'bg-emerald-500' : 'bg-slate-400'}"></span>
                <span>${p.name}</span>
                <span class="px-2 py-0.5 rounded-full bg-orange-50 text-enging-orange border border-orange-200 font-mono text-[10px] font-bold">
                    ≤ ${p.trigger_battery_pct}%
                </span>
            </button>
        `;
    }).join('') + `
        <button onclick="openCreatePlanModal()" class="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-enging-orange border border-slate-200 text-xs font-bold transition flex items-center gap-1.5 ml-1 shadow-xs" title="Adicionar Novo Plano">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i> Novo Plano
        </button>
    `;

    // 2. Renderiza o Painel do Plano Ativo
    const activePlan = plans.find(p => p.id === selectedPlanId) || plans[0];
    const servers = activePlan.servers || [];

    const serverRows = servers.length === 0 
        ? `<tr><td colspan="6" class="p-6 text-center text-slate-400 italic">Nenhum servidor ou VM configurado neste plano. Clique em "+ Adicionar Alvo".</td></tr>`
        : servers.map(s => {
            const methodBadge = s.method === 'ssh' 
                ? '<span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-enging-navy border border-slate-200 font-mono text-[10px] font-bold">SSH Linux</span>'
                : s.method === 'windows_ssh'
                ? '<span class="px-2.5 py-0.5 rounded-full bg-blue-50 text-enging-blue border border-blue-200 font-mono text-[10px] font-bold">SSH Windows</span>'
                : s.method === 'local_command'
                ? '<span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10px] font-bold">Host Local NUT</span>'
                : '<span class="px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-mono text-[10px] font-bold">Webhook API</span>';

            let testBadge = '<span class="text-slate-400 italic text-[11px]">Não testado</span>';
            if (s.last_test) {
                testBadge = s.last_test.success 
                    ? `<span class="inline-flex items-center gap-1 text-emerald-600 text-[11px] font-bold"><i data-lucide="check-circle" class="w-3.5 h-3.5"></i> OK</span>`
                    : `<span class="inline-flex items-center gap-1 text-rose-600 text-[11px] font-bold" title="${s.last_test.message}"><i data-lucide="alert-circle" class="w-3.5 h-3.5"></i> Erro</span>`;
            }

            return `
                <tr class="hover:bg-slate-50 transition text-xs">
                    <td class="p-3.5">
                        <div class="font-bold text-enging-navy">${s.name}</div>
                        <div class="text-[11px] text-slate-500 font-mono truncate max-w-sm mt-0.5" title="${s.custom_command}">${s.custom_command || 'Padrão'}</div>
                    </td>
                    <td class="p-3.5 font-mono text-slate-600 font-medium">${s.host || s.webhook_url || 'local'}:${s.port || 22}</td>
                    <td class="p-3.5">${methodBadge}</td>
                    <td class="p-3.5 font-mono text-enging-orange font-black">${s.delay_sec || 0}s</td>
                    <td class="p-3.5">${testBadge}</td>
                    <td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">
                        <button onclick="testServerConnection('${activePlan.id}', '${s.id}')" title="Testar Conexão" class="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-enging-navy border border-slate-200 transition">
                            <i data-lucide="zap" class="w-3.5 h-3.5 text-enging-orange"></i>
                        </button>
                        <button onclick="manualShutdownSingle('${activePlan.id}', '${s.id}')" title="Desligar Individual" class="p-2 rounded-xl bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-700 border border-slate-200 transition">
                            <i data-lucide="power" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="openAddServerModal('${activePlan.id}', '${s.id}')" title="Editar" class="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-enging-navy border border-slate-200 transition">
                            <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="deleteServer('${activePlan.id}', '${s.id}', '${s.name}')" title="Remover" class="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-rose-600 border border-slate-200 transition">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

    panelContainer.innerHTML = `
        <div class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            
            <!-- Plan Header & Controls -->
            <div class="p-5 sm:p-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <div class="flex items-center gap-3">
                        <h3 class="text-base font-bold text-enging-navy">${activePlan.name}</h3>
                        <span id="plan-status-pill" class="px-3 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold">
                            ${activePlan.enabled ? 'Pronto (Em Espera)' : 'Desativado'}
                        </span>
                    </div>
                    <p class="text-xs text-slate-500 mt-1 font-medium">${activePlan.description || 'Sem descrição'} • <span class="text-enging-navy font-bold">${servers.length} alvos configurados</span></p>
                </div>

                <!-- Plan Action Buttons -->
                <div class="flex flex-wrap items-center gap-2">
                    <button onclick="openAddServerModal('${activePlan.id}')" class="px-3.5 py-2 rounded-xl bg-enging-orange hover:bg-enging-orange-hover text-white font-bold text-xs shadow-md shadow-enging-orange/20 transition flex items-center gap-1.5">
                        <i data-lucide="plus-circle" class="w-4 h-4"></i> Adicionar Alvo
                    </button>
                    <button onclick="runPlanDryRun('${activePlan.id}')" class="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-enging-navy border border-slate-200 font-bold text-xs transition flex items-center gap-1.5">
                        <i data-lucide="play" class="w-4 h-4 text-emerald-600"></i> Simular (Dry-Run)
                    </button>
                    <button onclick="runPlanNow('${activePlan.id}', '${activePlan.name}')" class="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-rose-50 text-rose-600 hover:text-rose-700 border border-slate-200 font-bold text-xs transition flex items-center gap-1.5">
                        <i data-lucide="power" class="w-4 h-4"></i> Executar Agora
                    </button>
                    <button onclick="openCreatePlanModal('${activePlan.id}')" class="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-enging-navy border border-slate-200 transition" title="Configurações do Plano">
                        <i data-lucide="settings" class="w-4 h-4"></i>
                    </button>
                    <button onclick="deletePlan('${activePlan.id}', '${activePlan.name}')" class="p-2 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 transition" title="Excluir Plano">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>

            <!-- Plan Quick Parameters Bar -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-slate-50/80 border-b border-slate-100 text-xs">
                <div class="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <div class="p-2.5 rounded-xl bg-orange-50 text-enging-orange">
                        <i data-lucide="zap" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <span class="text-[11px] text-slate-500 block uppercase font-bold">Nível de Disparo</span>
                        <strong class="text-sm font-mono font-black text-enging-orange">Bateria ≤ ${activePlan.trigger_battery_pct}%</strong>
                    </div>
                </div>

                <div class="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <div class="p-2.5 rounded-xl bg-blue-50 text-enging-blue">
                        <i data-lucide="clock" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <span class="text-[11px] text-slate-500 block uppercase font-bold">Tempo de Carência</span>
                        <strong class="text-sm font-mono font-black text-enging-navy">${activePlan.grace_period_sec || 10} segundos</strong>
                    </div>
                </div>

                <div class="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <div class="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                        <i data-lucide="shield-check" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <span class="text-[11px] text-slate-500 block uppercase font-bold">Condição Obrigatória</span>
                        <strong class="text-sm font-bold text-emerald-700">${activePlan.require_on_battery ? 'Modo Bateria (OB)' : 'Qualquer Modo'}</strong>
                    </div>
                </div>
            </div>

            <!-- Plan Servers Table -->
            <div class="overflow-x-auto">
                <table class="w-full text-left">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200 text-[11px] uppercase tracking-wider font-bold">
                        <tr>
                            <th class="p-3.5 text-enging-navy">Alvo / Máquina Virtual / Comando</th>
                            <th class="p-3.5 text-enging-navy">Endereço & Porta</th>
                            <th class="p-3.5 text-enging-navy">Método</th>
                            <th class="p-3.5 text-enging-navy">Delay</th>
                            <th class="p-3.5 text-enging-navy">Último Teste</th>
                            <th class="p-3.5 text-right text-enging-navy">Ações</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 bg-white">
                        ${serverRows}
                    </tbody>
                </table>
            </div>

        </div>
    `;

    lucide.createIcons();
}

function updateActivePlanStatusUI(plan) {
    const pill = document.getElementById('plan-status-pill');
    if (!pill || !plan.state) return;

    const st = plan.state.status;
    if (st === 'running') {
        pill.className = 'px-3 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200 text-xs font-black animate-pulse';
        pill.innerText = 'Em Execução';
    } else if (st === 'countdown') {
        pill.className = 'px-3 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-xs font-black animate-bounce';
        pill.innerText = `Carência (${plan.state.countdown_remaining}s)`;
    } else if (st === 'completed') {
        pill.className = 'px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold';
        pill.innerText = 'Concluído';
    } else if (st === 'cancelled') {
        pill.className = 'px-3 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-xs font-semibold';
        pill.innerText = 'Cancelado';
    } else {
        pill.className = plan.enabled 
            ? 'px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold'
            : 'px-3 py-1 rounded-full bg-slate-100 text-slate-400 border border-slate-200 text-xs font-semibold';
        pill.innerText = plan.enabled ? 'Pronto (Em Espera)' : 'Desativado';
    }
}

function openCreatePlanModal(planId = null) {
    const isEdit = !!planId;
    const p = isEdit ? (allPlansData.plans || []).find(x => x.id === planId) : {
        id: '',
        name: '',
        description: '',
        trigger_battery_pct: 50.0,
        require_on_battery: true,
        grace_period_sec: 10,
        enabled: true
    };

    if (!p) return;

    swalEnging.fire({
        title: isEdit ? 'Editar Plano de Desligamento' : 'Criar Novo Plano de Desligamento',
        html: `
            <div class="text-left space-y-3.5 mt-2 font-sans">
                <div>
                    <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Nome do Plano</label>
                    <input id="swal-plan-name" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange" placeholder="Ex: Estágio 1 - VMs Dev (60%)" value="${p.name}">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Descrição / Finalidade</label>
                    <input id="swal-plan-desc" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange" placeholder="Ex: Desliga máquinas virtuais não críticas" value="${p.description || ''}">
                </div>
                
                <div class="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div>
                        <div class="flex justify-between items-center mb-1">
                            <label class="block text-xs font-bold text-enging-orange uppercase">Trigger Bateria</label>
                            <span id="swal-plan-pct-val" class="text-xs font-mono font-black text-enging-orange">${p.trigger_battery_pct}%</span>
                        </div>
                        <input id="swal-plan-pct" type="range" min="1" max="95" step="1" value="${p.trigger_battery_pct}" oninput="document.getElementById('swal-plan-pct-val').innerText = this.value + '%'" class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-enging-orange">
                        <p class="text-[10px] text-slate-500 mt-1">Dispara quando bateria ≤ X%</p>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Carência (s)</label>
                        <input id="swal-plan-grace" type="number" min="0" max="300" class="w-full px-3 py-1.5 text-xs font-mono rounded-xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange" value="${p.grace_period_sec || 10}">
                        <p class="text-[10px] text-slate-500 mt-1">Tempo antes de iniciar</p>
                    </div>
                </div>

                <div class="space-y-2 pt-1">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="swal-plan-req-batt" ${p.require_on_battery ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-enging-orange focus:ring-enging-orange">
                        <label for="swal-plan-req-batt" class="text-xs text-slate-700 font-medium cursor-pointer">Exigir que a UPS esteja em modo de bateria (OB)</label>
                    </div>
                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="swal-plan-enabled" ${p.enabled ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-enging-orange focus:ring-enging-orange">
                        <label for="swal-plan-enabled" class="text-xs text-slate-700 font-medium cursor-pointer">Plano Ativado para Disparo Automático</label>
                    </div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: isEdit ? 'Atualizar Plano' : 'Criar Plano',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
            const name = document.getElementById('swal-plan-name').value.trim();
            const description = document.getElementById('swal-plan-desc').value.trim();
            const trigger_battery_pct = parseFloat(document.getElementById('swal-plan-pct').value);
            const grace_period_sec = parseInt(document.getElementById('swal-plan-grace').value) || 10;
            const require_on_battery = document.getElementById('swal-plan-req-batt').checked;
            const enabled = document.getElementById('swal-plan-enabled').checked;

            if (!name) {
                Swal.showValidationMessage('Informe o nome do plano.');
                return false;
            }

            return {
                id: p.id || undefined,
                name,
                description,
                trigger_battery_pct,
                grace_period_sec,
                require_on_battery,
                enabled
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/plans', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: isEdit ? 'Plano Atualizado!' : 'Plano Criado!',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    if (data.plan && data.plan.id) {
                        selectedPlanId = data.plan.id;
                    }
                    loadPlansData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao salvar plano: ' + e, 'error');
            }
        }
    });
}

function deletePlan(planId, planName) {
    swalEnging.fire({
        title: 'Excluir Plano?',
        html: `Tem certeza que deseja excluir <strong>${planName}</strong> e todos os seus alvos?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sim, Excluir',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/plans/${planId}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: 'Plano excluído!',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    selectedPlanId = null;
                    loadPlansData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao excluir plano: ' + e, 'error');
            }
        }
    });
}

function openAddServerModal(planId, serverId = null) {
    const plan = (allPlansData.plans || []).find(x => x.id === planId);
    if (!plan) return;

    const isEdit = !!serverId;
    const s = isEdit ? (plan.servers || []).find(x => x.id === serverId) : {
        id: '',
        name: '',
        host: '',
        port: 22,
        method: 'ssh',
        username: 'root',
        password: '',
        sudo: false,
        custom_command: 'shutdown -h now',
        delay_sec: 0,
        enabled: true,
        webhook_url: '',
        webhook_method: 'POST'
    };

    if (!s) return;

    swalEnging.fire({
        title: isEdit ? `Editar Alvo em [${plan.name}]` : `Adicionar Alvo a [${plan.name}]`,
        html: `
            <div class="text-left space-y-3.5 mt-2 font-sans">
                <div>
                    <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Nome do Alvo / VM</label>
                    <input id="swal-srv-name" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange" placeholder="Ex: Proxmox VMs Dev (101 a 108), ESXi Node 01, Host Local" value="${s.name}">
                </div>
                
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Método</label>
                        <select id="swal-srv-method" onchange="toggleMethodFields()" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange">
                            <option value="ssh" ${s.method === 'ssh' ? 'selected' : ''}>SSH (Linux / Proxmox / ESXi)</option>
                            <option value="windows_ssh" ${s.method === 'windows_ssh' ? 'selected' : ''}>SSH (Windows Server)</option>
                            <option value="local_command" ${s.method === 'local_command' ? 'selected' : ''}>Comando Local no Host NUT</option>
                            <option value="webhook" ${s.method === 'webhook' ? 'selected' : ''}>Webhook / HTTP API</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Delay Sequencial (s)</label>
                        <input id="swal-srv-delay" type="number" min="0" max="600" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange" value="${s.delay_sec || 0}" placeholder="0">
                    </div>
                </div>

                <div id="ssh-fields" class="space-y-3">
                    <div class="grid grid-cols-3 gap-3">
                        <div class="col-span-2">
                            <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Endereço IP / Hostname</label>
                            <input id="swal-srv-host" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" placeholder="10.255.255.10" value="${s.host}">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Porta</label>
                            <input id="swal-srv-port" type="number" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" value="${s.port || 22}">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Utilizador</label>
                            <input id="swal-srv-user" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" placeholder="root / admin" value="${s.username}">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Senha</label>
                            <input id="swal-srv-pass" type="password" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" placeholder="${isEdit ? '(Manter atual ou alterar)' : 'Senha'}" value="${s.password}">
                        </div>
                    </div>

                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="swal-srv-sudo" ${s.sudo ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-enging-orange focus:ring-enging-orange">
                        <label for="swal-srv-sudo" class="text-xs text-slate-700 font-medium cursor-pointer">Executar com sudo</label>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Comando Personalizado de Desligamento</label>
                        <input id="swal-srv-cmd" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" value="${s.custom_command}">
                        <p class="text-[10px] text-slate-500 mt-1">Ex: <code class="text-enging-navy font-bold">qm shutdown 101</code> ou <code class="text-enging-navy font-bold">esxcli system shutdown poweroff</code></p>
                    </div>
                </div>

                <div id="webhook-fields" class="space-y-3 hidden">
                    <div>
                        <label class="block text-xs font-bold text-slate-700 uppercase mb-1">URL do Webhook / API</label>
                        <input id="swal-srv-webhook-url" class="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" placeholder="https://api.proxmox:8006/..." value="${s.webhook_url || ''}">
                    </div>
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: isEdit ? 'Atualizar Alvo' : 'Adicionar Alvo',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        didOpen: () => {
            window.toggleMethodFields = () => {
                const method = document.getElementById('swal-srv-method').value;
                const sshBox = document.getElementById('ssh-fields');
                const hookBox = document.getElementById('webhook-fields');
                const cmdInput = document.getElementById('swal-srv-cmd');
                if (method === 'webhook') {
                    sshBox.classList.add('hidden');
                    hookBox.classList.remove('hidden');
                } else if (method === 'local_command') {
                    sshBox.classList.remove('hidden');
                    hookBox.classList.add('hidden');
                    document.getElementById('swal-srv-host').value = '127.0.0.1';
                } else {
                    sshBox.classList.remove('hidden');
                    hookBox.classList.add('hidden');
                    if (method === 'windows_ssh' && cmdInput.value === 'shutdown -h now') {
                        cmdInput.value = 'shutdown /s /t 0 /f';
                    }
                }
            };
            window.toggleMethodFields();
        },
        preConfirm: () => {
            const name = document.getElementById('swal-srv-name').value.trim();
            const method = document.getElementById('swal-srv-method').value;
            const delay_sec = parseInt(document.getElementById('swal-srv-delay').value) || 0;

            if (!name) {
                Swal.showValidationMessage('Por favor informe o nome do alvo.');
                return false;
            }

            const serverPayload = {
                id: s.id || undefined,
                name: name,
                method: method,
                delay_sec: delay_sec,
                enabled: true
            };

            if (method === 'webhook') {
                serverPayload.webhook_url = document.getElementById('swal-srv-webhook-url').value.trim();
                serverPayload.webhook_method = 'POST';
                if (!serverPayload.webhook_url) {
                    Swal.showValidationMessage('Informe a URL do Webhook.');
                    return false;
                }
            } else {
                serverPayload.host = document.getElementById('swal-srv-host').value.trim();
                serverPayload.port = parseInt(document.getElementById('swal-srv-port').value) || 22;
                serverPayload.username = document.getElementById('swal-srv-user').value.trim();
                serverPayload.password = document.getElementById('swal-srv-pass').value;
                serverPayload.sudo = document.getElementById('swal-srv-sudo').checked;
                serverPayload.custom_command = document.getElementById('swal-srv-cmd').value.trim();
            }

            return serverPayload;
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/plans/${planId}/server`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: isEdit ? 'Alvo Atualizado' : 'Alvo Adicionado',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    loadPlansData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao salvar alvo: ' + e, 'error');
            }
        }
    });
}

function deleteServer(planId, serverId, serverName) {
    swalEnging.fire({
        title: 'Remover Alvo?',
        html: `Tem certeza que deseja remover <strong>${serverName}</strong> deste plano?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sim, Remover',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/plans/${planId}/server/${serverId}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: 'Removido com sucesso!',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    loadPlansData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao remover alvo: ' + e, 'error');
            }
        }
    });
}

async function testServerConnection(planId, serverId) {
    swalEnging.fire({
        title: 'Testando Conexão...',
        text: 'A estabelecer ligação de teste...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`/api/plans/${planId}/server/${serverId}/test`, { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            swalEnging.fire({
                icon: 'success',
                title: 'Conexão Bem-Sucedida! 🟢',
                html: `
                    <div class="text-left space-y-2 mt-2 font-mono text-xs">
                        <p class="text-emerald-700 font-bold">${data.message}</p>
                        ${data.output ? `<pre class="p-3 rounded-xl bg-slate-100 border border-slate-200 text-slate-800 overflow-x-auto">${data.output}</pre>` : ''}
                    </div>
                `
            });
        } else {
            swalEnging.fire({
                icon: 'error',
                title: 'Falha na Conexão! 🔴',
                html: `<div class="text-left font-mono text-xs text-rose-700 font-bold p-2">${data.message}</div>`
            });
        }
        loadPlansData();
    } catch (e) {
        swalEnging.fire('Erro', 'Falha ao contactar API: ' + e, 'error');
    }
}

async function manualShutdownSingle(planId, serverId) {
    const plan = (allPlansData.plans || []).find(x => x.id === planId);
    if (!plan) return;
    const s = (plan.servers || []).find(x => x.id === serverId);
    if (!s) return;

    swalEnging.fire({
        title: `Desligar ${s.name}?`,
        html: `
            <p class="text-amber-800 font-bold mb-2">Atenção: Esta ação enviará a ordem imediata para:</p>
            <p class="font-mono text-xs text-slate-800 bg-slate-100 p-2.5 rounded-xl border border-slate-200">${s.host || s.webhook_url} (${s.custom_command || 'shutdown'})</p>
        `,
        icon: 'warning',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonColor: '#e11d48',
        denyButtonColor: '#223546',
        confirmButtonText: 'Sim, Executar Imediatamente',
        denyButtonText: 'Simular Apenas (Dry-Run)',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed || result.isDenied) {
            const dry_run = result.isDenied;
            swalEnging.fire({
                title: dry_run ? 'Executando Simulação...' : 'Enviando Comando...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            try {
                const res = await fetch(`/api/plans/${planId}/server/${serverId}/execute`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dry_run })
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: dry_run ? 'Simulação OK' : 'Comando Enviado',
                        text: data.message
                    });
                } else {
                    swalEnging.fire('Erro', data.message, 'error');
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha na execução: ' + e, 'error');
            }
        }
    });
}

function runPlanDryRun(planId) {
    swalEnging.fire({
        title: 'Simular Execução deste Plano?',
        text: 'Isto executará o ciclo de desligamento deste plano em Modo de Simulação (Dry-Run), respeitando a contagem regressiva e os atrasos sem desligar máquinas reais.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Iniciar Simulação',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/plans/${planId}/trigger`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dry_run: true })
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'info',
                        title: 'Simulação Iniciada!',
                        text: 'Acompanhe o banner superior para ver o progresso.',
                        timer: 2000,
                        showConfirmButton: false
                    });
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao iniciar simulação: ' + e, 'error');
            }
        }
    });
}

function runPlanNow(planId, planName) {
    swalEnging.fire({
        title: `Executar Plano [${planName}] Agora?`,
        html: `
            <p class="text-rose-700 font-bold mb-2">Atenção: Todos os servidores e VMs configurados neste plano serão desligados sequencialmente!</p>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sim, Executar Desligamento Real',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/plans/${planId}/trigger`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dry_run: false })
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'warning',
                        title: 'Execução Iniciada!',
                        text: 'A contagem regressiva e os desligamentos foram acionados.',
                        timer: 2500,
                        showConfirmButton: false
                    });
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao acionar plano: ' + e, 'error');
            }
        }
    });
}

async function cancelPlanExecution(planId) {
    try {
        const res = await fetch(`/api/plans/${planId}/cancel`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            swalEnging.fire({
                icon: 'success',
                title: 'Cancelado!',
                text: 'A execução do plano foi abortada.',
                timer: 1500,
                showConfirmButton: false
            });
        }
    } catch (e) {
        console.error('Erro ao cancelar:', e);
    }
}

async function openLogsModal() {
    try {
        const res = await fetch('/api/plans/logs', { cache: 'no-cache' });
        const logs = await res.json();

        const logRows = logs.length === 0 
            ? '<p class="text-slate-400 italic text-center p-6">Nenhum registo de auditoria recente.</p>'
            : logs.map(l => `
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                    <span class="p-1.5 rounded-lg ${l.level === 'error' ? 'bg-rose-100 text-rose-600' : l.level === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700'}">
                        <i data-lucide="${l.level === 'error' ? 'alert-octagon' : l.level === 'warning' ? 'alert-triangle' : 'info'}" class="w-3.5 h-3.5"></i>
                    </span>
                    <div class="flex-1">
                        <div class="flex justify-between items-center text-[11px]">
                            <strong class="text-enging-navy font-bold">${l.server || 'Sistema'}</strong>
                            <span class="text-slate-400 font-mono">${l.formatted_time}</span>
                        </div>
                        <p class="text-xs text-slate-700 mt-0.5">${l.message}</p>
                    </div>
                </div>
            `).join('');

        swalEnging.fire({
            title: 'Histórico & Logs de Auditoria',
            html: `
                <div class="text-left space-y-2 max-h-96 overflow-y-auto pr-1">
                    ${logRows}
                </div>
            `,
            width: '600px',
            confirmButtonText: 'Fechar',
            didOpen: () => lucide.createIcons()
        });
    } catch (e) {
        swalEnging.fire('Erro', 'Falha ao buscar logs: ' + e, 'error');
    }
}

// ------------------------------------------------------------- //
// CENTRAL DE ALERTAS & NOTIFICAÇÕES                             //
// ------------------------------------------------------------- //

async function loadAlertsData() {
    try {
        const res = await fetch('/api/alerts', { cache: 'no-cache' });
        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }
        if (!res.ok) return;
        allAlertsData = await res.json();
        renderAlertsUI();
    } catch (e) {
        console.error('Erro ao carregar dados de alertas:', e);
    }
}

function renderAlertsUI() {
    const rules = allAlertsData.rules || [];
    const recipients = allAlertsData.recipients || [];
    const logs = allAlertsData.logs || [];

    // Counters
    const rulesCountEl = document.getElementById('alert-rules-count');
    const contactsCountEl = document.getElementById('alert-contacts-count');
    if (rulesCountEl) rulesCountEl.innerText = rules.length;
    if (contactsCountEl) contactsCountEl.innerText = recipients.length;

    // 1. Render Rules List
    const rulesListEl = document.getElementById('alert-rules-list');
    if (rulesListEl) {
        if (rules.length === 0) {
            rulesListEl.innerHTML = `
                <div class="col-span-2 p-10 text-center text-slate-500 rounded-2xl bg-white border border-slate-200 shadow-sm">
                    <i data-lucide="bell-off" class="w-12 h-12 mx-auto mb-3 text-slate-400"></i>
                    <h3 class="text-base font-bold text-enging-navy">Nenhuma regra de alerta criada</h3>
                    <p class="text-xs text-slate-500 mt-1 mb-4">Crie regras para ser avisado quando faltar energia, acionar baterias ou ocorrer sobrecarga.</p>
                    <button onclick="openCreateAlertRuleModal()" class="px-4 py-2.5 rounded-xl bg-enging-orange hover:bg-enging-orange-hover text-white font-bold text-xs shadow-md shadow-enging-orange/20">
                        + Criar Nova Regra de Alerta
                    </button>
                </div>
            `;
        } else {
            rulesListEl.innerHTML = rules.map(r => {
                const assignedRecs = recipients.filter(rec => (r.recipient_ids || []).includes(rec.id));
                const recBadges = assignedRecs.length > 0 
                    ? assignedRecs.map(rec => `<span class="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-medium font-mono">${rec.name}</span>`).join(' ')
                    : '<span class="text-slate-400 italic text-[10px]">Nenhum contato atribuído</span>';

                const channels = r.channels || [];
                const chBadges = channels.map(ch => {
                    if (ch === 'whatsapp') return `<span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">WhatsApp</span>`;
                    if (ch === 'email') return `<span class="px-2 py-0.5 rounded-md bg-blue-50 text-enging-blue border border-blue-200 text-[10px] font-bold">Email</span>`;
                    if (ch === 'sms') return `<span class="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold">SMS</span>`;
                    if (ch === 'webhook') return `<span class="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">Webhook</span>`;
                    return '';
                }).join(' ');

                let triggerDesc = r.trigger_type;
                if (r.trigger_type === 'on_battery') triggerDesc = 'UPS em Bateria (Falta de Luz AC)';
                else if (r.trigger_type === 'power_restored') triggerDesc = 'Energia AC Restabelecida';
                else if (r.trigger_type === 'battery_level_low') triggerDesc = `Bateria ≤ ${r.threshold_val}%`;
                else if (r.trigger_type === 'high_load') triggerDesc = `Carga da UPS ≥ ${r.threshold_val}%`;
                else if (r.trigger_type === 'alarm_active') triggerDesc = 'Alarme / Falha Interna';

                return `
                    <div class="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between space-y-4">
                        <div class="space-y-2">
                            <div class="flex items-start justify-between gap-3">
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="text-sm font-bold text-enging-navy">${r.name}</h3>
                                        <span class="w-2 h-2 rounded-full ${r.enabled ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
                                    </div>
                                    <p class="text-xs text-slate-500 mt-0.5">${r.description || 'Sem descrição adicional'}</p>
                                </div>
                                <span class="px-2.5 py-1 rounded-xl bg-orange-50 text-enging-orange border border-orange-200 text-[11px] font-bold whitespace-nowrap">
                                    ${triggerDesc}
                                </span>
                            </div>

                            <div class="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                                <span class="text-[10px] text-slate-400 font-bold uppercase mr-1">Canais:</span>
                                ${chBadges || '<span class="text-slate-400 italic text-[10px]">Sem canais</span>'}
                            </div>

                            <div class="flex flex-wrap items-center gap-1.5 pt-1">
                                <span class="text-[10px] text-slate-400 font-bold uppercase mr-1">Destinatários:</span>
                                ${recBadges}
                            </div>
                        </div>

                        <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                            <div class="text-[10px] text-slate-400 font-mono">
                                Cooldown: <strong>${r.cooldown_min || 15}m</strong>
                            </div>
                            <div class="flex items-center gap-1.5">
                                <button onclick="openCreateAlertRuleModal('${r.id}')" title="Editar Regra" class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition">
                                    <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                                </button>
                                <button onclick="deleteAlertRule('${r.id}', '${r.name}')" title="Excluir Regra" class="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition">
                                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // 2. Render Recipients Table
    const recsTbody = document.getElementById('alert-contacts-tbody');
    if (recsTbody) {
        if (recipients.length === 0) {
            recsTbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 italic">Nenhum contato cadastrado. Clique em "+ Novo Contato".</td></tr>`;
        } else {
            recsTbody.innerHTML = recipients.map(rec => `
                <tr class="hover:bg-slate-50 transition text-xs">
                    <td class="p-3.5 font-bold text-enging-navy">${rec.name}</td>
                    <td class="p-3.5 font-mono text-slate-600">${rec.email || '-'}</td>
                    <td class="p-3.5 font-mono text-emerald-700 font-medium">${rec.phone_whatsapp || '-'}</td>
                    <td class="p-3.5 font-mono text-purple-700 font-medium">${rec.phone_sms || '-'}</td>
                    <td class="p-3.5 font-mono text-slate-500 truncate max-w-xs" title="${rec.webhook_url}">${rec.webhook_url || '-'}</td>
                    <td class="p-3.5">
                        <span class="px-2 py-0.5 rounded-full ${rec.enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-400 border border-slate-200'} text-[10px] font-bold">
                            ${rec.enabled ? 'Ativo' : 'Inativo'}
                        </span>
                    </td>
                    <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
                        <button onclick="testRecipientAlert('${rec.id}', '${rec.name}')" title="Enviar Notificação de Teste" class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-enging-orange transition">
                            <i data-lucide="send" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="openAddRecipientModal('${rec.id}')" title="Editar" class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition">
                            <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="deleteRecipient('${rec.id}', '${rec.name}')" title="Remover" class="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    }

    // 3. Render Logs
    const logsListEl = document.getElementById('alert-logs-list');
    if (logsListEl) {
        if (logs.length === 0) {
            logsListEl.innerHTML = `<p class="text-slate-400 italic text-center p-6">Nenhum registo de envio de alerta recente.</p>`;
        } else {
            logsListEl.innerHTML = logs.map(l => `
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-3 text-xs">
                    <div class="flex items-start gap-2.5">
                        <span class="p-1 rounded-lg ${l.success ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}">
                            <i data-lucide="${l.success ? 'check' : 'alert-octagon'}" class="w-3.5 h-3.5"></i>
                        </span>
                        <div>
                            <div class="flex items-center gap-2">
                                <strong class="text-enging-navy">${l.alert_name}</strong>
                                <span class="px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 text-[10px] uppercase font-bold font-mono">${l.channel}</span>
                                <span class="text-slate-500 font-medium">→ ${l.recipient_name}</span>
                            </div>
                            <p class="text-[11px] text-slate-600 mt-0.5">${l.message}</p>
                            ${l.detail ? `<p class="text-[10px] text-rose-600 font-mono mt-0.5">${l.detail}</p>` : ''}
                        </div>
                    </div>
                    <span class="text-slate-400 font-mono text-[10px] whitespace-nowrap">${l.formatted_time}</span>
                </div>
            `).join('');
        }
    }

    if (currentSubView === 'gateways' || document.getElementById('gateways-tbody')) {
        renderGatewaysList();
    }

    lucide.createIcons();
}

// ----------------- MODAIS DE REGRAS DE ALERTA ----------------- //

function openCreateAlertRuleModal(ruleId = null) {
    const isEdit = !!ruleId;
    const defaultTemplate = `🚨 *ALERTA ENGING UPS SYSTEM* 🚨\n━━━━━━━━━━━━━━━━━━━━━━\n📌 *Evento:* {evento}\n⚠️ *Detalhe:* {detalhe}\n🕒 *Hora:* {hora}\n━━━━━━━━━━━━━━━━━━━━━━\n🔋 *Bateria:* {bateria} ({tensao_bat})\n⚡ *Entrada AC:* {tensao_in} ({freq_in})\n🔌 *Saída UPS:* {tensao_out} | Carga: {carga} ({potencia})\n📊 *Modo:* {modo}\n🖥️ *Servidor:* {servidor}\n━━━━━━━━━━━━━━━━━━━━━━\nPainel: {painel_url}`;

    const r = isEdit ? (allAlertsData.rules || []).find(x => x.id === ruleId) : {
        id: '',
        name: '',
        description: '',
        trigger_type: 'on_battery',
        threshold_val: 30,
        threshold_val_max: 0,
        require_duration_sec: 2,
        cooldown_min: 15,
        enabled: true,
        channels: ['whatsapp', 'email', 'webhook'],
        recipient_ids: [],
        custom_message: defaultTemplate
    };

    if (!r) return;

    const initialMessage = r.custom_message ? r.custom_message : defaultTemplate;

    const recipients = allAlertsData.recipients || [];
    const recOptions = recipients.map(rec => {
        const isChecked = (r.recipient_ids || []).includes(rec.id);
        return `
            <label class="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200 cursor-pointer text-xs hover:bg-slate-50 transition">
                <input type="checkbox" class="swal-rec-chk w-4 h-4 rounded border-slate-300 text-enging-orange focus:ring-enging-orange" value="${rec.id}" ${isChecked ? 'checked' : ''}>
                <span class="font-bold text-slate-800">${rec.name}</span>
                <span class="text-[10px] text-slate-400 font-mono">(${rec.email || rec.phone_whatsapp || 'Webhook'})</span>
            </label>
        `;
    }).join('');

    const chWhatsApp = (r.channels || []).includes('whatsapp') ? 'checked' : '';
    const chEmail = (r.channels || []).includes('email') ? 'checked' : '';
    const chSMS = (r.channels || []).includes('sms') ? 'checked' : '';
    const chTeams = (r.channels || []).includes('teams') ? 'checked' : '';
    const chGoogleChat = (r.channels || []).includes('google_chat') ? 'checked' : '';
    const chWebhook = (r.channels || []).includes('webhook') ? 'checked' : '';

    const sessionName = currentSessionConfig.name || 'Enging UPS Notifier ⚡';

    swalEnging.fire({
        title: isEdit ? 'Editar Regra de Alerta' : 'Criar Nova Regra de Alerta',
        html: `
            <div class="text-left space-y-4 mt-2 font-sans text-xs">
                
                <!-- 1. Nome e Gatilho -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1">Nome da Regra</label>
                        <input id="swal-rule-name" oninput="window.updateAlertRuleChatPreview()" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-bold focus:outline-none focus:border-enging-orange" placeholder="Ex: Falta de Luz - Envio TI" value="${r.name || 'Falta de Energia AC'}">
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1">Tipo de Gatilho / Trigger</label>
                        <select id="swal-rule-trigger" onchange="window.toggleTriggerThresholds(); window.updateAlertRuleChatPreview();" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange font-medium">
                            <option value="on_battery" ${r.trigger_type === 'on_battery' ? 'selected' : ''}>🚨 Falta de Energia Elétrica AC (UPS em Bateria)</option>
                            <option value="power_restored" ${r.trigger_type === 'power_restored' ? 'selected' : ''}>🟢 Restabelecimento de Energia Elétrica AC (Retorno ao modo Online)</option>
                            <option value="battery_level_low" ${r.trigger_type === 'battery_level_low' ? 'selected' : ''}>🔋 Nível de Bateria Baixo / Crítico (≤ X %)</option>
                            <option value="high_load" ${r.trigger_type === 'high_load' ? 'selected' : ''}>⚡ Sobrecarga de Consumo da UPS (≥ X %)</option>
                            <option value="input_voltage_range" ${r.trigger_type === 'input_voltage_range' ? 'selected' : ''}>⚠️ Subtensão ou Sobretensão na Entrada AC</option>
                            <option value="alarm_active" ${r.trigger_type === 'alarm_active' ? 'selected' : ''}>🔔 Alarme Interno ou Falha Reportada pelo UPS</option>
                        </select>
                    </div>
                </div>

                <!-- 2. Parâmetros do Gatilho -->
                <div id="swal-thresh-box" class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div id="thresh-val-group">
                        <label id="thresh-val-label" class="block font-bold text-enging-orange uppercase mb-1">Limite Numérico (%)</label>
                        <input id="swal-rule-thresh" oninput="window.updateAlertRuleChatPreview()" type="number" step="1" class="w-full px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-900 font-mono" value="${r.threshold_val || 30}">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1">Duração Mínima (s)</label>
                        <input id="swal-rule-dur" type="number" min="0" max="300" class="w-full px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono" value="${r.require_duration_sec || 2}">
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1">Intervalo / Cooldown (min)</label>
                        <input id="swal-rule-cool" type="number" min="1" max="1440" class="w-full px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono" value="${r.cooldown_min || 15}">
                    </div>
                </div>

                <!-- 3. Canais de Envio e Destinatários -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1.5">Canais de Envio Ativos</label>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="flex items-center gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition">
                                <input type="checkbox" id="swal-ch-wa" ${chWhatsApp} class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500">
                                <span class="font-bold text-emerald-700">WhatsApp</span>
                            </label>
                            <label class="flex items-center gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition">
                                <input type="checkbox" id="swal-ch-em" ${chEmail} class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500">
                                <span class="font-bold text-blue-700">Email (SMTP)</span>
                            </label>
                            <label class="flex items-center gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition">
                                <input type="checkbox" id="swal-ch-sms" ${chSMS} class="w-4 h-4 rounded text-purple-600 focus:ring-purple-500">
                                <span class="font-bold text-purple-700">SMS</span>
                            </label>
                            <label class="flex items-center gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition">
                                <input type="checkbox" id="swal-ch-teams" ${chTeams} class="w-4 h-4 rounded text-blue-700 focus:ring-blue-600">
                                <span class="font-bold text-blue-900 flex items-center gap-1">Teams</span>
                            </label>
                            <label class="flex items-center gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition">
                                <input type="checkbox" id="swal-ch-gc" ${chGoogleChat} class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500">
                                <span class="font-bold text-emerald-800 flex items-center gap-1">Google Chat</span>
                            </label>
                            <label class="flex items-center gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition">
                                <input type="checkbox" id="swal-ch-wh" ${chWebhook} class="w-4 h-4 rounded text-amber-600 focus:ring-amber-500">
                                <span class="font-bold text-amber-800">Webhook Genérico</span>
                            </label>
                        </div>
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1.5">Destinatários Cadastrados</label>
                        <div class="max-h-28 overflow-y-auto space-y-1 p-2 rounded-xl bg-slate-50 border border-slate-200">
                            ${recOptions || '<p class="text-slate-400 italic p-1">Nenhum contato cadastrado.</p>'}
                        </div>
                    </div>
                </div>

                <!-- 4. EDITOR COMPLETO DA MENSAGEM ESTILO WHATSAPP -->
                <div class="space-y-2 border-t border-slate-200 pt-3">
                    <div class="flex items-center justify-between">
                        <label class="block font-bold text-slate-800 uppercase flex items-center gap-1.5 text-xs">
                            <i data-lucide="message-square" class="w-4 h-4 text-emerald-600"></i> Editor da Mensagem do Alerta
                        </label>
                        
                        <!-- Toggle de Visualização -->
                        <div class="flex items-center bg-slate-200/80 p-0.5 rounded-lg text-[11px] font-bold">
                            <button type="button" id="tab-btn-editor" onclick="window.switchMsgViewMode('editor')" class="px-2.5 py-1 rounded-md bg-white text-slate-900 shadow-xs transition flex items-center gap-1">
                                <i data-lucide="edit-3" class="w-3 h-3 text-emerald-600"></i> <span>Editar Texto</span>
                            </button>
                            <button type="button" id="tab-btn-preview" onclick="window.switchMsgViewMode('preview')" class="px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-900 transition flex items-center gap-1">
                                <i data-lucide="eye" class="w-3 h-3 text-blue-600"></i> <span>Pré-visualizar Balão</span>
                            </button>
                        </div>
                    </div>

                    <!-- Toolbar de Inserção de Variáveis e Formatação -->
                    <div class="p-2 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                        <div class="flex items-center justify-between gap-2 flex-wrap text-[11px]">
                            <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <i data-lucide="tag" class="w-3 h-3 text-enging-orange"></i> Inserir Variáveis:
                            </span>
                            <button type="button" onclick="window.resetDefaultMsgTemplate()" class="text-[10px] text-enging-orange hover:underline font-bold flex items-center gap-1">
                                <i data-lucide="rotate-ccw" class="w-3 h-3"></i> Restaurar Modelo Padrão
                            </button>
                        </div>

                        <!-- Chips de Variáveis Dinâmicas -->
                        <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                            <button type="button" onclick="window.insertMsgVar('{evento}')" class="px-2 py-0.5 rounded-lg bg-white hover:bg-emerald-50 text-emerald-800 border border-slate-200 text-[10px] font-mono font-bold transition shrink-0 shadow-2xs" title="Nome do evento ou alarme">
                                + {evento}
                            </button>
                            <button type="button" onclick="window.insertMsgVar('{detalhe}')" class="px-2 py-0.5 rounded-lg bg-white hover:bg-emerald-50 text-emerald-800 border border-slate-200 text-[10px] font-mono font-bold transition shrink-0 shadow-2xs" title="Descrição da condição disparada">
                                + {detalhe}
                            </button>
                            <button type="button" onclick="window.insertMsgVar('{hora}')" class="px-2 py-0.5 rounded-lg bg-white hover:bg-emerald-50 text-emerald-800 border border-slate-200 text-[10px] font-mono font-bold transition shrink-0 shadow-2xs" title="Data e hora do disparo">
                                + {hora}
                            </button>
                            <button type="button" onclick="window.insertMsgVar('{bateria}')" class="px-2 py-0.5 rounded-lg bg-white hover:bg-amber-50 text-amber-800 border border-slate-200 text-[10px] font-mono font-bold transition shrink-0 shadow-2xs" title="Percentual da bateria (ex: 85%)">
                                + {bateria}
                            </button>
                            <button type="button" onclick="window.insertMsgVar('{tensao_in}')" class="px-2 py-0.5 rounded-lg bg-white hover:bg-blue-50 text-blue-800 border border-slate-200 text-[10px] font-mono font-bold transition shrink-0 shadow-2xs" title="Tensão de entrada da rede AC">
                                + {tensao_in}
                            </button>
                            <button type="button" onclick="window.insertMsgVar('{tensao_out}')" class="px-2 py-0.5 rounded-lg bg-white hover:bg-blue-50 text-blue-800 border border-slate-200 text-[10px] font-mono font-bold transition shrink-0 shadow-2xs" title="Tensão fornecida na saída">
                                + {tensao_out}
                            </button>
                            <button type="button" onclick="window.insertMsgVar('{carga}')" class="px-2 py-0.5 rounded-lg bg-white hover:bg-purple-50 text-purple-800 border border-slate-200 text-[10px] font-mono font-bold transition shrink-0 shadow-2xs" title="Percentual de carga consumida">
                                + {carga}
                            </button>
                            <button type="button" onclick="window.insertMsgVar('{modo}')" class="px-2 py-0.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 text-[10px] font-mono font-bold transition shrink-0 shadow-2xs" title="Estado da UPS (ONLINE, BATERIA)">
                                + {modo}
                            </button>
                            <button type="button" onclick="window.insertMsgVar('*texto*')" class="px-2 py-0.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold transition shrink-0 shadow-2xs" title="Texto em Negrito no WhatsApp">
                                *Negrito*
                            </button>
                        </div>
                    </div>

                    <!-- Container Modo Editor -->
                    <div id="msg-view-editor" class="space-y-1">
                        <textarea id="swal-rule-msg" oninput="window.updateAlertRuleChatPreview()" rows="8" class="w-full p-3 rounded-2xl bg-white border border-slate-300 text-xs text-slate-900 font-sans leading-relaxed focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 shadow-inner" placeholder="Digite a mensagem completa que será transmitida no WhatsApp...">${initialMessage}</textarea>
                        <span class="text-[10px] text-slate-400 block">Pode alterar qualquer texto, adicionar instruções para o piquete, emojis e usar as variáveis acima.</span>
                    </div>

                    <!-- Container Modo Pré-visualização WhatsApp -->
                    <div id="msg-view-preview" class="hidden rounded-2xl border border-slate-300 overflow-hidden shadow-sm font-sans select-text" style="background-color: #efeae2; background-image: radial-gradient(#d1d7db 1.2px, transparent 1.2px); background-size: 16px 16px;">
                        
                        <!-- Chat Mini Header -->
                        <div class="bg-[#005c4b] text-white px-3 py-2 flex items-center justify-between shadow-xs select-none">
                            <div class="flex items-center gap-2">
                                <div class="w-6 h-6 rounded-full bg-emerald-700 flex items-center justify-center text-white text-xs font-bold shadow-xs">
                                    <i data-lucide="zap" class="w-3.5 h-3.5 text-enging-orange"></i>
                                </div>
                                <div>
                                    <div class="font-bold text-xs leading-none text-white">${sessionName}</div>
                                    <div class="text-[9px] text-emerald-200 font-mono">Disparo Automático de Alerta</div>
                                </div>
                            </div>
                            <span class="text-[10px] font-mono text-emerald-200">Enging UPS Bot</span>
                        </div>

                        <!-- Chat Messages Feed / WhatsApp Bubble -->
                        <div class="p-3.5 space-y-2">
                            <div class="flex items-start justify-end">
                                <div class="max-w-[95%] bg-[#d9fdd3] rounded-2xl rounded-tr-xs p-3 shadow-xs border border-[#c6f5be] space-y-1 text-left">
                                    
                                    <div class="text-[10px] text-emerald-800 font-bold flex items-center justify-between gap-2 border-b border-emerald-200/60 pb-1 mb-1">
                                        <span>⚡ ENGING NOTIFICATION SYSTEM</span>
                                        <span class="font-mono text-[9px] text-slate-500">Alerta Oficial</span>
                                    </div>

                                    <div id="swal-rule-chat-bubble-text" class="text-xs leading-relaxed text-slate-800 whitespace-pre-wrap font-sans">
                                        <!-- Renderizado dinamicamente via JS -->
                                    </div>

                                    <div class="flex items-center justify-end gap-1 text-[10px] text-slate-400 font-mono mt-1 pt-0.5">
                                        <span id="swal-rule-chat-bubble-time">${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</span>
                                        <span class="text-blue-500 font-bold" title="Entregue">✓✓</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>

                </div>

                <div class="pt-1">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" id="swal-rule-enabled" ${r.enabled ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-enging-orange focus:ring-enging-orange">
                        <span class="font-bold text-slate-800">Regra Ativada para Monitorização Contínua</span>
                    </label>
                </div>
            </div>
        `,
        width: '740px',
        showCancelButton: true,
        confirmButtonText: isEdit ? 'Salvar Alterações' : 'Criar Regra',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        didOpen: () => {
            lucide.createIcons();
            
            window.toggleTriggerThresholds = () => {
                const tr = document.getElementById('swal-rule-trigger').value;
                const box = document.getElementById('swal-thresh-box');
                const lbl = document.getElementById('thresh-val-label');
                const inp = document.getElementById('swal-rule-thresh');

                if (tr === 'battery_level_low') {
                    box.classList.remove('hidden');
                    lbl.innerText = 'Limite Mínimo de Bateria (%)';
                    inp.placeholder = '30';
                } else if (tr === 'high_load') {
                    box.classList.remove('hidden');
                    lbl.innerText = 'Limite Máximo de Carga (%)';
                    inp.placeholder = '80';
                } else if (tr === 'input_voltage_range') {
                    box.classList.remove('hidden');
                    lbl.innerText = 'Tensão Mínima de Entrada (V)';
                    inp.placeholder = '190';
                } else {
                    box.classList.add('hidden');
                }
            };

            window.switchMsgViewMode = (mode) => {
                const edBox = document.getElementById('msg-view-editor');
                const prevBox = document.getElementById('msg-view-preview');
                const btnEd = document.getElementById('tab-btn-editor');
                const btnPrev = document.getElementById('tab-btn-preview');

                if (mode === 'editor') {
                    edBox?.classList.remove('hidden');
                    prevBox?.classList.add('hidden');
                    btnEd.className = 'px-2.5 py-1 rounded-md bg-white text-slate-900 shadow-xs transition flex items-center gap-1';
                    btnPrev.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-900 transition flex items-center gap-1';
                } else {
                    edBox?.classList.add('hidden');
                    prevBox?.classList.remove('hidden');
                    btnPrev.className = 'px-2.5 py-1 rounded-md bg-white text-slate-900 shadow-xs transition flex items-center gap-1';
                    btnEd.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-900 transition flex items-center gap-1';
                    window.updateAlertRuleChatPreview();
                }
            };

            window.insertMsgVar = (tag) => {
                const textarea = document.getElementById('swal-rule-msg');
                if (!textarea) return;
                const start = textarea.selectionStart || 0;
                const end = textarea.selectionEnd || 0;
                const text = textarea.value;
                textarea.value = text.substring(0, start) + tag + text.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + tag.length;
                textarea.focus();
                window.updateAlertRuleChatPreview();
            };

            window.resetDefaultMsgTemplate = () => {
                const textarea = document.getElementById('swal-rule-msg');
                if (textarea) {
                    textarea.value = defaultTemplate;
                    window.updateAlertRuleChatPreview();
                    textarea.focus();
                }
            };

            window.updateAlertRuleChatPreview = () => {
                const name = document.getElementById('swal-rule-name')?.value.trim() || 'Regra de Alerta';
                const trigger = document.getElementById('swal-rule-trigger')?.value || 'on_battery';
                const thresh = document.getElementById('swal-rule-thresh')?.value || '30';
                const rawMsg = document.getElementById('swal-rule-msg')?.value || defaultTemplate;
                
                let triggerDesc = 'UPS está a funcionar em modo Bateria (Queda de Rede AC)';
                let battVal = '85%';
                let voltBat = '218.4 V';
                let voltIn = '0.0 V';
                let freqIn = '0.0 Hz';
                let voltOut = '230.0 V';
                let loadVal = '22%';
                let powVal = '1320 W';
                let modeVal = 'BATERIA (DISCHRG)';
                
                if (trigger === 'power_restored') {
                    triggerDesc = 'Rede AC restaurada. Inversor operando em modo Normal.';
                    battVal = '96%';
                    voltBat = '224.2 V';
                    voltIn = '230.1 V';
                    freqIn = '50.0 Hz';
                    modeVal = 'ONLINE (OL)';
                } else if (trigger === 'battery_level_low') {
                    triggerDesc = `Bateria atingiu nível crítico de ${thresh}%`;
                    battVal = `${thresh}%`;
                    voltBat = '204.0 V';
                    voltIn = '0.0 V';
                    freqIn = '0.0 Hz';
                    modeVal = 'BATERIA BAIXA (LB)';
                } else if (trigger === 'high_load') {
                    triggerDesc = `Sobrecarga de consumo superior a ${thresh}%`;
                    battVal = '90%';
                    loadVal = `${thresh}%`;
                    powVal = '4800 W';
                    voltIn = '228.4 V';
                    freqIn = '50.0 Hz';
                    modeVal = 'ONLINE (HIGH LOAD)';
                } else if (trigger === 'input_voltage_range') {
                    triggerDesc = `Tensão de entrada fora dos limites nominais (< ${thresh}V)`;
                    battVal = '88%';
                    voltIn = `${thresh} V`;
                    modeVal = 'SUBTENSÃO AC';
                } else if (trigger === 'alarm_active') {
                    triggerDesc = 'Alarme sonoro ou falha interna ativa no inversor';
                    battVal = '95%';
                    voltIn = '230.0 V';
                    modeVal = 'ALARME UPS';
                }

                const nowStr = new Date().toLocaleString('pt-PT');

                let rendered = rawMsg
                    .replace(/{evento}/g, name)
                    .replace(/{rule_name}/g, name)
                    .replace(/{detalhe}/g, triggerDesc)
                    .replace(/{condition}/g, triggerDesc)
                    .replace(/{hora}/g, nowStr)
                    .replace(/{time}/g, nowStr)
                    .replace(/{bateria}/g, battVal)
                    .replace(/{tensao_bat}/g, voltBat)
                    .replace(/{tensao_in}/g, voltIn)
                    .replace(/{freq_in}/g, freqIn)
                    .replace(/{tensao_out}/g, voltOut)
                    .replace(/{carga}/g, loadVal)
                    .replace(/{potencia}/g, powVal)
                    .replace(/{modo}/g, modeVal)
                    .replace(/{servidor}/g, '10.255.255.28 (INVT HT1106XS)')
                    .replace(/{painel_url}/g, 'https://10.255.255.28/');

                const previewEl = document.getElementById('swal-rule-chat-bubble-text');
                if (previewEl) {
                    previewEl.innerHTML = formatChatText(rendered);
                }
                const timeEl = document.getElementById('swal-rule-chat-bubble-time');
                if (timeEl) {
                    timeEl.innerText = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
                }
            };

            window.toggleTriggerThresholds();
            window.updateAlertRuleChatPreview();
        },
        preConfirm: () => {
            const name = document.getElementById('swal-rule-name').value.trim();
            const trigger_type = document.getElementById('swal-rule-trigger').value;
            const threshold_val = parseFloat(document.getElementById('swal-rule-thresh').value) || 0;
            const require_duration_sec = parseInt(document.getElementById('swal-rule-dur').value) || 0;
            const cooldown_min = parseInt(document.getElementById('swal-rule-cool').value) || 15;
            const custom_message = document.getElementById('swal-rule-msg').value.trim();
            const enabled = document.getElementById('swal-rule-enabled').checked;

            if (!name) {
                Swal.showValidationMessage('Informe o nome da regra de alerta.');
                return false;
            }

            const channels = [];
            if (document.getElementById('swal-ch-wa')?.checked) channels.push('whatsapp');
            if (document.getElementById('swal-ch-em')?.checked) channels.push('email');
            if (document.getElementById('swal-ch-sms')?.checked) channels.push('sms');
            if (document.getElementById('swal-ch-teams')?.checked) channels.push('teams');
            if (document.getElementById('swal-ch-gc')?.checked) channels.push('google_chat');
            if (document.getElementById('swal-ch-wh')?.checked) channels.push('webhook');

            if (channels.length === 0) {
                Swal.showValidationMessage('Selecione pelo menos um canal de envio.');
                return false;
            }

            const recipient_ids = [];
            document.querySelectorAll('.swal-rec-chk:checked').forEach(cb => {
                recipient_ids.push(cb.value);
            });

            return {
                id: r.id || undefined,
                name,
                description: `Disparo automático para ${trigger_type}`,
                trigger_type,
                threshold_val,
                require_duration_sec,
                cooldown_min,
                channels,
                recipient_ids,
                custom_message,
                enabled
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/alerts/rule', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: isEdit ? 'Regra Atualizada!' : 'Regra Criada!',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    loadAlertsData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao salvar regra de alerta: ' + e, 'error');
            }
        }
    });
}

function deleteAlertRule(ruleId, ruleName) {
    swalEnging.fire({
        title: 'Excluir Regra de Alerta?',
        html: `Deseja excluir a regra <strong>${ruleName}</strong>?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sim, Excluir',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/alerts/rule/${ruleId}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: 'Regra excluída!',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    loadAlertsData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao excluir regra: ' + e, 'error');
            }
        }
    });
}

// ----------------- MODAL DE CONTATOS & DESTINATÁRIOS ----------------- //

function openAddRecipientModal(recipientId = null) {
    const isEdit = !!recipientId;
    const rec = isEdit ? (allAlertsData.recipients || []).find(x => x.id === recipientId) : {
        id: '',
        name: '',
        email: '',
        phone_whatsapp: '',
        phone_sms: '',
        webhook_url: '',
        enabled: true,
        notes: ''
    };

    if (!rec) return;

    swalEnging.fire({
        title: isEdit ? 'Editar Contato' : 'Adicionar Novo Contato',
        html: `
            <div class="text-left space-y-3 mt-2 font-sans text-xs">
                <div>
                    <label class="block font-bold text-slate-700 uppercase mb-1">Nome Completo / Função</label>
                    <input id="swal-rec-name" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange" placeholder="Ex: André Silva (Piquete TI)" value="${rec.name}">
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1">Email</label>
                        <input id="swal-rec-email" type="email" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" placeholder="nome@enging.pt" value="${rec.email || ''}">
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1">WhatsApp (com DDI)</label>
                        <input id="swal-rec-wa" type="text" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" placeholder="+351912345678" value="${rec.phone_whatsapp || ''}">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1">SMS (com DDI)</label>
                        <input id="swal-rec-sms" type="text" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" placeholder="+351912345678" value="${rec.phone_sms || ''}">
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1">Webhook Pessoal Genérico (Opcional)</label>
                        <input id="swal-rec-wh" type="text" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono focus:outline-none focus:border-enging-orange" placeholder="https://webhook.site/..." value="${rec.webhook_url || ''}">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1 flex items-center gap-1">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 21 21" fill="none"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg> Teams Webhook (Opcional)
                        </label>
                        <input id="swal-rec-teams" type="text" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono text-xs focus:outline-none focus:border-blue-600" placeholder="https://enging.webhook.office.com/..." value="${rec.teams_webhook || ''}">
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 uppercase mb-1 flex items-center gap-1">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg> Google Chat Webhook (Opcional)
                        </label>
                        <input id="swal-rec-gc" type="text" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono text-xs focus:outline-none focus:border-emerald-600" placeholder="https://chat.googleapis.com/..." value="${rec.google_chat_webhook || ''}">
                    </div>
                </div>

                <div class="pt-1">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" id="swal-rec-enabled" ${rec.enabled ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-enging-orange focus:ring-enging-orange">
                        <span class="font-bold text-slate-800">Contato Ativo para Recebimento de Notificações</span>
                    </label>
                </div>
            </div>
        `,
        width: '580px',
        showCancelButton: true,
        confirmButtonText: isEdit ? 'Salvar Contato' : 'Adicionar Contato',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
            const name = document.getElementById('swal-rec-name').value.trim();
            const email = document.getElementById('swal-rec-email').value.trim();
            const phone_whatsapp = document.getElementById('swal-rec-wa').value.trim();
            const phone_sms = document.getElementById('swal-rec-sms').value.trim();
            const webhook_url = document.getElementById('swal-rec-wh').value.trim();
            const teams_webhook = document.getElementById('swal-rec-teams') ? document.getElementById('swal-rec-teams').value.trim() : '';
            const google_chat_webhook = document.getElementById('swal-rec-gc') ? document.getElementById('swal-rec-gc').value.trim() : '';
            const enabled = document.getElementById('swal-rec-enabled').checked;

            if (!name) {
                Swal.showValidationMessage('Informe o nome do contato.');
                return false;
            }

            return {
                id: rec.id || undefined,
                name,
                email,
                phone_whatsapp,
                phone_sms,
                webhook_url,
                teams_webhook,
                google_chat_webhook,
                enabled
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/alerts/recipient', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: isEdit ? 'Contato Atualizado!' : 'Contato Adicionado!',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    loadAlertsData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao salvar contato: ' + e, 'error');
            }
        }
    });
}

function deleteRecipient(recId, recName) {
    swalEnging.fire({
        title: 'Remover Contato?',
        html: `Tem certeza que deseja remover <strong>${recName}</strong> da lista de contatos?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sim, Remover',
        cancelButtonText: 'Cancelar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch(`/api/alerts/recipient/${recId}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: 'Contato removido!',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    loadAlertsData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao remover contato: ' + e, 'error');
            }
        }
    });
}

function testRecipientAlert(recId, recName) {
    swalEnging.fire({
        title: `Testar Envio para ${recName}`,
        html: `
            <p class="text-xs text-slate-600 mb-3">Escolha por qual canal deseja disparar a notificação de teste:</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <button onclick="executeTestAlertChannel('whatsapp', '${recId}')" class="p-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold transition flex items-center justify-center gap-2">
                    <i data-lucide="message-square" class="w-4 h-4"></i> WhatsApp
                </button>
                <button onclick="executeTestAlertChannel('email', '${recId}')" class="p-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold transition flex items-center justify-center gap-2">
                    <i data-lucide="mail" class="w-4 h-4"></i> Email (SMTP)
                </button>
                <button onclick="executeTestAlertChannel('sms', '${recId}')" class="p-3 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 font-bold transition flex items-center justify-center gap-2">
                    <i data-lucide="smartphone" class="w-4 h-4"></i> SMS
                </button>
                <button onclick="executeTestAlertChannel('teams', '${recId}')" class="p-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 font-bold transition flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" viewBox="0 0 21 21" fill="none"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg> Teams
                </button>
                <button onclick="executeTestAlertChannel('google_chat', '${recId}')" class="p-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 font-bold transition flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg> Google
                </button>
                <button onclick="executeTestAlertChannel('webhook', '${recId}')" class="p-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold transition flex items-center justify-center gap-2">
                    <i data-lucide="webhook" class="w-4 h-4"></i> Webhook
                </button>
            </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Fechar',
        didOpen: () => lucide.createIcons()
    });
}

async function executeTestAlertChannel(channel, recId) {
    const rec = (allAlertsData.recipients || []).find(x => x.id === recId);
    let target = '';
    if (rec) {
        if (channel === 'whatsapp') target = rec.phone_whatsapp;
        else if (channel === 'email') target = rec.email;
        else if (channel === 'sms') target = rec.phone_sms;
        else if (channel === 'teams') target = rec.teams_webhook || rec.webhook_url;
        else if (channel === 'google_chat') target = rec.google_chat_webhook || rec.webhook_url;
        else if (channel === 'webhook') target = rec.webhook_url;
    }
    if (channel === 'whatsapp') {
        openWhatsAppChatModal(target);
    } else {
        await executeLiveChannelDispatch(channel, target, recId, rec ? rec.name : 'Destinatário');
    }
}

// ----------------- CONFIGURAÇÃO GLOBAL DE CANAIS ----------------- //

function openChannelSettingsModal() {
    const s = allAlertsData.channel_settings || {};
    const smtp = s.smtp || {};
    const wa = s.whatsapp || {};
    const sms = s.sms || {};
    const teams = s.teams || {};
    const googleChat = s.google_chat || {};
    const wh = s.webhook || {};

    swalEnging.fire({
        title: 'Configurações Globais de Gateways',
        html: `
            <div class="text-left space-y-4 mt-2 font-sans text-xs max-h-[440px] overflow-y-auto pr-1">
                
                <!-- 1. SMTP / Email -->
                <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-enging-navy uppercase flex items-center gap-1.5"><i data-lucide="mail" class="w-4 h-4 text-blue-600"></i> Email (SMTP)</span>
                        <label class="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" id="smtp-enabled" ${smtp.enabled ? 'checked' : ''} class="w-4 h-4 rounded text-blue-600">
                            <span class="font-bold text-slate-700">Ativado</span>
                        </label>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        <div class="col-span-2">
                            <label class="block text-[10px] font-bold text-slate-500">Servidor Host</label>
                            <input id="smtp-host" class="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-mono text-xs" value="${smtp.host || 'smtp.gmail.com'}">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500">Porta</label>
                            <input id="smtp-port" type="number" class="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-mono text-xs" value="${smtp.port || 587}">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500">Utilizador / Email</label>
                            <input id="smtp-user" class="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-mono text-xs" value="${smtp.username || ''}">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500">Senha / App Password</label>
                            <input id="smtp-pass" type="password" class="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-mono text-xs" value="${smtp.password || ''}">
                        </div>
                    </div>
                </div>

                <!-- 2. WhatsApp Gateway -->
                <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-enging-navy uppercase flex items-center gap-1.5"><i data-lucide="message-square" class="w-4 h-4 text-emerald-600"></i> WhatsApp Gateway / Webhook</span>
                        <label class="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" id="wa-enabled" ${wa.enabled ? 'checked' : ''} class="w-4 h-4 rounded text-emerald-600">
                            <span class="font-bold text-slate-700">Ativado</span>
                        </label>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500">API Endpoint URL (ex: Evolution API, Z-API, Custom)</label>
                        <input id="wa-url" class="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-mono text-xs" placeholder="https://api.whatsapp-gateway.com/send-message" value="${wa.api_url || ''}">
                    </div>
                </div>

                <!-- 3. SMS Gateway -->
                <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-enging-navy uppercase flex items-center gap-1.5"><i data-lucide="smartphone" class="w-4 h-4 text-purple-600"></i> SMS Gateway HTTP API</span>
                        <label class="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" id="sms-enabled" ${sms.enabled ? 'checked' : ''} class="w-4 h-4 rounded text-purple-600">
                            <span class="font-bold text-slate-700">Ativado</span>
                        </label>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500">SMS API Endpoint URL</label>
                        <input id="sms-url" class="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-mono text-xs" placeholder="https://api.sms-provider.com/v1/send" value="${sms.api_url || ''}">
                    </div>
                </div>

                <!-- 4. Microsoft Teams Webhook -->
                <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-enging-navy uppercase flex items-center gap-1.5">
                            <svg class="w-4 h-4" viewBox="0 0 21 21" fill="none"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg> Microsoft Teams Webhook
                        </span>
                        <label class="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" id="teams-enabled" ${teams.enabled !== false ? 'checked' : ''} class="w-4 h-4 rounded text-blue-600">
                            <span class="font-bold text-slate-700">Ativado</span>
                        </label>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500">URL do Webhook Teams (Office 365 / Power Automate)</label>
                        <input id="teams-url" class="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-mono text-xs" placeholder="https://enging.webhook.office.com/..." value="${teams.webhook_url || ''}">
                    </div>
                </div>

                <!-- 5. Google Chat Webhook -->
                <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-enging-navy uppercase flex items-center gap-1.5">
                            <svg class="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg> Google Chat Webhook
                        </span>
                        <label class="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" id="google-enabled" ${googleChat.enabled !== false ? 'checked' : ''} class="w-4 h-4 rounded text-emerald-600">
                            <span class="font-bold text-slate-700">Ativado</span>
                        </label>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500">URL do Webhook Google Chat Space</label>
                        <input id="google-url" class="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-mono text-xs" placeholder="https://chat.googleapis.com/v1/spaces/..." value="${googleChat.webhook_url || ''}">
                    </div>
                </div>

                <!-- 6. Webhook Genérico & SIEM -->
                <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-enging-navy uppercase flex items-center gap-1.5"><i data-lucide="webhook" class="w-4 h-4 text-amber-600"></i> Webhook Genérico & SIEM (Zabbix/Discord/Slack/n8n)</span>
                        <label class="flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" id="wh-enabled" ${wh.enabled !== false ? 'checked' : ''} class="w-4 h-4 rounded text-amber-600">
                            <span class="font-bold text-slate-700">Ativado</span>
                        </label>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500">URL Padrão de Webhook</label>
                        <input id="wh-url" class="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-mono text-xs" placeholder="https://zabbix.enging.pt/api/webhook/ups" value="${wh.default_url || ''}">
                    </div>
                </div>

            </div>
        `,
        width: '600px',
        showCancelButton: true,
        confirmButtonText: 'Salvar Configurações',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        didOpen: () => lucide.createIcons(),
        preConfirm: () => {
            return {
                smtp: {
                    enabled: document.getElementById('smtp-enabled').checked,
                    host: document.getElementById('smtp-host').value.trim(),
                    port: parseInt(document.getElementById('smtp-port').value) || 587,
                    use_tls: true,
                    username: document.getElementById('smtp-user').value.trim(),
                    password: document.getElementById('smtp-pass').value,
                    from_email: document.getElementById('smtp-user').value.trim() || 'ups-alerts@enging.pt',
                    from_name: 'Enging UPS System'
                },
                whatsapp: {
                    enabled: document.getElementById('wa-enabled').checked,
                    api_url: document.getElementById('wa-url').value.trim(),
                    api_token: ''
                },
                sms: {
                    enabled: document.getElementById('sms-enabled').checked,
                    api_url: document.getElementById('sms-url').value.trim(),
                    api_token: ''
                },
                teams: {
                    enabled: document.getElementById('teams-enabled').checked,
                    webhook_url: document.getElementById('teams-url').value.trim()
                },
                google_chat: {
                    enabled: document.getElementById('google-enabled').checked,
                    webhook_url: document.getElementById('google-url').value.trim()
                },
                webhook: {
                    enabled: document.getElementById('wh-enabled').checked,
                    default_url: document.getElementById('wh-url').value.trim()
                }
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/alerts/channels', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: 'Configurações Salvas!',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    loadAlertsData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao salvar configurações: ' + e, 'error');
            }
        }
    });
}

// ------------------------------------------------------------- //
// GESTÃO DE CONEXÕES & INTEGRAÇÕES DE APIS                      //
// ------------------------------------------------------------- //

async function loadConnectionsData() {
    try {
        const res = await fetch('/api/connections');
        if (res.ok) {
            allConnectionsData = await res.json();
            if (currentMainModule === 'connections') {
                if (currentSubView === 'nut') populateNutConfigForm();
                else if (currentSubView === 'proxmox') renderProxmoxTable();
                else if (currentSubView === 'vmware') renderVmwareTable();
                else if (currentSubView === 'gateways') renderGatewaysList();
                else if (currentSubView === 'tokens') renderApiTokensTable();
            }
        }
    } catch (e) {
        console.error('Erro ao carregar conexões:', e);
    }
}

function populateNutConfigForm() {
    const nut = allConnectionsData.nut_server || {};
    const fHost = document.getElementById('nut-conf-host');
    const fPort = document.getElementById('nut-conf-port');
    const fUps = document.getElementById('nut-conf-upsname');
    const fUser = document.getElementById('nut-conf-user');
    const fPoll = document.getElementById('nut-conf-poll');
    const fTimeout = document.getElementById('nut-conf-timeout');
    
    if (fHost) fHost.value = nut.host || '10.255.255.28';
    if (fPort) fPort.value = nut.port || 3493;
    if (fUps) fUps.value = nut.ups_name || 'ups';
    if (fUser) fUser.value = nut.username || 'enging';
    if (fPoll) fPoll.value = nut.poll_interval || 2.0;
    if (fTimeout) fTimeout.value = nut.timeout || 5.0;

    const diagStatus = document.getElementById('nut-diag-status');
    const diagCheck = document.getElementById('nut-diag-lastcheck');
    if (diagStatus) {
        if (nut.status === 'online') {
            diagStatus.innerHTML = '<span class="text-emerald-600 font-bold">● Conectado (Online)</span>';
        } else {
            diagStatus.innerHTML = '<span class="text-rose-600 font-bold">● Desconectado / Erro</span>';
        }
    }
    if (diagCheck && nut.last_checked) {
        diagCheck.innerText = nut.last_checked;
    }
}

async function saveNutConfig(e) {
    if (e) e.preventDefault();
    const payload = {
        host: document.getElementById('nut-conf-host').value.trim(),
        port: parseInt(document.getElementById('nut-conf-port').value) || 3493,
        ups_name: document.getElementById('nut-conf-upsname').value.trim(),
        username: document.getElementById('nut-conf-user').value.trim(),
        password: document.getElementById('nut-conf-pass').value,
        poll_interval: parseFloat(document.getElementById('nut-conf-poll').value) || 2.0,
        timeout: parseFloat(document.getElementById('nut-conf-timeout').value) || 5.0
    };

    try {
        const res = await fetch('/api/connections/nut', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            swalEnging.fire({
                icon: 'success',
                title: 'Parâmetros NUT Atualizados!',
                timer: 1500,
                showConfirmButton: false
            });
            loadConnectionsData();
        }
    } catch (err) {
        swalEnging.fire('Erro', 'Falha ao guardar configuração NUT: ' + err, 'error');
    }
}

async function testNutConnectionLive() {
    const host = document.getElementById('nut-conf-host') ? document.getElementById('nut-conf-host').value.trim() : '10.255.255.28';
    const port = document.getElementById('nut-conf-port') ? parseInt(document.getElementById('nut-conf-port').value) : 3493;
    const upsName = document.getElementById('nut-conf-upsname') ? document.getElementById('nut-conf-upsname').value.trim() : 'ups';
    const user = document.getElementById('nut-conf-user') ? document.getElementById('nut-conf-user').value.trim() : 'enging';
    const pass = document.getElementById('nut-conf-pass') ? document.getElementById('nut-conf-pass').value : '';

    const resBox = document.getElementById('nut-test-result-box');
    const resMsg = document.getElementById('nut-test-result-msg');
    const resSub = document.getElementById('nut-test-result-sub');

    swalEnging.fire({
        title: 'A testar Socket NUT...',
        text: `Conectando a ${host}:${port}...`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch('/api/connections/nut/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, ups_name: upsName, username: user, password: pass })
        });
        const data = await res.json();

        if (data.success) {
            swalEnging.fire({
                icon: 'success',
                title: 'Socket NUT Conectado!',
                html: `
                    <div class="text-left font-mono text-xs space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200 mt-2">
                        <p class="text-emerald-700 font-bold">✔ Latência: ${data.latency_ms} ms</p>
                        <p class="text-slate-700">Versão: ${data.version || 'NUT Daemon'}</p>
                        <p class="text-slate-600">Dispositivos detetados: ${data.ups_list || 'ups'}</p>
                    </div>
                `
            });
            if (resBox && resMsg) {
                resBox.className = 'p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 space-y-1';
                resMsg.innerText = `Ligação Socket ativa (${data.latency_ms}ms)`;
                resSub.innerText = `${data.version || 'upsd 2.8.1'} | Dispositivo '${upsName}' OK`;
                resBox.classList.remove('hidden');
            }
        } else {
            swalEnging.fire({
                icon: 'error',
                title: 'Falha na Ligação Socket',
                text: data.message || data.error
            });
            if (resBox && resMsg) {
                resBox.className = 'p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-1';
                resMsg.innerText = `Erro de conexão (${data.latency_ms}ms)`;
                resSub.innerText = data.error || 'Verifique se o upsd está em execução';
                resBox.classList.remove('hidden');
            }
        }
        loadConnectionsData();
    } catch (err) {
        swalEnging.fire('Erro', 'Falha ao executar teste: ' + err, 'error');
    }
}

// --- PROXMOX VE (SSH) ---

function renderProxmoxTable() {
    const tbody = document.getElementById('proxmox-tbody');
    if (!tbody) return;

    const servers = allConnectionsData.proxmox_servers || [];
    if (servers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-slate-400">
                    <i data-lucide="cpu" class="w-8 h-8 mx-auto mb-2 opacity-30"></i>
                    <p>Nenhum nó ou servidor Proxmox VE cadastrado.</p>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }

    tbody.innerHTML = servers.map(s => {
        const isOnline = s.status === 'online';
        const isError = s.status === 'error';
        const statusBadge = isOnline
            ? '<span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">Online (SSH)</span>'
            : isError
            ? '<span class="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">Erro SSH</span>'
            : '<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold">Não testado</span>';

        const authLabel = s.auth_type === 'key' ? 'Chave Privada SSH' : 'Palavra-passe SSH';
        const userLabel = s.username || 'root';

        return `
            <tr class="hover:bg-slate-50/70 transition">
                <td class="p-3.5 font-bold text-slate-800">${s.name}</td>
                <td class="p-3.5 font-mono text-slate-600">${s.host}:${s.port || 22}</td>
                <td class="p-3.5 text-slate-700 font-mono text-[11px] font-medium"><span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">SSH CLI</span></td>
                <td class="p-3.5 text-slate-600 font-medium">${authLabel}</td>
                <td class="p-3.5 font-mono text-slate-700 text-[11px] font-bold">${userLabel}</td>
                <td class="p-3.5">${statusBadge}</td>
                <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
                    <button onclick="testProxmox('${s.id}')" title="Testar Conexão SSH" class="px-2.5 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-enging-orange font-bold text-[11px] border border-orange-200 transition inline-flex items-center gap-1 shadow-xs">
                        <i data-lucide="play" class="w-3 h-3"></i> Testar SSH
                    </button>
                    <button onclick="openProxmoxModal('${s.id}')" title="Editar" class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition inline-flex items-center shadow-xs">
                        <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                    </button>
                    <button onclick="deleteProxmox('${s.id}')" title="Eliminar" class="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition inline-flex items-center shadow-xs">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    lucide.createIcons();
}

function openProxmoxModal(serverId = null) {
    const s = serverId ? (allConnectionsData.proxmox_servers || []).find(x => x.id === serverId) : null;
    const isEdit = !!s;

    swalEnging.fire({
        title: isEdit ? 'Editar Nó Proxmox VE (SSH)' : 'Adicionar Nó Proxmox VE (SSH)',
        html: `
            <div class="text-left space-y-3 font-sans text-xs">
                <div>
                    <label class="block font-bold text-slate-700 mb-1">Nome do Servidor / Nó Proxmox</label>
                    <input id="pve-name" class="w-full px-3 py-2 border border-slate-200 rounded-xl" placeholder="ex: Host Proxmox PVE 01" value="${s ? s.name : ''}">
                </div>
                <div class="grid grid-cols-3 gap-2">
                    <div class="col-span-2">
                        <label class="block font-bold text-slate-700 mb-1">Host / Endereço IP</label>
                        <input id="pve-host" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="192.168.4.10" value="${s ? s.host : ''}">
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Porta SSH</label>
                        <input id="pve-port" type="number" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" value="${s ? s.port || 22 : 22}">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Utilizador SSH</label>
                        <input id="pve-user" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="root" value="${s ? s.username || 'root' : 'root'}">
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Método de Autenticação</label>
                        <select id="pve-auth-type" onchange="togglePveAuthFields()" class="w-full px-3 py-2 border border-slate-200 rounded-xl">
                            <option value="password" ${(!s || s.auth_type !== 'key') ? 'selected' : ''}>Palavra-passe SSH (Password)</option>
                            <option value="key" ${s && s.auth_type === 'key' ? 'selected' : ''}>Chave Privada SSH (Private Key)</option>
                        </select>
                    </div>
                </div>

                <div id="pve-pass-fields" class="space-y-1.5 p-3 bg-slate-50 rounded-xl border border-slate-200 ${s && s.auth_type === 'key' ? 'hidden' : ''}">
                    <label class="block font-bold text-slate-700 mb-0.5">Palavra-passe SSH</label>
                    <input id="pve-pass" type="password" class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs" placeholder="${s && s.has_password ? '•••••••• (Inalterada)' : 'Senha de root ou utilizador'}">
                </div>

                <div id="pve-key-fields" class="space-y-1.5 p-3 bg-slate-50 rounded-xl border border-slate-200 ${s && s.auth_type === 'key' ? '' : 'hidden'}">
                    <label class="block font-bold text-slate-700 mb-0.5">Chave Privada RSA / Ed25519 (PEM/OpenSSH)</label>
                    <textarea id="pve-key" rows="3" class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-[10px]" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----">${s ? s.private_key || '' : ''}</textarea>
                </div>

                <div>
                    <label class="block font-bold text-slate-700 mb-1">Comando de Desligamento Padrão</label>
                    <input id="pve-shutdown-cmd" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs" placeholder="shutdown -h now" value="${s ? s.custom_shutdown_cmd || 'shutdown -h now' : 'shutdown -h now'}">
                    <span class="text-[10px] text-slate-400 mt-0.5 block">Comando executado via SSH pelo orquestrador durante o desligamento de emergência.</span>
                </div>
            </div>
        `,
        width: '540px',
        showCancelButton: true,
        confirmButtonText: isEdit ? 'Atualizar Nó Proxmox' : 'Salvar Nó Proxmox',
        cancelButtonText: 'Cancelar',
        didOpen: () => lucide.createIcons(),
        preConfirm: () => {
            const name = document.getElementById('pve-name').value.trim();
            const host = document.getElementById('pve-host').value.trim();
            if (!name || !host) {
                Swal.showValidationMessage('Preencha o Nome e o Endereço IP do Proxmox');
                return false;
            }
            return {
                id: s ? s.id : undefined,
                name: name,
                host: host,
                port: parseInt(document.getElementById('pve-port').value) || 22,
                node_name: document.getElementById('pve-name').value.trim(),
                auth_type: document.getElementById('pve-auth-type').value,
                username: document.getElementById('pve-user').value.trim() || 'root',
                password: document.getElementById('pve-pass').value,
                private_key: document.getElementById('pve-key') ? document.getElementById('pve-key').value.trim() : '',
                custom_shutdown_cmd: document.getElementById('pve-shutdown-cmd').value.trim() || 'shutdown -h now',
                enabled: true
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/connections/proxmox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: 'Nó Proxmox Gravado com Sucesso!',
                        timer: 1200,
                        showConfirmButton: false
                    });
                    loadConnectionsData();
                }
            } catch (err) {
                swalEnging.fire('Erro', 'Falha ao gravar nó Proxmox: ' + err, 'error');
            }
        }
    });
}

function togglePveAuthFields() {
    const authType = document.getElementById('pve-auth-type').value;
    const passBox = document.getElementById('pve-pass-fields');
    const keyBox = document.getElementById('pve-key-fields');
    if (authType === 'key') {
        keyBox.classList.remove('hidden');
        passBox.classList.add('hidden');
    } else {
        keyBox.classList.add('hidden');
        passBox.classList.remove('hidden');
    }
}

async function deleteProxmox(id) {
    const confirm = await swalEnging.fire({
        title: 'Eliminar Nó Proxmox?',
        text: 'Esta ação não poderá ser desfeita.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sim, Eliminar',
        cancelButtonText: 'Cancelar'
    });
    if (confirm.isConfirmed) {
        try {
            await fetch(`/api/connections/proxmox/${id}`, { method: 'DELETE' });
            loadConnectionsData();
        } catch (e) {
            swalEnging.fire('Erro', 'Falha ao eliminar: ' + e, 'error');
        }
    }
}

async function testProxmox(id) {
    swalEnging.fire({
        title: 'Testando Conexão SSH ao Proxmox...',
        text: 'Conectando via SSH e consultando versão...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`/api/connections/proxmox/test/${id}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            swalEnging.fire({
                icon: 'success',
                title: 'Conexão SSH Proxmox OK!',
                html: `
                    <div class="text-left font-mono text-xs space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200 mt-2">
                        <p class="text-emerald-700 font-bold">✔ Latência SSH: ${data.latency_ms} ms</p>
                        <p class="text-slate-800 font-bold">Host: ${data.hostname || 'Proxmox'}</p>
                        <p class="text-slate-700">Versão: ${data.version || 'Proxmox VE'}</p>
                        <p class="text-slate-600">Inventário: ${data.vm_count || 0} Máquinas Virtuais (KVM) | ${data.lxc_count || 0} Containers (LXC)</p>
                    </div>
                `
            });
        } else {
            swalEnging.fire({
                icon: 'error',
                title: 'Falha na Conexão SSH Proxmox',
                text: data.message || data.error
            });
        }
        loadConnectionsData();
    } catch (e) {
        swalEnging.fire('Erro', 'Falha ao testar conexão SSH: ' + e, 'error');
    }
}

// --- VMWARE ESXI / VCENTER ---

function renderVmwareTable() {
    const tbody = document.getElementById('vmware-tbody');
    if (!tbody) return;

    const servers = allConnectionsData.vmware_servers || [];
    if (servers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-slate-400">
                    <i data-lucide="box" class="w-8 h-8 mx-auto mb-2 opacity-30"></i>
                    <p>Nenhum servidor VMware ESXi / vCenter cadastrado.</p>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }

    tbody.innerHTML = servers.map(s => {
        const isOnline = s.status === 'online';
        const isError = s.status === 'error';
        const statusBadge = isOnline
            ? '<span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">Online</span>'
            : isError
            ? '<span class="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">Erro</span>'
            : '<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold">Não testado</span>';

        const typeLabel = s.type === 'vcenter' ? 'vCenter Server' : 'Host ESXi Direto';
        const methodLabel = s.auth_type === 'ssh' ? 'SSH (CLI esxcli)' : 'REST API (HTTPS)';

        return `
            <tr class="hover:bg-slate-50/70 transition">
                <td class="p-3.5 font-bold text-slate-800">${s.name}</td>
                <td class="p-3.5 font-mono text-slate-600">${s.host}:${s.port || 443}</td>
                <td class="p-3.5 text-slate-600 font-medium">${typeLabel}</td>
                <td class="p-3.5 font-mono text-slate-700 text-[11px]">${methodLabel}</td>
                <td class="p-3.5 font-mono text-slate-600 text-[11px]">${s.username || 'root'}</td>
                <td class="p-3.5">${statusBadge}</td>
                <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
                    <button onclick="testVmware('${s.id}')" title="Testar Conexão" class="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] border border-blue-200 transition inline-flex items-center gap-1">
                        <i data-lucide="play" class="w-3 h-3"></i> Testar
                    </button>
                    <button onclick="openVmwareModal('${s.id}')" title="Editar" class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition inline-flex items-center">
                        <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                    </button>
                    <button onclick="deleteVmware('${s.id}')" title="Eliminar" class="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition inline-flex items-center">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    lucide.createIcons();
}

function openVmwareModal(serverId = null) {
    const s = serverId ? (allConnectionsData.vmware_servers || []).find(x => x.id === serverId) : null;
    const isEdit = !!s;

    swalEnging.fire({
        title: isEdit ? 'Editar Servidor VMware' : 'Adicionar Servidor VMware ESXi / vCenter',
        html: `
            <div class="text-left space-y-3 font-sans text-xs">
                <div>
                    <label class="block font-bold text-slate-700 mb-1">Nome do Servidor</label>
                    <input id="vmw-name" class="w-full px-3 py-2 border border-slate-200 rounded-xl" placeholder="ex: Host VMware ESXi 01" value="${s ? s.name : ''}">
                </div>
                <div class="grid grid-cols-3 gap-2">
                    <div class="col-span-2">
                        <label class="block font-bold text-slate-700 mb-1">Host / Endereço IP</label>
                        <input id="vmw-host" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="10.255.255.20" value="${s ? s.host : ''}">
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Porta</label>
                        <input id="vmw-port" type="number" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" value="${s ? s.port : 443}">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Tipo de Ambiente</label>
                        <select id="vmw-type" class="w-full px-3 py-2 border border-slate-200 rounded-xl">
                            <option value="esxi" ${s && s.type === 'esxi' ? 'selected' : ''}>Host ESXi Standalone</option>
                            <option value="vcenter" ${s && s.type === 'vcenter' ? 'selected' : ''}>VMware vCenter Server</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Método de Ligação</label>
                        <select id="vmw-auth-type" class="w-full px-3 py-2 border border-slate-200 rounded-xl">
                            <option value="rest_api" ${s && s.auth_type === 'rest_api' ? 'selected' : ''}>REST API (HTTPS)</option>
                            <option value="ssh" ${s && s.auth_type === 'ssh' ? 'selected' : ''}>SSH CLI (Porta 22)</option>
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Utilizador</label>
                        <input id="vmw-user" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="root" value="${s ? s.username || '' : 'root'}">
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Palavra-passe</label>
                        <input id="vmw-pass" type="password" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="${s && s.has_password ? '•••••••• (Inalterada)' : 'Senha do ESXi'}">
                    </div>
                </div>

                <div class="flex items-center gap-2 pt-1">
                    <input type="checkbox" id="vmw-ssl" ${s && s.verify_ssl ? 'checked' : ''} class="w-4 h-4 rounded text-blue-600">
                    <label for="vmw-ssl" class="text-slate-600 font-medium">Validar Certificado SSL</label>
                </div>
            </div>
        `,
        width: '540px',
        showCancelButton: true,
        confirmButtonText: isEdit ? 'Atualizar Servidor' : 'Salvar Servidor',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const name = document.getElementById('vmw-name').value.trim();
            const host = document.getElementById('vmw-host').value.trim();
            if (!name || !host) {
                Swal.showValidationMessage('Preencha o Nome e o Endereço IP do Servidor');
                return false;
            }
            return {
                id: s ? s.id : undefined,
                name: name,
                host: host,
                port: parseInt(document.getElementById('vmw-port').value) || 443,
                type: document.getElementById('vmw-type').value,
                auth_type: document.getElementById('vmw-auth-type').value,
                username: document.getElementById('vmw-user').value.trim() || 'root',
                password: document.getElementById('vmw-pass').value,
                verify_ssl: document.getElementById('vmw-ssl').checked,
                enabled: true
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/connections/vmware', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success) {
                    swalEnging.fire({
                        icon: 'success',
                        title: 'Servidor VMware Gravado!',
                        timer: 1200,
                        showConfirmButton: false
                    });
                    loadConnectionsData();
                }
            } catch (err) {
                swalEnging.fire('Erro', 'Falha ao gravar servidor: ' + err, 'error');
            }
        }
    });
}

async function deleteVmware(id) {
    const confirm = await swalEnging.fire({
        title: 'Eliminar Servidor VMware?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sim, Eliminar',
        cancelButtonText: 'Cancelar'
    });
    if (confirm.isConfirmed) {
        try {
            await fetch(`/api/connections/vmware/${id}`, { method: 'DELETE' });
            loadConnectionsData();
        } catch (e) {
            swalEnging.fire('Erro', 'Falha ao eliminar: ' + e, 'error');
        }
    }
}

async function testVmware(id) {
    swalEnging.fire({
        title: 'Testando Conexão VMware...',
        didOpen: () => Swal.showLoading()
    });

    try {
        const res = await fetch(`/api/connections/vmware/test/${id}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            swalEnging.fire({
                icon: 'success',
                title: 'Conexão VMware Concluída!',
                text: data.message
            });
        } else {
            swalEnging.fire({
                icon: 'error',
                title: 'Falha na Conexão VMware',
                text: data.message || data.error
            });
        }
        loadConnectionsData();
    } catch (e) {
        swalEnging.fire('Erro', 'Falha ao testar conexão: ' + e, 'error');
    }
}

// --- GATEWAYS DE MENSAGENS & APIS ---

// --- GATEWAYS DE MENSAGENS & APIS (LISTAGEM + MODAIS DE EDIÇÃO) ---

function renderGatewaysList() {
    const tbody = document.getElementById('gateways-tbody');
    if (!tbody) return;

    const ch = (allAlertsData && allAlertsData.channel_settings) ? allAlertsData.channel_settings : {};
    const wa = ch.whatsapp || {};
    const sms = ch.sms || {};
    const smtp = ch.smtp || {};
    const teams = ch.teams || {};
    const googleChat = ch.google_chat || {};
    const wh = ch.webhook || {};

    // 1. WhatsApp status info
    let waStatusBadge = '<span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-300 text-[10px] font-bold font-mono">Desconectado</span>';
    let waEndpoint = wa.api_url ? wa.api_url : 'Sessão Local (QR Code)';
    
    if (window.lastWaStatus && window.lastWaStatus.connected) {
        const p = window.lastWaStatus.user?.phone || 'Online';
        waStatusBadge = `<span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-bold font-mono">● Conectado (${p})</span>`;
        waEndpoint = `WhatsApp Web: ${window.lastWaStatus.user?.name || ''} (${p})`;
    } else if (window.lastWaStatus && window.lastWaStatus.state === 'qr') {
        waStatusBadge = '<span class="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-300 text-[10px] font-bold font-mono animate-pulse">● Aguardando Leitura QR</span>';
    } else if (wa.enabled) {
        waStatusBadge = '<span class="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-300 text-[10px] font-bold font-mono">Webhook Ativo</span>';
    }

    // 2. SMTP status info
    const smtpStatusBadge = smtp.enabled 
        ? '<span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-bold">Ativado</span>'
        : '<span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-medium">Desativado</span>';
    const smtpEndpoint = smtp.host ? `${smtp.host}:${smtp.port || 587} (${smtp.username || 'sem user'})` : 'Não configurado';

    // 3. SMS status info
    const smsStatusBadge = sms.enabled
        ? '<span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-bold">Ativado</span>'
        : '<span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-medium">Desativado</span>';
    const smsEndpoint = sms.api_url ? sms.api_url : 'Não configurado';

    // 4. Microsoft Teams status info
    const teamsStatusBadge = teams.enabled !== false && teams.webhook_url
        ? '<span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-bold">Ativado</span>'
        : '<span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-medium">Desativado</span>';
    const teamsEndpoint = teams.webhook_url ? teams.webhook_url : 'Não configurado';

    // 5. Google Chat status info
    const googleStatusBadge = googleChat.enabled !== false && googleChat.webhook_url
        ? '<span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-bold">Ativado</span>'
        : '<span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-medium">Desativado</span>';
    const googleEndpoint = googleChat.webhook_url ? googleChat.webhook_url : 'Não configurado';

    // 6. Generic Webhook status info
    const whStatusBadge = wh.enabled !== false && wh.default_url
        ? '<span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-bold">Ativado</span>'
        : '<span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-medium">Desativado</span>';
    const whEndpoint = wh.default_url ? wh.default_url : 'Não configurado';

    tbody.innerHTML = `
        <!-- 1. WhatsApp Web -->
        <tr class="hover:bg-slate-50/70 transition">
            <td class="p-3.5">
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 shadow-xs">
                        <i data-lucide="phone-call" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <div class="font-bold text-slate-800 text-xs">WhatsApp Web</div>
                        <div class="text-[11px] text-slate-500">Multi-Device via QR Code & Fallback Webhook</div>
                    </div>
                </div>
            </td>
            <td class="p-3.5">
                <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono text-[10px] font-bold border border-slate-200">Baileys WebSocket</span>
            </td>
            <td class="p-3.5 font-mono text-slate-600 text-[11px] max-w-xs truncate" title="${waEndpoint}">
                ${waEndpoint}
            </td>
            <td class="p-3.5">
                ${waStatusBadge}
            </td>
            <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
                <button onclick="openWhatsAppChatModal()" title="Abrir Chat Interativo WhatsApp" class="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-[11px] border border-emerald-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="message-square" class="w-3 h-3"></i> Testar Chat
                </button>
                <button onclick="openEditGatewayModal('whatsapp')" title="Configurações e QR Code" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-enging-navy font-bold text-[11px] border border-slate-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="edit-2" class="w-3 h-3 text-enging-orange"></i> Editar
                </button>
            </td>
        </tr>

        <!-- 2. Servidor SMTP -->
        <tr class="hover:bg-slate-50/70 transition">
            <td class="p-3.5">
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 shadow-xs">
                        <i data-lucide="mail" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <div class="font-bold text-slate-800 text-xs">Servidor SMTP (E-mail)</div>
                        <div class="text-[11px] text-slate-500">Notificações e relatórios de alarme por correio eletrónico</div>
                    </div>
                </div>
            </td>
            <td class="p-3.5">
                <span class="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-mono text-[10px] font-bold border border-purple-200">SMTP TLS / SSL</span>
            </td>
            <td class="p-3.5 font-mono text-slate-600 text-[11px] max-w-xs truncate" title="${smtpEndpoint}">
                ${smtpEndpoint}
            </td>
            <td class="p-3.5">
                ${smtpStatusBadge}
            </td>
            <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
                <button onclick="testChannelDirect('email')" title="Testar Envio" class="px-2.5 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-[11px] border border-purple-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="send" class="w-3 h-3"></i> Testar
                </button>
                <button onclick="openEditGatewayModal('smtp')" title="Editar Servidor SMTP" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-enging-navy font-bold text-[11px] border border-slate-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="edit-2" class="w-3 h-3 text-enging-orange"></i> Editar
                </button>
            </td>
        </tr>

        <!-- 3. SMS Gateway -->
        <tr class="hover:bg-slate-50/70 transition">
            <td class="p-3.5">
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 shadow-xs">
                        <i data-lucide="smartphone" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <div class="font-bold text-slate-800 text-xs">SMS Gateway API</div>
                        <div class="text-[11px] text-slate-500">Envio de alertas SMS críticos para telemóveis</div>
                    </div>
                </div>
            </td>
            <td class="p-3.5">
                <span class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-mono text-[10px] font-bold border border-blue-200">REST HTTP POST</span>
            </td>
            <td class="p-3.5 font-mono text-slate-600 text-[11px] max-w-xs truncate" title="${smsEndpoint}">
                ${smsEndpoint}
            </td>
            <td class="p-3.5">
                ${smsStatusBadge}
            </td>
            <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
                <button onclick="testChannelDirect('sms')" title="Testar SMS" class="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] border border-blue-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="send" class="w-3 h-3"></i> Testar
                </button>
                <button onclick="openEditGatewayModal('sms')" title="Editar SMS Gateway" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-enging-navy font-bold text-[11px] border border-slate-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="edit-2" class="w-3 h-3 text-enging-orange"></i> Editar
                </button>
            </td>
        </tr>

        <!-- 4. Microsoft Teams Webhook -->
        <tr class="hover:bg-slate-50/70 transition">
            <td class="p-3.5">
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-slate-100 border border-slate-200 shadow-xs flex items-center justify-center">
                        <svg class="w-4 h-4" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                        </svg>
                    </div>
                    <div>
                        <div class="font-bold text-slate-800 text-xs">Microsoft Teams Webhook</div>
                        <div class="text-[11px] text-slate-500">Notificações estruturadas para Canais Teams e Power Automate</div>
                    </div>
                </div>
            </td>
            <td class="p-3.5">
                <span class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 font-mono text-[10px] font-bold border border-blue-200">Adaptive Card / Flow</span>
            </td>
            <td class="p-3.5 font-mono text-slate-600 text-[11px] max-w-xs truncate" title="${teamsEndpoint}">
                ${teamsEndpoint}
            </td>
            <td class="p-3.5">
                ${teamsStatusBadge}
            </td>
            <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
                <button onclick="testChannelDirect('teams')" title="Testar Microsoft Teams" class="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] border border-blue-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="send" class="w-3 h-3"></i> Testar
                </button>
                <button onclick="openEditGatewayModal('teams')" title="Editar Microsoft Teams" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-enging-navy font-bold text-[11px] border border-slate-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="edit-2" class="w-3 h-3 text-enging-orange"></i> Editar
                </button>
            </td>
        </tr>

        <!-- 5. Google Chat Webhook -->
        <tr class="hover:bg-slate-50/70 transition">
            <td class="p-3.5">
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-slate-100 border border-slate-200 shadow-xs flex items-center justify-center">
                        <svg class="w-4 h-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                            <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                        </svg>
                    </div>
                    <div>
                        <div class="font-bold text-slate-800 text-xs">Google Chat Webhook</div>
                        <div class="text-[11px] text-slate-500">Notificações em cartões visuais para Google Spaces & Workspace</div>
                    </div>
                </div>
            </td>
            <td class="p-3.5">
                <span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-mono text-[10px] font-bold border border-emerald-200">CardsV2 / Spaces</span>
            </td>
            <td class="p-3.5 font-mono text-slate-600 text-[11px] max-w-xs truncate" title="${googleEndpoint}">
                ${googleEndpoint}
            </td>
            <td class="p-3.5">
                ${googleStatusBadge}
            </td>
            <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
                <button onclick="testChannelDirect('google_chat')" title="Testar Google Chat" class="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-[11px] border border-emerald-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="send" class="w-3 h-3"></i> Testar
                </button>
                <button onclick="openEditGatewayModal('google_chat')" title="Editar Google Chat" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-enging-navy font-bold text-[11px] border border-slate-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="edit-2" class="w-3 h-3 text-enging-orange"></i> Editar
                </button>
            </td>
        </tr>

        <!-- 6. Webhooks & SIEM Genérico -->
        <tr class="hover:bg-slate-50/70 transition">
            <td class="p-3.5">
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 shadow-xs">
                        <i data-lucide="webhook" class="w-4 h-4"></i>
                    </div>
                    <div>
                        <div class="font-bold text-slate-800 text-xs">Webhook Genérico & SIEM</div>
                        <div class="text-[11px] text-slate-500">Integração JSON genérica com Zabbix, Discord, Slack, n8n, Grafana, etc.</div>
                    </div>
                </div>
            </td>
            <td class="p-3.5">
                <span class="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-mono text-[10px] font-bold border border-amber-200">JSON REST POST</span>
            </td>
            <td class="p-3.5 font-mono text-slate-600 text-[11px] max-w-xs truncate" title="${whEndpoint}">
                ${whEndpoint}
            </td>
            <td class="p-3.5">
                ${whStatusBadge}
            </td>
            <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
                <button onclick="testChannelDirect('webhook')" title="Testar Webhook Genérico" class="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold text-[11px] border border-amber-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="send" class="w-3 h-3"></i> Testar
                </button>
                <button onclick="openEditGatewayModal('webhook')" title="Editar Webhook Genérico" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-enging-navy font-bold text-[11px] border border-slate-200 transition inline-flex items-center gap-1 shadow-xs">
                    <i data-lucide="edit-2" class="w-3 h-3 text-enging-orange"></i> Editar
                </button>
            </td>
        </tr>
    `;

    lucide.createIcons();
}

async function openEditGatewayModal(type) {
    const ch = (allAlertsData && allAlertsData.channel_settings) ? allAlertsData.channel_settings : {};
    const wa = ch.whatsapp || {};
    const sms = ch.sms || {};
    const smtp = ch.smtp || {};
    const teams = ch.teams || {};
    const googleChat = ch.google_chat || {};
    const wh = ch.webhook || {};

    if (type === 'whatsapp') {
        let statusData = { connected: false, state: 'disconnected', qr: null, user: null };
        try {
            const res = await fetch('/api/whatsapp/status?t=' + Date.now());
            if (res.ok) {
                statusData = await res.json();
                window.lastWaStatus = statusData;
            }
        } catch(e) {}

        let sessConf = { ...currentSessionConfig };
        try {
            const res = await fetch('/api/whatsapp/session-config?t=' + Date.now());
            if (res.ok) {
                const sdata = await res.json();
                if (sdata.config) {
                    sessConf = { ...sessConf, ...sdata.config };
                    currentSessionConfig = { ...currentSessionConfig, ...sdata.config };
                }
            }
        } catch(e) {}

        const isConn = statusData.connected;
        const phone = statusData.user?.phone || '';
        const name = statusData.user?.name || 'WhatsApp Web';

        swalEnging.fire({
            title: isConn ? 'WhatsApp Web Conectado' : 'Conectar WhatsApp Web',
            html: `
                <div class="text-left space-y-4 font-sans text-xs">
                    
                    <!-- Estado da Conexão e Sessão -->
                    <div class="p-3.5 rounded-2xl ${isConn ? 'bg-emerald-50 border border-emerald-200 text-emerald-900' : 'bg-amber-50 border border-amber-200 text-amber-900'} flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="p-2 rounded-xl ${isConn ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'} shadow-xs">
                                <i data-lucide="${isConn ? 'check-circle-2' : 'qr-code'}" class="w-5 h-5"></i>
                            </div>
                            <div>
                                <div class="font-bold text-xs">${isConn ? name : 'Aguardando Emparelhamento'}</div>
                                <div class="text-[11px] opacity-80">${isConn ? `Número: ${phone}` : 'Aponte a câmara para o código QR abaixo'}</div>
                            </div>
                        </div>
                        <span id="modal-wa-badge" class="px-2.5 py-0.5 rounded-full ${isConn ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} text-[10px] font-bold font-mono">
                            ${isConn ? '● Ativo' : '● QR Pendente'}
                        </span>
                    </div>

                    <!-- Bloco do QR Code ou Dados da Sessão Conectada -->
                    ${!isConn ? `
                        <div class="flex flex-col items-center justify-center p-4 bg-white rounded-2xl border border-slate-200 shadow-inner space-y-2">
                            <div class="relative w-48 h-48 flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                                <img id="modal-wa-qr" src="${statusData.qr || '/api/whatsapp/qr.png?t=' + Date.now()}" class="${statusData.qr ? '' : 'hidden'} w-full h-full object-contain p-2" />
                                <div id="modal-wa-spinner" class="${statusData.qr ? 'hidden' : ''} flex flex-col items-center justify-center gap-2 text-slate-400">
                                    <i data-lucide="loader-2" class="w-8 h-8 animate-spin text-emerald-600"></i>
                                    <span class="text-[11px] font-medium">A gerar QR Code...</span>
                                </div>
                            </div>
                            <button onclick="refreshModalWaQr()" type="button" class="text-[11px] text-emerald-700 hover:text-emerald-800 font-bold flex items-center gap-1">
                                <i data-lucide="refresh-cw" class="w-3 h-3"></i> Atualizar Código QR
                            </button>
                        </div>
                    ` : `
                        <!-- Informações da Sessão Ativa -->
                        <div class="p-3.5 bg-white rounded-2xl border border-slate-200 space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="text-slate-500">Nome da Sessão:</span>
                                <strong class="text-slate-800">${sessConf.name || 'Enging UPS Notifier ⚡'}</strong>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-slate-500">Telefone Conectado:</span>
                                <strong class="font-mono text-emerald-700 font-bold">${phone}</strong>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-slate-500">Engine:</span>
                                <span class="font-mono text-[11px] text-slate-600">Baileys WebSocket Multi-Device</span>
                            </div>
                            <div class="pt-2 flex justify-end">
                                <button type="button" onclick="logoutWhatsAppWeb()" class="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs flex items-center gap-1.5 transition">
                                    <i data-lucide="log-out" class="w-3.5 h-3.5"></i> Desconectar Conta
                                </button>
                            </div>
                        </div>
                    `}

                    <!-- Configurações de Personalização da Sessão -->
                    <div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                        <div class="font-bold text-slate-800 flex items-center gap-1.5 uppercase text-[11px]">
                            <i data-lucide="palette" class="w-3.5 h-3.5 text-enging-orange"></i> Personalização da Identidade da Sessão
                        </div>
                        <div>
                            <label class="block text-slate-600 font-bold mb-1">Nome do Remetente (Identificador nos alertas)</label>
                            <input type="text" id="modal-wa-sess-name" class="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-medium" placeholder="Enging UPS Notifier ⚡" value="${sessConf.name || 'Enging UPS Notifier ⚡'}">
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="block text-slate-600 font-bold mb-1">Ícone / Avatar</label>
                                <select id="modal-wa-sess-avatar" onchange="const u = document.getElementById('modal-wa-sess-url-box'); if(this.value==='custom') u.classList.remove('hidden'); else u.classList.add('hidden');" class="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white">
                                    <option value="enging" ${sessConf.avatar === 'enging' ? 'selected' : ''}>⚡ Enging Laranja</option>
                                    <option value="robot" ${sessConf.avatar === 'robot' ? 'selected' : ''}>🤖 Robô Assistente</option>
                                    <option value="server" ${sessConf.avatar === 'server' ? 'selected' : ''}>🖥️ Servidor Datacenter</option>
                                    <option value="battery" ${sessConf.avatar === 'battery' ? 'selected' : ''}>🔋 UPS & Bateria</option>
                                    <option value="shield" ${sessConf.avatar === 'shield' ? 'selected' : ''}>🛡️ Proteção Elétrica</option>
                                    <option value="custom" ${sessConf.avatar === 'custom' || sessConf.custom_avatar_url ? 'selected' : ''}>🌐 Imagem Personalizada</option>
                                </select>
                            </div>
                            <div id="modal-wa-sess-url-box" class="${(sessConf.avatar === 'custom' || sessConf.custom_avatar_url) ? '' : 'hidden'}">
                                <label class="block text-slate-600 font-bold mb-1">URL Imagem (HTTPS)</label>
                                <input type="text" id="modal-wa-sess-avatar-url" class="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-mono text-xs" placeholder="https://..." value="${sessConf.custom_avatar_url || ''}">
                            </div>
                        </div>
                    </div>

                    <!-- Configuração Opcional de Gateway Externo Fallback -->
                    <details class="group p-3 rounded-2xl border border-slate-200 bg-white">
                        <summary class="font-bold text-slate-700 cursor-pointer flex items-center justify-between text-xs">
                            <span class="flex items-center gap-1.5"><i data-lucide="globe" class="w-3.5 h-3.5 text-slate-500"></i> Gateway WhatsApp Externo (Fallback Opcional)</span>
                            <i data-lucide="chevron-down" class="w-4 h-4 transition group-open:rotate-180 text-slate-400"></i>
                        </summary>
                        <div class="space-y-3 pt-3 mt-2 border-t border-slate-100">
                            <div class="flex items-center justify-between">
                                <label for="modal-wa-enabled" class="text-slate-600 font-medium">Habilitar Gateway HTTP Externo</label>
                                <input type="checkbox" id="modal-wa-enabled" ${wa.enabled ? 'checked' : ''} class="w-4 h-4 rounded text-emerald-600">
                            </div>
                            <div>
                                <label class="block text-slate-600 font-bold mb-1">API Endpoint URL</label>
                                <input type="text" id="modal-wa-url" class="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-mono" placeholder="https://api.whatsapp-gateway.com/send" value="${wa.api_url || ''}">
                            </div>
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="block text-slate-600 font-bold mb-1">Instance / Sessão</label>
                                    <input type="text" id="modal-wa-inst" class="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-mono" placeholder="enging-ups" value="${wa.instance_id || ''}">
                                </div>
                                <div>
                                    <label class="block text-slate-600 font-bold mb-1">API Token / Key</label>
                                    <input type="password" id="modal-wa-token" class="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-mono" placeholder="••••••••" value="${wa.api_token || ''}">
                                </div>
                            </div>
                        </div>
                    </details>

                </div>
            `,
            width: '560px',
            showCancelButton: true,
            showDenyButton: isConn,
            denyButtonText: 'Abrir Chat de Teste',
            confirmButtonText: 'Guardar Configurações',
            cancelButtonText: 'Fechar',
            didOpen: () => {
                lucide.createIcons();
                
                if (!isConn) {
                    const pollFunc = async () => {
                        try {
                            const res = await fetch('/api/whatsapp/status?t=' + Date.now());
                            if (!res.ok) return;
                            const data = await res.json();
                            window.lastWaStatus = data;
                            const img = document.getElementById('modal-wa-qr');
                            const spin = document.getElementById('modal-wa-spinner');
                            const badge = document.getElementById('modal-wa-badge');
                            
                            if (data.connected) {
                                if (window.modalWaInterval) {
                                    clearInterval(window.modalWaInterval);
                                    window.modalWaInterval = null;
                                }
                                openEditGatewayModal('whatsapp');
                                refreshWhatsAppStatus(false);
                                renderGatewaysList();
                            } else if (data.qr && img) {
                                img.src = data.qr;
                                img.classList.remove('hidden');
                                if (spin) spin.classList.add('hidden');
                                if (badge) {
                                    badge.className = 'px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border-amber-300 border text-[10px] font-bold font-mono animate-pulse';
                                    badge.innerText = '● Aguardando Leitura QR';
                                }
                            }
                        } catch(e) {}
                    };

                    window.modalWaInterval = setInterval(pollFunc, 2500);
                }
            },
            willClose: () => {
                if (window.modalWaInterval) {
                    clearInterval(window.modalWaInterval);
                    window.modalWaInterval = null;
                }
            },
            preDeny: () => {
                openWhatsAppChatModal();
                return false;
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const sessName = document.getElementById('modal-wa-sess-name')?.value.trim() || 'Enging UPS Notifier ⚡';
                const sessAvatar = document.getElementById('modal-wa-sess-avatar')?.value || 'enging';
                const sessAvatarUrl = document.getElementById('modal-wa-sess-avatar-url')?.value.trim() || '';

                // 1. Salva Session Config (Baileys)
                try {
                    const sessRes = await fetch('/api/whatsapp/session-config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: sessName,
                            avatar: sessAvatar,
                            custom_avatar_url: sessAvatarUrl
                        })
                    });
                    if (sessRes.ok) {
                        currentSessionConfig = {
                            name: sessName,
                            avatar: sessAvatar,
                            custom_avatar_url: sessAvatarUrl
                        };
                    }
                } catch(e) {}

                // 2. Salva Canais & Fallback Webhook
                const updatedChannels = {
                    ...ch,
                    whatsapp: {
                        enabled: document.getElementById('modal-wa-enabled') ? document.getElementById('modal-wa-enabled').checked : false,
                        api_url: document.getElementById('modal-wa-url') ? document.getElementById('modal-wa-url').value.trim() : '',
                        instance_id: document.getElementById('modal-wa-inst') ? document.getElementById('modal-wa-inst').value.trim() : '',
                        api_token: document.getElementById('modal-wa-token') ? document.getElementById('modal-wa-token').value : '',
                        session_name: sessName,
                        session_avatar: sessAvatar,
                        session_avatar_url: sessAvatarUrl
                    }
                };
                await saveChannelsPayload(updatedChannels);
                renderGatewaysList();
            }
        });

    } else if (type === 'smtp') {
        swalEnging.fire({
            title: 'Configuração do Servidor SMTP (E-mail)',
            html: `
                <div class="text-left space-y-3 font-sans text-xs">
                    <div class="flex items-center justify-between p-3 rounded-xl bg-purple-50 border border-purple-200">
                        <span class="font-bold text-purple-900 flex items-center gap-2">
                            <i data-lucide="mail" class="w-4 h-4 text-purple-600"></i> Habilitar Envio de E-mails
                        </span>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="modal-smtp-enabled" ${smtp.enabled ? 'checked' : ''} class="sr-only peer">
                            <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                        </label>
                    </div>

                    <div class="grid grid-cols-3 gap-2">
                        <div class="col-span-2">
                            <label class="block text-slate-700 font-bold mb-1">Host SMTP</label>
                            <input type="text" id="modal-smtp-host" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="smtp.gmail.com" value="${smtp.host || 'smtp.gmail.com'}">
                        </div>
                        <div>
                            <label class="block text-slate-700 font-bold mb-1">Porta</label>
                            <input type="number" id="modal-smtp-port" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" value="${smtp.port || 587}">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-slate-700 font-bold mb-1">Utilizador / E-mail</label>
                            <input type="text" id="modal-smtp-user" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="alerts@enging.pt" value="${smtp.username || ''}">
                        </div>
                        <div>
                            <label class="block text-slate-700 font-bold mb-1">Senha / App Password</label>
                            <input type="password" id="modal-smtp-pass" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="••••••••" value="${smtp.password || ''}">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-slate-700 font-bold mb-1">Nome Remetente</label>
                            <input type="text" id="modal-smtp-fromname" class="w-full px-3 py-2 border border-slate-200 rounded-xl" placeholder="Enging UPS System" value="${smtp.from_name || 'Enging UPS System'}">
                        </div>
                        <div>
                            <label class="block text-slate-700 font-bold mb-1">E-mail Remetente</label>
                            <input type="text" id="modal-smtp-fromemail" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="alerts@enging.pt" value="${smtp.from_email || smtp.username || 'alerts@enging.pt'}">
                        </div>
                    </div>

                    <div class="flex items-center gap-2 pt-1">
                        <input type="checkbox" id="modal-smtp-tls" ${smtp.use_tls !== false ? 'checked' : ''} class="w-4 h-4 rounded text-purple-600">
                        <label for="modal-smtp-tls" class="text-slate-600 font-medium">Usar Conexão Segura TLS / STARTTLS</label>
                    </div>
                </div>
            `,
            width: '520px',
            showCancelButton: true,
            showDenyButton: true,
            denyButtonText: 'Testar Envio',
            confirmButtonText: 'Guardar SMTP',
            cancelButtonText: 'Cancelar',
            didOpen: () => lucide.createIcons(),
            preDeny: () => {
                testChannelDirect('email');
                return false;
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const updatedChannels = {
                    ...ch,
                    smtp: {
                        enabled: document.getElementById('modal-smtp-enabled').checked,
                        host: document.getElementById('modal-smtp-host').value.trim(),
                        port: parseInt(document.getElementById('modal-smtp-port').value) || 587,
                        use_tls: document.getElementById('modal-smtp-tls').checked,
                        username: document.getElementById('modal-smtp-user').value.trim(),
                        password: document.getElementById('modal-smtp-pass').value,
                        from_name: document.getElementById('modal-smtp-fromname').value.trim() || 'Enging UPS System',
                        from_email: document.getElementById('modal-smtp-fromemail').value.trim() || 'alerts@enging.pt'
                    }
                };
                await saveChannelsPayload(updatedChannels);
            }
        });

    } else if (type === 'sms') {
        swalEnging.fire({
            title: 'Configuração do SMS Gateway HTTP',
            html: `
                <div class="text-left space-y-3 font-sans text-xs">
                    <div class="flex items-center justify-between p-3 rounded-xl bg-blue-50 border border-blue-200">
                        <span class="font-bold text-blue-900 flex items-center gap-2">
                            <i data-lucide="smartphone" class="w-4 h-4 text-blue-600"></i> Habilitar Envio de SMS
                        </span>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="modal-sms-enabled" ${sms.enabled ? 'checked' : ''} class="sr-only peer">
                            <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    <div>
                        <label class="block text-slate-700 font-bold mb-1">API Endpoint URL (HTTP POST)</label>
                        <input type="text" id="modal-sms-url" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="https://api.sms-provider.com/v1/send" value="${sms.api_url || ''}">
                    </div>

                    <div>
                        <label class="block text-slate-700 font-bold mb-1">Bearer Token / Chave de API</label>
                        <input type="password" id="modal-sms-token" class="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono" placeholder="••••••••" value="${sms.api_token || ''}">
                    </div>

                    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600">
                        O sistema transmitirá um payload JSON contendo <code>{"to": "+351...", "message": "..."}</code> com cabeçalho <code>Authorization: Bearer &lt;Token&gt;</code>.
                    </div>
                </div>
            `,
            width: '500px',
            showCancelButton: true,
            showDenyButton: true,
            denyButtonText: 'Testar SMS',
            confirmButtonText: 'Guardar SMS',
            cancelButtonText: 'Cancelar',
            didOpen: () => lucide.createIcons(),
            preDeny: () => {
                testChannelDirect('sms');
                return false;
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const updatedChannels = {
                    ...ch,
                    sms: {
                        enabled: document.getElementById('modal-sms-enabled').checked,
                        api_url: document.getElementById('modal-sms-url').value.trim(),
                        api_token: document.getElementById('modal-sms-token').value
                    }
                };
                await saveChannelsPayload(updatedChannels);
            }
        });

    } else if (type === 'teams') {
        swalEnging.fire({
            title: 'Microsoft Teams Webhook',
            html: `
                <div class="text-left space-y-3 font-sans text-xs">
                    <div class="flex items-center justify-between p-3.5 rounded-2xl bg-blue-50 border border-blue-200">
                        <div class="flex items-center gap-2.5">
                            <div class="p-1.5 rounded-lg bg-white border border-blue-200 shadow-2xs">
                                <svg class="w-5 h-5" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                                    <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                                    <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                                    <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                                </svg>
                            </div>
                            <div>
                                <span class="font-bold text-blue-950 block">Habilitar Microsoft Teams</span>
                                <span class="text-[11px] text-blue-700">Disparo para Canais Teams e Power Automate Workflows</span>
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="modal-teams-enabled" ${teams.enabled !== false ? 'checked' : ''} class="sr-only peer">
                            <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    <div>
                        <label class="block text-slate-700 font-bold mb-1">Incoming Webhook / Power Automate URL</label>
                        <input type="text" id="modal-teams-url" class="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl font-mono text-xs focus:outline-none focus:border-blue-600" placeholder="https://enging.webhook.office.com/webhookb2/... ou https://prod-xx.westeurope.logic.azure.com/..." value="${teams.webhook_url || ''}">
                    </div>

                    <div>
                        <label class="block text-slate-700 font-bold mb-1">Formato do Payload JSON</label>
                        <select id="modal-teams-format" class="w-full px-3.5 py-2 border border-slate-200 rounded-xl bg-white font-medium focus:outline-none focus:border-blue-600">
                            <option value="adaptive_card" ${(teams.payload_format || 'adaptive_card') === 'adaptive_card' ? 'selected' : ''}>Adaptive Card 1.4 (Power Automate Workflows - Recomendado)</option>
                            <option value="message_card" ${teams.payload_format === 'message_card' ? 'selected' : ''}>MessageCard Legado (Conector O365 Antigo)</option>
                            <option value="attachments" ${teams.payload_format === 'attachments' ? 'selected' : ''}>Adaptive Card com Envelope de Anexos</option>
                            <option value="simple_text" ${teams.payload_format === 'simple_text' ? 'selected' : ''}>Texto Simples / Markdown</option>
                        </select>
                    </div>

                    <div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-[11px] text-slate-600 space-y-2">
                        <p class="font-bold text-slate-800 flex items-center gap-1.5">
                            <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i> Compatibilidade Oficial Microsoft Teams
                        </p>
                        <p class="leading-relaxed">Os novos fluxos do Teams criados pelo Power Automate (ação <em>"Post card in a chat or channel"</em>) exigem a estrutura nativa <strong>Adaptive Card 1.4</strong>. Inclui telemetria completa de tensão/bateria e botão de acesso direto ao Dashboard.</p>
                    </div>
                </div>
            `,
            width: '540px',
            showCancelButton: true,
            showDenyButton: true,
            denyButtonText: 'Testar Microsoft Teams',
            confirmButtonText: 'Guardar Teams',
            cancelButtonText: 'Cancelar',
            didOpen: () => lucide.createIcons(),
            preDeny: () => {
                testChannelDirect('teams');
                return false;
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const updatedChannels = {
                    ...ch,
                    teams: {
                        enabled: document.getElementById('modal-teams-enabled').checked,
                        webhook_url: document.getElementById('modal-teams-url').value.trim(),
                        payload_format: document.getElementById('modal-teams-format') ? document.getElementById('modal-teams-format').value : 'adaptive_card'
                    }
                };
                await saveChannelsPayload(updatedChannels);
            }
        });

    } else if (type === 'google_chat') {
        swalEnging.fire({
            title: 'Google Chat Webhook',
            html: `
                <div class="text-left space-y-3 font-sans text-xs">
                    <div class="flex items-center justify-between p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200">
                        <div class="flex items-center gap-2.5">
                            <div class="p-1.5 rounded-lg bg-white border border-emerald-200 shadow-2xs">
                                <svg class="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
                                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                                </svg>
                            </div>
                            <div>
                                <span class="font-bold text-emerald-950 block">Habilitar Google Chat</span>
                                <span class="text-[11px] text-emerald-700">Disparo para Google Workspace Spaces & Chat Rooms</span>
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="modal-google-enabled" ${googleChat.enabled !== false ? 'checked' : ''} class="sr-only peer">
                            <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                        </label>
                    </div>

                    <div>
                        <label class="block text-slate-700 font-bold mb-1">Google Workspace Space Webhook URL</label>
                        <input type="text" id="modal-google-url" class="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl font-mono text-xs focus:outline-none focus:border-emerald-600" placeholder="https://chat.googleapis.com/v1/spaces/AAAA.../messages?key=...&token=..." value="${googleChat.webhook_url || ''}">
                    </div>

                    <div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-[11px] text-slate-600 space-y-2">
                        <p class="font-bold text-slate-800 flex items-center gap-1.5">
                            <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i> Formato de Cartões Google CardsV2
                        </p>
                        <p class="leading-relaxed">As mensagens são formatadas nativamente no formato <strong>Google Chat CardsV2</strong>, com badges de status, tabela de telemetria da UPS e botão para abertura do painel web.</p>
                    </div>
                </div>
            `,
            width: '540px',
            showCancelButton: true,
            showDenyButton: true,
            denyButtonText: 'Testar Google Chat',
            confirmButtonText: 'Guardar Google Chat',
            cancelButtonText: 'Cancelar',
            didOpen: () => lucide.createIcons(),
            preDeny: () => {
                testChannelDirect('google_chat');
                return false;
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const updatedChannels = {
                    ...ch,
                    google_chat: {
                        enabled: document.getElementById('modal-google-enabled').checked,
                        webhook_url: document.getElementById('modal-google-url').value.trim()
                    }
                };
                await saveChannelsPayload(updatedChannels);
            }
        });

    } else if (type === 'webhook') {
        swalEnging.fire({
            title: 'Webhook Genérico & SIEM',
            html: `
                <div class="text-left space-y-3 font-sans text-xs">
                    <div class="flex items-center justify-between p-3.5 rounded-2xl bg-amber-50 border border-amber-200">
                        <div class="flex items-center gap-2.5">
                            <div class="p-2 rounded-xl bg-amber-100 text-amber-700 shadow-2xs">
                                <i data-lucide="webhook" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <span class="font-bold text-amber-950 block">Habilitar Webhook Genérico</span>
                                <span class="text-[11px] text-amber-700">Para Zabbix, Discord, Slack, n8n, Grafana, Home Assistant, etc.</span>
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="modal-wh-enabled" ${wh.enabled !== false ? 'checked' : ''} class="sr-only peer">
                            <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                        </label>
                    </div>

                    <div>
                        <label class="block text-slate-700 font-bold mb-1">Webhook Padrão (JSON POST)</label>
                        <input type="text" id="modal-wh-url" class="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl font-mono text-xs focus:outline-none focus:border-amber-500" placeholder="https://zabbix.enging.pt/api/webhook/ups" value="${wh.default_url || ''}">
                    </div>

                    <div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-[11px] text-slate-600 space-y-1.5">
                        <p class="font-bold text-slate-800">Formato do Payload JSON transmitido:</p>
                        <pre class="bg-white p-2.5 rounded-xl border border-slate-200 font-mono text-[10px] overflow-x-auto text-slate-800">{"event": "alert_triggered", "ups": "ups", "status": "OB DISCHRG", "battery_pct": 82, "input_voltage": 0.0, "output_voltage": 230.0, "timestamp": "..."}</pre>
                    </div>
                </div>
            `,
            width: '520px',
            showCancelButton: true,
            showDenyButton: true,
            denyButtonText: 'Testar Webhook',
            confirmButtonText: 'Guardar Webhook',
            cancelButtonText: 'Cancelar',
            didOpen: () => lucide.createIcons(),
            preDeny: () => {
                testChannelDirect('webhook');
                return false;
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const updatedChannels = {
                    ...ch,
                    webhook: {
                        enabled: document.getElementById('modal-wh-enabled').checked,
                        default_url: document.getElementById('modal-wh-url').value.trim()
                    }
                };
                await saveChannelsPayload(updatedChannels);
            }
        });
    }
}

async function saveChannelsPayload(payload) {
    try {
        const res = await fetch('/api/alerts/channels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            swalEnging.fire({
                icon: 'success',
                title: 'Configurações Gravadas com Sucesso!',
                timer: 1500,
                showConfirmButton: false
            });
            await loadAlertsData();
            renderGatewaysList();
        }
    } catch (e) {
        swalEnging.fire('Erro', 'Falha ao gravar configurações: ' + e, 'error');
    }
}

async function refreshModalWaQr() {
    const img = document.getElementById('modal-wa-qr');
    const spin = document.getElementById('modal-wa-spinner');
    if (spin) spin.classList.remove('hidden');
    if (img) img.classList.add('hidden');
    try {
        const res = await fetch('/api/whatsapp/status?t=' + Date.now());
        if (res.ok) {
            const data = await res.json();
            window.lastWaStatus = data;
            if (data.qr && img) {
                img.src = data.qr;
                img.classList.remove('hidden');
                if (spin) spin.classList.add('hidden');
                return;
            }
        }
    } catch(e) {}

    // Fallback direto para endpoint de imagem png
    if (img) {
        img.src = '/api/whatsapp/qr.png?t=' + Date.now();
        img.onload = () => {
            img.classList.remove('hidden');
            if (spin) spin.classList.add('hidden');
        };
    }
}

async function testChannelDirect(channel) {
    if (channel === 'whatsapp') {
        return openWhatsAppChatModal();
    }

    const ch = (allAlertsData && allAlertsData.channel_settings) ? allAlertsData.channel_settings : {};
    const recipients = (allAlertsData && allAlertsData.recipients) ? allAlertsData.recipients : [];

    let title = '';
    let targetLabel = '';
    let defaultTarget = '';
    let placeholder = '';
    let availableRecs = [];

    if (channel === 'email') {
        title = 'Testar Servidor SMTP (E-mail)';
        targetLabel = 'Endereço de E-mail de Destino';
        placeholder = 'admin@enging.pt';
        defaultTarget = ch.smtp?.from_email || ch.smtp?.username || '';
        availableRecs = recipients.filter(r => r.email);
    } else if (channel === 'sms') {
        title = 'Testar Gateway SMS';
        targetLabel = 'Número de Telemóvel para SMS';
        placeholder = '+351912345678';
        defaultTarget = '+351912345678';
        availableRecs = recipients.filter(r => r.phone_sms);
    } else if (channel === 'teams') {
        title = 'Testar Microsoft Teams Webhook';
        targetLabel = 'Endpoint URL do Teams (POST)';
        placeholder = 'https://enging.webhook.office.com/... ou Flow URL';
        defaultTarget = ch.teams?.webhook_url || '';
        availableRecs = recipients.filter(r => r.teams_webhook || r.webhook_url);
    } else if (channel === 'google_chat') {
        title = 'Testar Google Chat Webhook';
        targetLabel = 'Endpoint URL do Google Chat Space (POST)';
        placeholder = 'https://chat.googleapis.com/v1/spaces/...';
        defaultTarget = ch.google_chat?.webhook_url || '';
        availableRecs = recipients.filter(r => r.google_chat_webhook || r.webhook_url);
    } else if (channel === 'webhook') {
        title = 'Testar Webhook Genérico & SIEM';
        targetLabel = 'Endpoint URL do Webhook (POST)';
        placeholder = 'https://webhook.site/...';
        defaultTarget = ch.webhook?.default_url || '';
        availableRecs = recipients.filter(r => r.webhook_url);
    }

    let initialRecTarget = availableRecs[0] 
        ? (channel === 'email' ? availableRecs[0].email : (channel === 'sms' ? availableRecs[0].phone_sms : (channel === 'teams' ? (availableRecs[0].teams_webhook || availableRecs[0].webhook_url) : (channel === 'google_chat' ? (availableRecs[0].google_chat_webhook || availableRecs[0].webhook_url) : availableRecs[0].webhook_url)))) 
        : defaultTarget;

    const modalHtml = `
        <div class="text-left space-y-3 font-sans text-xs">
            <p class="text-slate-500 text-xs">Escolha o destinatário a partir dos <strong>Contatos Cadastrados</strong> no sistema ou informe um destino manual:</p>
            
            <div>
                <label class="block font-bold text-slate-700 uppercase mb-1">Selecionar Contato / Destinatário</label>
                <select id="swal-test-rec-select" onchange="onTestChannelRecSelect(this)" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-bold focus:outline-none focus:border-enging-orange">
                    <optgroup label="📋 Contatos Cadastrados">
                        ${availableRecs.map(r => {
                            const val = channel === 'email' ? r.email : (channel === 'sms' ? r.phone_sms : (channel === 'teams' ? (r.teams_webhook || r.webhook_url) : (channel === 'google_chat' ? (r.google_chat_webhook || r.webhook_url) : r.webhook_url)));
                            return `<option value="${val}" data-rec-id="${r.id}" data-rec-name="${r.name}">👤 ${r.name} (${val})</option>`;
                        }).join('')}
                    </optgroup>
                    <optgroup label="✏️ Personalizado">
                        <option value="custom" ${availableRecs.length === 0 ? 'selected' : ''}>Inserir Destino Manualmente...</option>
                    </optgroup>
                </select>
            </div>

            <div>
                <label class="block font-bold text-slate-700 uppercase mb-1">${targetLabel}</label>
                <input id="swal-test-target-input" class="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 font-mono text-xs focus:outline-none focus:border-enging-orange" placeholder="${placeholder}" value="${initialRecTarget}">
            </div>

            <div class="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] flex items-center gap-2">
                <i data-lucide="send" class="w-4 h-4 text-blue-600 shrink-0"></i>
                <span>Uma mensagem real de alarme de teste será transmitida para o destino selecionado.</span>
            </div>
        </div>
    `;

    swalEnging.fire({
        title: title,
        html: modalHtml,
        width: '500px',
        showCancelButton: true,
        confirmButtonText: 'Transmitir Teste Agora',
        cancelButtonText: 'Cancelar',
        didOpen: () => {
            lucide.createIcons();
            window.onTestChannelRecSelect = (sel) => {
                const targetInput = document.getElementById('swal-test-target-input');
                if (!targetInput) return;
                if (sel.value !== 'custom') {
                    targetInput.value = sel.value;
                } else {
                    targetInput.value = '';
                    targetInput.focus();
                }
            };
        },
        preConfirm: () => {
            const target = document.getElementById('swal-test-target-input').value.trim();
            if (!target) {
                Swal.showValidationMessage('Informe o destino do teste.');
                return false;
            }
            const sel = document.getElementById('swal-test-rec-select');
            const selectedOpt = sel ? sel.options[sel.selectedIndex] : null;
            const recId = selectedOpt && selectedOpt.getAttribute('data-rec-id') ? selectedOpt.getAttribute('data-rec-id') : '';
            const recName = selectedOpt && selectedOpt.getAttribute('data-rec-name') ? selectedOpt.getAttribute('data-rec-name') : '';
            return { target, recId, recName };
        }
    }).then(async (result) => {
        if (result.isConfirmed && result.value) {
            await executeLiveChannelDispatch(channel, result.value.target, result.value.recId, result.value.recName);
        }
    });
}

async function executeLiveChannelDispatch(channel, target, recId = '', recName = '') {
    const channelNames = {
        whatsapp: 'WhatsApp Web',
        email: 'Email (SMTP)',
        sms: 'SMS Gateway',
        teams: 'Microsoft Teams',
        google_chat: 'Google Chat',
        webhook: 'Webhook Genérico & SIEM'
    };

    const cName = channelNames[channel] || channel.toUpperCase();

    swalEnging.fire({
        title: 'Transmitindo Notificação...',
        html: `
            <div class="text-left space-y-3 font-sans text-xs py-1">
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div class="flex justify-between items-center text-slate-500">
                        <span>Canal de Transmissão:</span>
                        <span class="font-bold text-slate-800 uppercase">${cName}</span>
                    </div>
                    <div class="flex justify-between items-center text-slate-500">
                        <span>Destinatário / Alvo:</span>
                        <span class="font-mono font-bold text-slate-800 break-all">${target || (recName ? recName : 'Padrão')}</span>
                    </div>
                </div>
                <div class="flex items-center justify-center gap-2 text-slate-500 pt-1">
                    <i data-lucide="loader-2" class="w-4 h-4 animate-spin text-enging-orange"></i>
                    <span>Aguardando resposta do servidor em tempo real...</span>
                </div>
            </div>
        `,
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => {
            lucide.createIcons();
            Swal.showLoading();
        }
    });

    try {
        const payload = { channel, target };
        if (recId) payload.recipient_id = recId;

        const res = await fetch('/api/alerts/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        // Atualiza os registos de alerta e tabela de histórico em tempo real
        loadAlertsData();

        if (data.success) {
            swalEnging.fire({
                icon: 'success',
                title: 'Notificação Enviada com Sucesso!',
                html: `
                    <div class="text-left font-sans text-xs space-y-3 mt-2">
                        <div class="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-1.5">
                            <div class="flex items-center justify-between">
                                <span class="font-bold flex items-center gap-1.5 text-emerald-800">
                                    <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600"></i> Transmissão Concluída
                                </span>
                                <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono text-[10px] font-bold">
                                    ${data.latency_ms || 0} ms
                                </span>
                            </div>
                            <p class="text-xs text-emerald-900 font-medium">${data.message || 'Mensagem entregue com êxito pelo canal.'}</p>
                        </div>

                        <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-slate-700 text-xs">
                            <div class="flex justify-between items-center"><span class="text-slate-500">Canal:</span> <strong class="uppercase text-slate-800">${data.channel || channel}</strong></div>
                            <div class="flex justify-between items-center"><span class="text-slate-500">Destino:</span> <strong class="font-mono text-slate-800">${data.target || target}</strong></div>
                            ${data.detail ? `<div class="flex justify-between items-center"><span class="text-slate-500">Diagnóstico:</span> <span class="font-mono text-[11px] text-slate-600">${data.detail}</span></div>` : ''}
                            <div class="flex justify-between items-center"><span class="text-slate-500">Carimbo de Data/Hora:</span> <span class="font-mono text-[11px] text-slate-600">${new Date().toLocaleString('pt-PT')}</span></div>
                        </div>

                        <div class="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] flex items-center gap-2">
                            <i data-lucide="info" class="w-4 h-4 text-blue-600 shrink-0"></i>
                            <span>O registo deste disparo foi gravado no <strong>Histórico de Envios</strong>.</span>
                        </div>
                    </div>
                `,
                confirmButtonText: 'Fechar',
                confirmButtonColor: '#10b981',
                didOpen: () => lucide.createIcons()
            });
        } else {
            swalEnging.fire({
                icon: 'error',
                title: 'Falha no Envio do Teste',
                html: `
                    <div class="text-left font-sans text-xs space-y-3 mt-2">
                        <div class="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 space-y-1.5">
                            <div class="flex items-center justify-between">
                                <span class="font-bold flex items-center gap-1.5 text-rose-800">
                                    <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-600"></i> Não foi possível transmitir
                                </span>
                                <span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-mono text-[10px] font-bold">
                                    ${data.latency_ms || 0} ms
                                </span>
                            </div>
                            <p class="text-xs text-rose-900 font-medium">${data.message || 'Erro durante a transmissão.'}</p>
                        </div>

                        <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-slate-700 text-xs">
                            <div class="flex justify-between items-center"><span class="text-slate-500">Canal:</span> <strong class="uppercase text-slate-800">${data.channel || channel}</strong></div>
                            <div class="flex justify-between items-center"><span class="text-slate-500">Destino:</span> <strong class="font-mono text-slate-800">${data.target || target}</strong></div>
                            ${data.detail ? `
                                <div class="pt-1">
                                    <span class="text-slate-500 block mb-1">Diagnóstico do Erro:</span>
                                    <pre class="p-2.5 rounded-xl bg-slate-900 text-rose-300 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap max-h-32">${data.detail}</pre>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `,
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#e11d48',
                didOpen: () => lucide.createIcons()
            });
        }
    } catch (e) {
        swalEnging.fire('Erro de Conexão', 'Falha ao comunicar com o servidor: ' + e, 'error');
    }
}

// --- API TOKENS & DOCUMENTAÇÃO ---

function renderApiTokensTable() {
    const tbody = document.getElementById('api-tokens-tbody');
    if (!tbody) return;

    const tokens = allConnectionsData.api_tokens || [];
    if (tokens.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="p-8 text-center text-slate-400">
                    <i data-lucide="key" class="w-8 h-8 mx-auto mb-2 opacity-30"></i>
                    <p>Nenhuma Chave de API externa ativa.</p>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }

    tbody.innerHTML = tokens.map(t => {
        const permBadge = t.permissions === 'full_admin'
            ? '<span class="px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">Admin Total</span>'
            : t.permissions === 'read_write'
            ? '<span class="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">Leitura & Escrita</span>'
            : '<span class="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">Apenas Leitura (Read-Only)</span>';

        return `
            <tr class="hover:bg-slate-50/70 transition">
                <td class="p-3.5 font-bold text-slate-800">${t.name}</td>
                <td class="p-3.5 font-mono text-slate-700 text-xs">
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-1 rounded bg-slate-100 border border-slate-200 font-mono">${t.prefix || 'eng_live_••••'}</span>
                        <button onclick="copyToClipboard('${t.token}')" title="Copiar Token" class="p-1 rounded hover:bg-slate-200 text-slate-500 transition">
                            <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </td>
                <td class="p-3.5">${permBadge}</td>
                <td class="p-3.5 text-slate-500 font-mono text-[11px]">${t.created_at || '-'}</td>
                <td class="p-3.5 text-slate-500 font-mono text-[11px]">${t.last_used || 'Nunca'}</td>
                <td class="p-3.5 text-right whitespace-nowrap">
                    <button onclick="deleteApiToken('${t.id}')" title="Revogar Chave" class="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold text-[11px] transition inline-flex items-center gap-1">
                        <i data-lucide="trash-2" class="w-3 h-3"></i> Revogar
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    lucide.createIcons();
}

function openCreateTokenModal() {
    swalEnging.fire({
        title: 'Gerar Nova Chave de API (Bearer Token)',
        html: `
            <div class="text-left space-y-3 font-sans text-xs">
                <div>
                    <label class="block font-bold text-slate-700 mb-1">Nome / Aplicação de Destino</label>
                    <input id="token-name" class="w-full px-3 py-2 border border-slate-200 rounded-xl" placeholder="ex: Dashboard Grafana ou Zabbix Agent">
                </div>
                <div>
                    <label class="block font-bold text-slate-700 mb-1">Nível de Permissão</label>
                    <select id="token-perms" class="w-full px-3 py-2 border border-slate-200 rounded-xl">
                        <option value="read_only">Apenas Leitura (GET /api/v1/status)</option>
                        <option value="read_write">Leitura & Automação (Planos & Desligamento)</option>
                        <option value="full_admin">Administrador Total</option>
                    </select>
                </div>
                <div class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                    O token de autenticação será gerado com o prefixo <code>eng_live_</code> e exibido para cópia.
                </div>
            </div>
        `,
        width: '480px',
        showCancelButton: true,
        confirmButtonText: 'Gerar Chave Agora',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const name = document.getElementById('token-name').value.trim();
            if (!name) {
                Swal.showValidationMessage('Insira um nome para a aplicação/chave');
                return false;
            }
            return {
                name: name,
                permissions: document.getElementById('token-perms').value
            };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/connections/tokens/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success && data.token) {
                    swalEnging.fire({
                        icon: 'success',
                        title: 'Chave de API Criada!',
                        html: `
                            <div class="text-left space-y-2 mt-2">
                                <p class="text-xs text-slate-600">Copie o seu token Bearer agora. Por segurança, guarde-o num local seguro:</p>
                                <div class="p-3 rounded-xl bg-slate-900 text-emerald-400 font-mono text-xs break-all select-all flex items-center justify-between gap-2">
                                    <span>${data.token.token}</span>
                                    <button onclick="copyToClipboard('${data.token.token}')" class="p-1 rounded bg-white/10 hover:bg-white/20 text-white transition">
                                        <i data-lucide="copy" class="w-4 h-4"></i>
                                    </button>
                                </div>
                            </div>
                        `,
                        didOpen: () => lucide.createIcons()
                    });
                    loadConnectionsData();
                }
            } catch (e) {
                swalEnging.fire('Erro', 'Falha ao gerar token: ' + e, 'error');
            }
        }
    });
}

async function deleteApiToken(id) {
    const confirm = await swalEnging.fire({
        title: 'Revogar Chave de API?',
        text: 'Qualquer sistema externo que utilize esta chave perderá acesso imediato.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sim, Revogar',
        cancelButtonText: 'Cancelar'
    });
    if (confirm.isConfirmed) {
        try {
            await fetch(`/api/connections/tokens/${id}`, { method: 'DELETE' });
            loadConnectionsData();
        } catch (e) {
            swalEnging.fire('Erro', 'Falha ao revogar token: ' + e, 'error');
        }
    }
}

function copySnippet(snippetId) {
    const el = document.getElementById(snippetId);
    if (!el) return;
    copyToClipboard(el.innerText);
}

function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            swalEnging.fire({
                icon: 'success',
                title: 'Copiado para a área de transferência!',
                timer: 1000,
                showConfirmButton: false
            });
        });
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        swalEnging.fire({
            icon: 'success',
            title: 'Copiado!',
            timer: 1000,
            showConfirmButton: false
        });
    }
}

// ------------------------------------------------------------- //
// GESTÃO DO WHATSAPP WEB (BAILEYS MULTI-DEVICE COM QR CODE)     //
// ------------------------------------------------------------- //

let waPollInterval = null;

async function refreshWhatsAppStatus(manual = false) {
    const badge = document.getElementById('wa-web-status-badge');
    const contactsBadge = document.getElementById('wa-contacts-status-badge');
    const qrContainer = document.getElementById('wa-qr-container');
    const connContainer = document.getElementById('wa-connected-container');
    const qrImg = document.getElementById('wa-qr-img');
    const qrSpinner = document.getElementById('wa-qr-spinner');
    const connInfo = document.getElementById('wa-connected-info');

    try {
        const res = await fetch('/api/whatsapp/status');
        const data = await res.json();
        window.lastWaStatus = data;
        if (currentSubView === 'gateways') {
            renderGatewaysList();
        }

        if (data.connected) {
            if (badge) {
                badge.className = 'px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-bold font-mono';
                badge.innerText = '● Conectado (Online)';
            }
            if (contactsBadge) {
                contactsBadge.className = 'px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 text-[10px] font-bold font-mono';
                contactsBadge.innerText = `● Conectado (${data.user?.phone || 'Online'})`;
            }
            if (qrContainer) qrContainer.classList.add('hidden');
            if (connContainer) connContainer.classList.remove('hidden');
            if (connInfo) {
                const phone = data.user?.phone || 'Conta Vinculada';
                const name = data.user?.name || 'WhatsApp Web';
                connInfo.innerText = `${name} (${phone}) • Pronto para envio de notificações em tempo real`;
            }
            if (manual) {
                swalEnging.fire({
                    icon: 'success',
                    title: 'WhatsApp Conectado!',
                    text: `Sessão ativa: ${data.user?.phone || ''}`,
                    timer: 1500,
                    showConfirmButton: false
                });
            }
        } else if (data.state === 'qr' && data.qr) {
            if (badge) {
                badge.className = 'px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-300 text-[10px] font-bold font-mono animate-pulse';
                badge.innerText = 'Aguardando Leitura QR';
            }
            if (contactsBadge) {
                contactsBadge.className = 'px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-300 text-[10px] font-bold font-mono';
                contactsBadge.innerText = '● Aguardando Leitura QR';
            }
            if (connContainer) connContainer.classList.add('hidden');
            if (qrContainer) qrContainer.classList.remove('hidden');
            if (qrImg) {
                qrImg.src = data.qr;
                qrImg.classList.remove('hidden');
            }
            if (qrSpinner) qrSpinner.classList.add('hidden');
            if (manual) {
                swalEnging.fire({
                    icon: 'info',
                    title: 'QR Code Atualizado!',
                    text: 'Aponte a câmara do WhatsApp no seu telemóvel para emparelhar.',
                    timer: 1500,
                    showConfirmButton: false
                });
            }

            // Auto-polling para detectar quando o utilizador escaneou com sucesso
            if (!waPollInterval && (currentSubView === 'gateways' || currentSubView === 'contacts')) {
                waPollInterval = setInterval(async () => {
                    if (currentSubView !== 'gateways' && currentSubView !== 'contacts') {
                        clearInterval(waPollInterval);
                        waPollInterval = null;
                        return;
                    }
                    try {
                        const checkRes = await fetch('/api/whatsapp/status');
                        const checkData = await checkRes.json();
                        if (checkData.connected) {
                            clearInterval(waPollInterval);
                            waPollInterval = null;
                            refreshWhatsAppStatus();
                            swalEnging.fire({
                                icon: 'success',
                                title: 'WhatsApp Vinculado com Sucesso!',
                                text: `Conta conectada: ${checkData.user?.phone || ''}`,
                                timer: 3000,
                                showConfirmButton: false
                            });
                        } else if (checkData.qr && checkData.qr !== qrImg.src) {
                            qrImg.src = checkData.qr;
                        }
                    } catch(e) {}
                }, 4000);
            }
        } else {
            if (badge) {
                badge.className = 'px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-300 text-[10px] font-bold font-mono';
                badge.innerText = data.state === 'connecting' ? 'A inicializar...' : 'Desconectado';
            }
            if (contactsBadge) {
                contactsBadge.className = 'px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-300 text-[10px] font-bold font-mono';
                contactsBadge.innerText = 'Desconectado';
            }
            if (connContainer) connContainer.classList.add('hidden');
            if (qrContainer) qrContainer.classList.remove('hidden');
            if (qrImg) qrImg.classList.add('hidden');
            if (qrSpinner) qrSpinner.classList.remove('hidden');
        }
    } catch (err) {
        if (badge) {
            badge.className = 'px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-300 text-[10px] font-bold font-mono';
            badge.innerText = 'Serviço Indisponível';
        }
    }
}

async function testWhatsAppDirect() {
    return openWhatsAppChatModal();
}

async function logoutWhatsAppWeb() {
    const confirm = await swalEnging.fire({
        title: 'Desconectar WhatsApp Web?',
        text: 'A conta atual será desconectada e um novo QR Code será gerado para emparelhamento.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sim, Desconectar',
        cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed) {
        swalEnging.fire({
            title: 'Desconectando sessão...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const res = await fetch('/api/whatsapp/logout', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                swalEnging.fire({
                    icon: 'info',
                    title: 'Sessão Encerrada',
                    text: 'Um novo QR Code está sendo gerado para conexão.',
                    timer: 2000,
                    showConfirmButton: false
                });
                setTimeout(() => refreshWhatsAppStatus(), 1500);
            } else {
                swalEnging.fire('Erro', data.error || 'Falha ao desconectar', 'error');
            }
        } catch (e) {
            swalEnging.fire('Erro', 'Falha ao solicitar desconexão: ' + e, 'error');
        }
    }
}

// ------------------------------------------------------------- //
// WHATSAPP LIVE INTERACTIVE CHAT & SESSÃO PERSONALIZADA         //
// ------------------------------------------------------------- //

let chatPollingInterval = null;
let currentChatTargetPhone = '';
let currentSessionConfig = {
    name: 'Enging UPS Notifier ⚡',
    avatar: 'enging',
    custom_avatar_url: ''
};

function getSessionAvatarHtml(avatarKey, customUrl, cssClass = 'w-10 h-10 rounded-full') {
    if (customUrl) {
        return `<img src="${customUrl}" class="${cssClass} object-cover border border-white/20 shadow-xs" onerror="this.src='/static/img/logo-horizontal.png'" />`;
    }
    if (avatarKey === 'robot') {
        return `
            <div class="${cssClass} bg-emerald-600 flex items-center justify-center text-white border border-white/20 shadow-xs">
                <i data-lucide="bot" class="w-5 h-5"></i>
            </div>
        `;
    } else if (avatarKey === 'server') {
        return `
            <div class="${cssClass} bg-blue-600 flex items-center justify-center text-white border border-white/20 shadow-xs">
                <i data-lucide="server" class="w-5 h-5"></i>
            </div>
        `;
    } else if (avatarKey === 'battery') {
        return `
            <div class="${cssClass} bg-amber-500 flex items-center justify-center text-white border border-white/20 shadow-xs">
                <i data-lucide="battery-charging" class="w-5 h-5"></i>
            </div>
        `;
    } else if (avatarKey === 'shield') {
        return `
            <div class="${cssClass} bg-purple-600 flex items-center justify-center text-white border border-white/20 shadow-xs">
                <i data-lucide="shield-check" class="w-5 h-5"></i>
            </div>
        `;
    }
    return `
        <div class="${cssClass} bg-[#e95c0c] flex items-center justify-center text-white border border-white/20 shadow-xs">
            <i data-lucide="zap" class="w-5 h-5"></i>
        </div>
    `;
}

async function openWhatsAppChatModal(targetPhone = null) {
    // 1. Verifica se WhatsApp está conectado
    let statusData = window.lastWaStatus;
    if (!statusData || !statusData.connected) {
        try {
            const res = await fetch('/api/whatsapp/status?t=' + Date.now());
            statusData = await res.json();
            window.lastWaStatus = statusData;
        } catch(e) {}
    }

    if (!statusData || !statusData.connected) {
        const askConnect = await swalEnging.fire({
            icon: 'warning',
            title: 'WhatsApp Desconectado',
            text: 'É necessário emparelhar o WhatsApp Web escaneando o QR Code antes de abrir o chat de teste.',
            showCancelButton: true,
            confirmButtonText: 'Abrir Leitor QR Code',
            cancelButtonText: 'Fechar'
        });
        if (askConnect.isConfirmed) {
            openEditGatewayModal('whatsapp');
        }
        return;
    }

    // 2. Carrega configurações da sessão
    try {
        const confRes = await fetch('/api/whatsapp/session-config?t=' + Date.now());
        if (confRes.ok) {
            const confData = await confRes.json();
            if (confData.config) {
                currentSessionConfig = { ...currentSessionConfig, ...confData.config };
            }
        }
    } catch(e) {}

    // 3. Lista de contatos cadastrados no sistema
    const recipients = (allAlertsData && allAlertsData.recipients) ? allAlertsData.recipients : [];
    const connectedPhone = statusData.user?.phone || '';

    // Determina o destinatário inicial
    let matchedRec = recipients.find(r => r.phone_whatsapp === targetPhone || r.phone_sms === targetPhone || r.id === targetPhone);
    let selectedTarget = targetPhone 
        || (matchedRec ? (matchedRec.phone_whatsapp || matchedRec.phone_sms) : '') 
        || currentChatTargetPhone 
        || (recipients[0] ? (recipients[0].phone_whatsapp || recipients[0].phone_sms) : '') 
        || connectedPhone 
        || '+351914710135';

    currentChatTargetPhone = selectedTarget;
    const isMatchedInRecs = recipients.some(r => r.phone_whatsapp === selectedTarget || r.phone_sms === selectedTarget);
    const isConnectedSelf = selectedTarget === connectedPhone;
    const isCustom = !isMatchedInRecs && !isConnectedSelf;

    const sessionName = currentSessionConfig.name || 'Enging UPS Notifier ⚡';
    const avatarHtml = getSessionAvatarHtml(currentSessionConfig.avatar, currentSessionConfig.custom_avatar_url, 'w-10 h-10 rounded-full');

    swalEnging.fire({
        html: `
            <div class="flex flex-col h-[580px] w-full rounded-3xl overflow-hidden bg-slate-100 border border-slate-300 font-sans shadow-2xl select-none text-left">
                
                <!-- 1. Header estilo WhatsApp Web -->
                <div class="bg-[#005c4b] text-white px-4 py-3 flex items-center justify-between shadow-md shrink-0">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        <div class="relative shrink-0">
                            <div id="chat-header-avatar">
                                ${avatarHtml}
                            </div>
                            <span class="w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#005c4b] absolute bottom-0 right-0"></span>
                        </div>
                        <div class="flex-1 min-w-0 pr-2">
                            <div class="flex items-center gap-2">
                                <span id="chat-header-name" class="font-bold text-sm text-white truncate">${sessionName}</span>
                                <span class="px-1.5 py-0.5 rounded bg-white/20 text-[9px] font-mono font-bold tracking-wide uppercase shrink-0">Sessão</span>
                            </div>
                            
                            <!-- Dropdown de Seleção de Contato Cadastrado / Destinatário -->
                            <div class="text-[11px] text-emerald-100/90 font-mono flex items-center gap-1.5 mt-1 flex-wrap">
                                <span class="text-white/80 font-sans text-xs font-bold shrink-0">Destinatário:</span>
                                
                                <select id="chat-recipient-select" onchange="onChatRecipientSelectChange(this)" class="bg-black/30 hover:bg-black/40 focus:bg-white focus:text-slate-900 px-2.5 py-1 rounded-xl text-white font-sans text-xs font-bold transition focus:outline-none border border-white/20 max-w-[210px] truncate cursor-pointer shadow-xs">
                                    <optgroup label="📋 Contatos Cadastrados">
                                        ${recipients.map(r => {
                                            const p = r.phone_whatsapp || r.phone_sms || '';
                                            const isSel = (p && p === selectedTarget) || (r.id === targetPhone);
                                            return `<option value="${p || r.id}" data-type="rec" data-phone="${p}" data-name="${r.name}" ${isSel ? 'selected' : ''}>👤 ${r.name} ${p ? `(${p})` : '(Sem Nº)'}</option>`;
                                        }).join('')}
                                    </optgroup>
                                    <optgroup label="⚙️ Outras Opções">
                                        <option value="${connectedPhone}" data-type="self" data-phone="${connectedPhone}" ${(!isMatchedInRecs && isConnectedSelf) ? 'selected' : ''}>📱 Minha Conta (${connectedPhone || 'Online'})</option>
                                        <option value="custom" data-type="custom" data-phone="${selectedTarget}" ${isCustom ? 'selected' : ''}>✏️ Inserir Número Manual...</option>
                                    </optgroup>
                                </select>

                                <input id="chat-custom-target-input" onchange="changeChatTargetPhone(this.value)" class="${isCustom ? '' : 'hidden'} bg-black/30 focus:bg-white focus:text-slate-900 px-2.5 py-1 rounded-xl text-white font-mono text-xs font-bold transition focus:outline-none w-36 border border-white/20 shadow-xs" placeholder="+351..." value="${selectedTarget}" title="Digite o número de destino com indicativo" />

                                <span class="text-emerald-300 font-sans text-[10px] flex items-center gap-1 shrink-0 ml-1">
                                    <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> online
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="flex items-center gap-1.5 shrink-0">
                        <button onclick="openCustomSessionModal()" title="Personalizar Nome e Foto da Sessão" class="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition flex items-center gap-1 shadow-xs">
                            <i data-lucide="settings" class="w-3.5 h-3.5"></i> <span class="hidden sm:inline">Personalizar</span>
                        </button>
                        <button onclick="logoutWhatsAppWeb(); Swal.close();" title="Desconectar WhatsApp" class="px-2.5 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition flex items-center gap-1 shadow-xs">
                            <i data-lucide="log-out" class="w-3.5 h-3.5"></i> <span class="hidden sm:inline">Desconectar</span>
                        </button>
                        <button onclick="Swal.close()" title="Fechar" class="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition ml-1">
                            <i data-lucide="x" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>

                <!-- 2. Barra de Ações Rápidas / Simulação de Alertas da UPS -->
                <div class="bg-[#f0f2f5] border-b border-slate-200 px-3 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 text-xs shadow-inner">
                    <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
                        <i data-lucide="zap" class="w-3 h-3 text-enging-orange"></i> Simular:
                    </span>
                    <button onclick="sendQuickChatMessage('🚨 *ALERTA ENGING UPS: FALHA DE ENERGIA* 🚨\\n━━━━━━━━━━━━━━━━━━━━━━\\n⚠️ Falta de energia elétrica! UPS está a funcionar em modo Bateria.\\n🔋 Bateria: 92% (Tensão: 220V)\\n🔌 Saída: 230V | Carga: 18% (1.08 kW)\\n🕒 Hora: ' + new Date().toLocaleTimeString('pt-PT') + '\\nPainel: https://10.255.255.28/')" class="px-2.5 py-1 rounded-full bg-white hover:bg-rose-50 hover:text-rose-700 text-slate-700 border border-slate-200 text-[11px] font-bold transition shrink-0 shadow-xs flex items-center gap-1">
                        🚨 Falha AC
                    </button>
                    <button onclick="sendQuickChatMessage('🔋 *ALERTA ENGING UPS: BATERIA CRÍTICA* 🔋\\n━━━━━━━━━━━━━━━━━━━━━━\\n⚠️ Nível de bateria crítico: 15% (Limite: ≤ 20%).\\nTempo estimado de autonomia: ~3 minutos.\\nIniciando sequência de desligamento dos nós Proxmox.\\n🕒 Hora: ' + new Date().toLocaleTimeString('pt-PT'))" class="px-2.5 py-1 rounded-full bg-white hover:bg-amber-50 hover:text-amber-700 text-slate-700 border border-slate-200 text-[11px] font-bold transition shrink-0 shadow-xs flex items-center gap-1">
                        🔋 Bateria 15%
                    </button>
                    <button onclick="sendQuickChatMessage('✅ *ENERGIA ELÉTRICA RESTABELECIDA* ✅\\n━━━━━━━━━━━━━━━━━━━━━━\\nRede AC restaurada (230.1V 50.0Hz).\\nUPS retornou ao modo Online Normal.\\nBateria em recarga: 94%\\n🕒 Hora: ' + new Date().toLocaleTimeString('pt-PT'))" class="px-2.5 py-1 rounded-full bg-white hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 border border-slate-200 text-[11px] font-bold transition shrink-0 shadow-xs flex items-center gap-1">
                        ⚡ Energia OK
                    </button>
                    <button onclick="sendQuickChatMessage('🔔 *TESTE DE COMUNICAÇÃO OPERACIONAL*\\n━━━━━━━━━━━━━━━━━━━━━━\\nServidor: 10.255.255.28 (INVT HT1106XS)\\nCanal: WhatsApp Web (Multi-Device)\\nStatus: Comunicação ativa e bidirecional! ✅')" class="px-2.5 py-1 rounded-full bg-white hover:bg-blue-50 hover:text-blue-700 text-slate-700 border border-slate-200 text-[11px] font-bold transition shrink-0 shadow-xs flex items-center gap-1">
                        🔔 Teste Rápido
                    </button>
                    <button onclick="clearWhatsAppChatHistory()" title="Limpar histórico do chat" class="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-white ml-auto shrink-0 transition">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>

                <!-- 3. Área de Mensagens (Wallpaper WhatsApp) -->
                <div id="chat-messages-container" class="flex-1 overflow-y-auto p-4 space-y-3" style="background-color: #efeae2; background-image: radial-gradient(#d1d7db 1.2px, transparent 1.2px); background-size: 18px 18px;">
                    <div class="text-center py-6">
                        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 shadow-xs text-[11px] font-medium text-slate-500 font-mono">
                            <i data-lucide="lock" class="w-3 h-3 text-emerald-600"></i> As mensagens são transmitidas com encriptação ponto a ponto.
                        </div>
                    </div>
                </div>

                <!-- 4. Barra de Envio de Mensagens -->
                <div class="bg-[#f0f2f5] p-3 flex items-center gap-2 border-t border-slate-200 shrink-0">
                    <input type="text" id="chat-input-text" placeholder="Digite uma mensagem de teste e prima Enter para enviar..." class="flex-1 px-4 py-2.5 rounded-2xl bg-white border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 shadow-inner" onkeydown="if(event.key==='Enter') sendChatMessageFromInput()" />
                    <button onclick="sendChatMessageFromInput()" id="chat-send-btn" title="Enviar Mensagem" class="p-2.5 rounded-2xl bg-[#005c4b] hover:bg-[#004d3f] text-white transition shadow-sm flex items-center justify-center shrink-0">
                        <i data-lucide="send" class="w-4 h-4"></i>
                    </button>
                </div>

            </div>
        `,
        width: '680px',
        padding: '0',
        background: 'transparent',
        showConfirmButton: false,
        showCancelButton: false,
        customClass: {
            popup: 'swal-chat-modal',
            htmlContainer: '!m-0 !p-0 !overflow-hidden'
        },
        didOpen: () => {
            lucide.createIcons();
            const inputEl = document.getElementById('chat-input-text');
            if (inputEl) inputEl.focus();

            window.onChatRecipientSelectChange = function(selectEl) {
                const customInput = document.getElementById('chat-custom-target-input');
                const selectedOpt = selectEl.options[selectEl.selectedIndex];
                const optType = selectedOpt.getAttribute('data-type');
                
                if (optType === 'custom') {
                    if (customInput) {
                        customInput.classList.remove('hidden');
                        customInput.focus();
                        if (customInput.value) {
                            currentChatTargetPhone = customInput.value.trim();
                            fetchAndRenderChatMessages(true);
                        }
                    }
                } else {
                    if (customInput) customInput.classList.add('hidden');
                    const phone = selectedOpt.getAttribute('data-phone') || selectEl.value;
                    if (phone) {
                        currentChatTargetPhone = phone;
                        fetchAndRenderChatMessages(true);
                    }
                }
            };

            // Carrega mensagens imediatamente
            fetchAndRenderChatMessages(true);

            // Inicia polling a cada 1.5s
            if (chatPollingInterval) clearInterval(chatPollingInterval);
            chatPollingInterval = setInterval(() => {
                fetchAndRenderChatMessages(false);
            }, 1500);
        },
        willClose: () => {
            if (chatPollingInterval) {
                clearInterval(chatPollingInterval);
                chatPollingInterval = null;
            }
        }
    });
}

function changeChatTargetPhone(newPhone) {
    if (newPhone && newPhone.trim()) {
        currentChatTargetPhone = newPhone.trim();
        fetchAndRenderChatMessages(true);
    }
}

async function fetchAndRenderChatMessages(forceScroll = false) {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    try {
        const res = await fetch(`/api/whatsapp/messages?phone=${encodeURIComponent(currentChatTargetPhone)}&t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.session_config) {
            currentSessionConfig = { ...currentSessionConfig, ...data.session_config };
            const nameEl = document.getElementById('chat-header-name');
            if (nameEl) nameEl.innerText = currentSessionConfig.name || 'Enging UPS Notifier ⚡';
        }

        renderChatMessagesList(data.messages || [], forceScroll);
    } catch(e) {}
}

function formatChatText(text) {
    if (!text) return '';
    let escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Bold *texto*
    escaped = escaped.replace(/\*(.*?)\*/g, '<strong class="font-bold">$1</strong>');
    // Italic _texto_
    escaped = escaped.replace(/_(.*?)_/g, '<em>$1</em>');
    // Newlines
    escaped = escaped.replace(/\n/g, '<br/>');
    return escaped;
}

function renderChatMessagesList(messages, forceScroll = false) {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    const atBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 60;

    // Se estiver vazio, exibe placeholder informativo
    if (messages.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 space-y-2">
                <div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-xs">
                    <i data-lucide="message-square" class="w-6 h-6"></i>
                </div>
                <div class="font-bold text-slate-700 text-xs">Nenhuma mensagem neste chat ainda</div>
                <p class="text-[11px] text-slate-500 max-w-xs mx-auto">Digite uma mensagem abaixo ou use os botões de simulação de alertas para testar a entrega em tempo real.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    // Ordena do mais antigo para o mais recente para exibição linear no chat
    const sorted = [...messages].reverse();

    container.innerHTML = sorted.map(m => {
        const isMe = m.fromMe;
        const bubbleBg = isMe ? 'bg-[#d9fdd3] ml-auto text-slate-900' : 'bg-white mr-auto text-slate-900';
        const align = isMe ? 'justify-end' : 'justify-start';
        const senderLabel = isMe ? (currentSessionConfig.name || 'Enging UPS') : (m.senderName || m.phone || 'Destinatário');
        const formattedText = formatChatText(m.text);

        return `
            <div class="flex ${align} w-full">
                <div class="max-w-[88%] sm:max-w-[78%] ${bubbleBg} rounded-2xl p-3 shadow-xs border border-slate-200/60 relative space-y-1">
                    <div class="flex items-center justify-between gap-3 text-[10px] ${isMe ? 'text-emerald-800' : 'text-blue-700'} font-bold">
                        <span>${senderLabel}</span>
                    </div>
                    <div class="text-xs leading-relaxed text-slate-800 break-words font-sans">
                        ${formattedText}
                    </div>
                    <div class="flex items-center justify-end gap-1 text-[10px] text-slate-400 font-mono mt-0.5">
                        <span>${m.formatted_time || ''}</span>
                        ${isMe ? '<span class="text-blue-500 font-bold" title="Entregue">✓✓</span>' : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    lucide.createIcons();

    if (forceScroll || atBottom) {
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, 30);
    }
}

async function sendChatMessageFromInput() {
    const inputEl = document.getElementById('chat-input-text');
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    await sendQuickChatMessage(text);
    inputEl.focus();
}

async function sendQuickChatMessage(text) {
    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    try {
        const target = currentChatTargetPhone || window.lastWaStatus?.user?.phone || '+351914710135';
        const res = await fetch('/api/whatsapp/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: target,
                message: text
            })
        });
        const data = await res.json();
        if (data.success) {
            await fetchAndRenderChatMessages(true);
            loadAlertsData();
        } else {
            swalEnging.fire({
                icon: 'error',
                title: 'Erro no Envio',
                text: data.error || 'Falha ao transmitir mensagem via WhatsApp Web.'
            });
        }
    } catch(e) {
        swalEnging.fire('Erro', 'Falha ao comunicar com o microserviço: ' + e, 'error');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

async function clearWhatsAppChatHistory() {
    const confirm = await swalEnging.fire({
        title: 'Limpar Conversa de Teste?',
        text: 'O histórico local de mensagens simuladas será limpo.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sim, Limpar',
        cancelButtonText: 'Cancelar'
    });
    if (confirm.isConfirmed) {
        try {
            await fetch('/api/whatsapp/messages/clear', { method: 'POST' });
            fetchAndRenderChatMessages(true);
        } catch(e) {}
    }
}

// ----------------- MODAL DE PERSONALIZAÇÃO DA SESSÃO ----------------- //

async function openCustomSessionModal() {
    let conf = currentSessionConfig;
    try {
        const res = await fetch('/api/whatsapp/session-config?t=' + Date.now());
        if (res.ok) {
            const data = await res.json();
            if (data.config) conf = data.config;
        }
    } catch(e) {}

    const presets = [
        { id: 'enging', label: '⚡ Enging Laranja (Padrão)' },
        { id: 'robot', label: '🤖 Robô Assistente' },
        { id: 'server', label: '🖥️ Servidor Datacenter' },
        { id: 'battery', label: '🔋 UPS & Bateria' },
        { id: 'shield', label: '🛡️ Proteção Elétrica' }
    ];

    swalEnging.fire({
        title: 'Personalizar Sessão WhatsApp',
        html: `
            <div class="text-left space-y-4 font-sans text-xs">
                <p class="text-slate-500 text-xs">Personalize o <strong>Nome do Remetente</strong> e a <strong>Foto/Avatar</strong> que identificarão esta sessão no chat e nas notificações:</p>
                
                <div>
                    <label class="block font-bold text-slate-700 uppercase mb-1">Nome do Remetente desta Sessão</label>
                    <input id="sess-name-input" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-bold focus:outline-none focus:border-enging-orange" placeholder="Ex: Enging UPS Notifier ⚡" value="${conf.name || 'Enging UPS Notifier ⚡'}">
                    <span class="text-[10px] text-slate-400 mt-1 block">Este nome será exibido no cabeçalho das mensagens transmitidas pelo servidor.</span>
                </div>

                <div>
                    <label class="block font-bold text-slate-700 uppercase mb-1">Avatar / Foto da Sessão</label>
                    <select id="sess-avatar-select" onchange="toggleCustomAvatarField(this.value)" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-enging-orange">
                        ${presets.map(p => `<option value="${p.id}" ${conf.avatar === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
                        <option value="custom" ${conf.avatar === 'custom' || conf.custom_avatar_url ? 'selected' : ''}>🌐 URL de Imagem Personalizada</option>
                    </select>
                </div>

                <div id="sess-custom-avatar-box" class="${(conf.avatar === 'custom' || conf.custom_avatar_url) ? '' : 'hidden'} space-y-1">
                    <label class="block font-bold text-slate-700 uppercase mb-1">URL da Foto / Imagem (HTTPS)</label>
                    <input id="sess-avatar-url" class="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs focus:outline-none focus:border-enging-orange" placeholder="https://dominio.com/avatar.png" value="${conf.custom_avatar_url || ''}">
                </div>

                <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-2">
                    <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600 shrink-0"></i>
                    <span>As alterações aplicam-se imediatamente a esta sessão sem necessidade de reiniciar.</span>
                </div>
            </div>
        `,
        width: '500px',
        showCancelButton: true,
        confirmButtonText: 'Salvar Personalização',
        cancelButtonText: 'Cancelar',
        didOpen: () => {
            lucide.createIcons();
            window.toggleCustomAvatarField = (val) => {
                const box = document.getElementById('sess-custom-avatar-box');
                if (box) {
                    if (val === 'custom') box.classList.remove('hidden');
                    else box.classList.add('hidden');
                }
            };
        },
        preConfirm: () => {
            const name = document.getElementById('sess-name-input').value.trim();
            const avatar = document.getElementById('sess-avatar-select').value;
            const custom_avatar_url = document.getElementById('sess-avatar-url') ? document.getElementById('sess-avatar-url').value.trim() : '';

            if (!name) {
                Swal.showValidationMessage('Informe um nome para a sessão');
                return false;
            }

            return { name, avatar, custom_avatar_url };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch('/api/whatsapp/session-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();
                if (data.success) {
                    currentSessionConfig = { ...currentSessionConfig, ...result.value };
                    
                    const nameHeader = document.getElementById('chat-header-name');
                    if (nameHeader) nameHeader.innerText = result.value.name;
                    const avatarHeader = document.getElementById('chat-header-avatar');
                    if (avatarHeader) {
                        avatarHeader.innerHTML = getSessionAvatarHtml(result.value.avatar, result.value.custom_avatar_url);
                        lucide.createIcons();
                    }

                    swalEnging.fire({
                        icon: 'success',
                        title: 'Sessão Personalizada!',
                        text: `Nome configurado: ${result.value.name}`,
                        timer: 1500,
                        showConfirmButton: false
                    });
                }
            } catch(e) {
                swalEnging.fire('Erro', 'Falha ao salvar configuração: ' + e, 'error');
            }
        }
    });
}



