/**
 * OpenList Mobile App Controller
 * Inspired by Modern Consumer App Design
 * Platform: KernelSU / APatch / Magisk WebUI
 */

const MODDIR = '/data/adb/modules/OpenList';

// Core command runner for KernelSU WebUI
function execCommand(cmd) {
    return new Promise((resolve, reject) => {
        if (typeof ksu === 'undefined' || !ksu.exec) {
            reject(new Error('KernelSU WebUI 未就绪'));
            return;
        }
        const cb = `_cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        window[cb] = (errno, stdout, stderr) => {
            resolve({ errno, stdout: stdout || '', stderr: stderr || '' });
            delete window[cb];
        };
        try {
            ksu.exec(cmd, '{}', cb);
        } catch (e) {
            delete window[cb];
            reject(new Error('命令执行失败: ' + e.message));
        }
    });
}

// -------------------------------------------------------------
// UI Feedback: Toast, Progress Bar & Animations
// -------------------------------------------------------------

function showToast(msg, duration = 2400) {
    const toast = document.getElementById('appToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('active');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.remove('active');
    }, duration);
}

function setGlobalProgress(active) {
    const bar = document.getElementById('topProgressBar');
    if (bar) {
        bar.classList.toggle('active', active);
    }
}

function appendConsole(consoleId, lineText, type = '') {
    const box = document.getElementById(consoleId);
    if (!box) return;
    const time = new Date().toTimeString().split(' ')[0];
    const div = document.createElement('div');
    div.className = `console-row ${type}`;
    div.textContent = `[${time}] ${lineText}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

// -------------------------------------------------------------
// State Monitoring & Hero Card
// -------------------------------------------------------------

let currentEndpoint = 'http://127.0.0.1:5244';

async function fetchNetworkInfo() {
    let ip = '127.0.0.1';
    let port = '5244';

    try {
        const { stdout } = await execCommand(
            `ip -o -4 addr show 2>/dev/null | awk -F"[ /]+" '/inet / && $4 != "127.0.0.1" {print $4; exit}' || ip route get 1 2>/dev/null | awk -F"src " '/src / {print $2; exit}'`
        );
        const resolved = stdout.trim();
        if (resolved) ip = resolved;
    } catch (_) {}

    try {
        const { stdout } = await execCommand(
            `awk -F'[:"[:space:]]+' '/"http_port"/ {print $3}' "${MODDIR}/data/config.json" 2>/dev/null | tr -d ', '`
        );
        const resolvedPort = stdout.trim();
        if (resolvedPort) port = resolvedPort;
    } catch (_) {}

    currentEndpoint = `http://${ip}:${port}`;
    return { ip, port, endpoint: currentEndpoint };
}

async function refreshDashboard() {
    try {
        const [rPgrep, rVersion, net] = await Promise.all([
            execCommand(`pgrep -f ${MODDIR}/bin/openlist`).catch(() => ({ errno: -1 })),
            execCommand(`${MODDIR}/bin/openlist version`).catch(() => ({ stdout: '' })),
            fetchNetworkInfo()
        ]);

        const isRunning = rPgrep.errno === 0;
        const versionMatch = rVersion.stdout.match(/^Version:\s*([^\r\n]+)/m);
        const version = versionMatch ? versionMatch[1].trim() : '未安装';

        // Hero Card Updates
        const badge = document.getElementById('heroBadge');
        const badgeText = document.getElementById('heroBadgeText');
        const verPill = document.getElementById('heroVersionPill');
        const sub = document.getElementById('heroSubtitle');
        const modalCurVer = document.getElementById('modalCurrentVer');

        if (verPill) verPill.textContent = version;
        if (modalCurVer) modalCurVer.textContent = version;
        if (sub) sub.textContent = net.endpoint;

        if (badge && badgeText) {
            if (isRunning) {
                badge.classList.remove('is-stopped');
                badgeText.textContent = '运行正常';
            } else {
                badge.classList.add('is-stopped');
                badgeText.textContent = '服务停止';
            }
        }

        // List item updates
        const pidDesc = document.getElementById('itemPidDesc');
        const statusPill = document.getElementById('itemStatusPill');
        if (pidDesc) pidDesc.textContent = isRunning ? `守护进程活跃 (端口 ${net.port})` : 'openlist 未在后台运行';
        if (statusPill) {
            statusPill.textContent = isRunning ? '运行中' : '已停止';
            statusPill.className = `item-pill ${isRunning ? 'pill-brand' : ''}`;
        }

    } catch (e) {
        console.error('refreshDashboard error:', e);
    }
}

// -------------------------------------------------------------
// Version Management with Single Unified Action Button
// -------------------------------------------------------------

let isCheckingVersions = false;
let isDownloadingUpdate = false;
let availableVersions = [];
let selectedVersion = '';

function setUpdateBtnMode(mode, targetVersion = '') {
    const btn = document.getElementById('modalStartUpdateBtn');
    if (!btn) return;
    const textSpan = btn.querySelector('.btn-text');
    const icon = btn.querySelector('.btn-spin-icon');

    btn.dataset.action = mode;

    if (mode === 'check') {
        if (textSpan) textSpan.textContent = '检测新版本';
        if (icon) {
            icon.classList.remove('is-spinning');
            icon.innerHTML = `
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                <path d="M8 16H3v5"/>
            `;
        }
    } else if (mode === 'install') {
        const v = targetVersion || selectedVersion || (availableVersions.length ? availableVersions[0] : '');
        if (textSpan) textSpan.textContent = v ? `立即升级至 ${v}` : '立即升级安装';
        if (icon) {
            icon.classList.remove('is-spinning');
            icon.innerHTML = `
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            `;
        }
    }
}

function renderVersionPickerOptions() {
    const list = document.getElementById('versionPickerOptionsList');
    if (!list) return;
    list.innerHTML = '';

    if (!availableVersions.length) {
        const item = document.createElement('div');
        item.className = 'version-picker-item is-selected';
        item.innerHTML = `
            <span class="picker-item-label">点击立即检测最新版本</span>
            <div class="picker-radio-outer">
                <div class="picker-radio-inner"></div>
            </div>
        `;
        item.addEventListener('click', () => {
            closeModal('versionPickerModal');
            handleCheckVersionsFlow();
        });
        list.appendChild(item);
        return;
    }

    const recheckItem = document.createElement('div');
    recheckItem.className = 'version-picker-item recheck-item';
    recheckItem.style.borderBottom = '1px solid var(--border-card)';
    recheckItem.style.marginBottom = '6px';
    recheckItem.innerHTML = `
        <span class="picker-item-label text-primary" style="display: flex; align-items: center; gap: 7px;">
            <svg class="icon icon-sm recheck-icon" viewBox="0 0 24 24"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span class="recheck-text">重新联网检测</span>
        </span>
    `;
    recheckItem.addEventListener('click', (e) => {
        e.stopPropagation();
        recheckItem.classList.add('is-checking');
        const icon = recheckItem.querySelector('.recheck-icon');
        const text = recheckItem.querySelector('.recheck-text');
        if (icon) icon.classList.add('is-spinning');
        if (text) text.textContent = '正在重新检测...';
        showToast('正在重新联网检测版本...', 1600);

        setTimeout(() => {
            closeModal('versionPickerModal');
            handleCheckVersionsFlow();
        }, 260);
    });
    list.appendChild(recheckItem);

    availableVersions.forEach((v, index) => {
        const item = document.createElement('div');
        const isCurrent = (v === selectedVersion) || (!selectedVersion && index === 0);
        item.className = `version-picker-item ${isCurrent ? 'is-selected' : ''}`;
        const labelText = index === 0 ? `${v} · 最新稳定版` : v;
        item.innerHTML = `
            <span class="picker-item-label">${labelText}</span>
            <div class="picker-radio-outer">
                <div class="picker-radio-inner"></div>
            </div>
        `;
        item.addEventListener('click', () => {
            selectVersionOption(v, labelText);
        });
        list.appendChild(item);
    });
}

function selectVersionOption(version, labelText) {
    selectedVersion = version;
    const nativeSelect = document.getElementById('modalVersionSelect');
    if (nativeSelect) nativeSelect.value = version;

    const triggerText = document.getElementById('customVersionSelectText');
    if (triggerText) triggerText.textContent = labelText || version;

    const trigger = document.getElementById('customVersionSelectTrigger');
    if (trigger) trigger.classList.add('has-versions');

    setUpdateBtnMode('install', version);

    renderVersionPickerOptions();
    setTimeout(() => {
        closeModal('versionPickerModal');
    }, 120);
}

function openVersionPicker() {
    renderVersionPickerOptions();
    openModal('versionPickerModal');
}

function triggerMainBtnImmediateFeedback() {
    const btn = document.getElementById('modalStartUpdateBtn');
    if (!btn) return;
    const action = btn.dataset.action || 'check';
    const textSpan = btn.querySelector('.btn-text');
    const spinIcon = btn.querySelector('.btn-spin-icon');
    const target = selectedVersion || (availableVersions.length ? availableVersions[0] : '');

    btn.classList.remove('is-success');
    btn.classList.add('is-downloading');
    if (spinIcon) spinIcon.classList.add('is-spinning');

    if (action === 'check' || !availableVersions.length) {
        if (textSpan) textSpan.textContent = '正在检测新版本...';
        showToast('正在检测新版本...', 1500);
    } else {
        if (textSpan) textSpan.textContent = `正在下载并安装 ${target}...`;
        showToast(`正在下载并安装 ${target}...`, 3000);
    }
}

async function handleSingleMainBtnAction() {
    const btn = document.getElementById('modalStartUpdateBtn');
    const currentAction = btn ? btn.dataset.action : 'check';

    if (currentAction === 'check' || !availableVersions.length) {
        await handleCheckVersionsFlow();
    } else {
        await handleStartUpdateFlow();
    }
}

async function handleCheckVersionsFlow() {
    if (isCheckingVersions || isDownloadingUpdate) return;
    isCheckingVersions = true;

    const btn = document.getElementById('modalStartUpdateBtn');
    const textSpan = btn ? btn.querySelector('.btn-text') : null;
    const spinIcon = btn ? btn.querySelector('.btn-spin-icon') : null;

    if (btn) {
        btn.classList.remove('is-success');
        btn.classList.add('is-downloading');
    }
    if (spinIcon) spinIcon.classList.add('is-spinning');
    if (textSpan) textSpan.textContent = '正在检测新版本...';
    showToast('正在检测官方新版本...', 1600);

    const startTime = Date.now();
    try {
        let versions = [];

        try {
            const res = await execCommand(`sh ${MODDIR}/update.sh list-versions`);
            versions = (res.stdout || '').trim().split('\n').map(s => s.trim()).filter(v => v.startsWith('v'));
        } catch (_) {}

        if (!versions.length) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000);
                const resp = await fetch('https://data.jsdelivr.com/v1/package/gh/OpenListTeam/OpenList', { signal: controller.signal });
                clearTimeout(timeoutId);
                if (resp.ok) {
                    const data = await resp.json();
                    if (data && Array.isArray(data.versions)) {
                        versions = data.versions
                            .filter(v => v && !v.includes('beta'))
                            .map(v => v.startsWith('v') ? v : `v${v}`)
                            .slice(0, 8);
                    }
                }
            } catch (_) {}
        }

        const elapsed = Date.now() - startTime;
        if (elapsed < 1000) {
            await new Promise(r => setTimeout(r, 1000 - elapsed));
        }

        if (!versions.length) {
            showToast('获取版本失败，请检查网络连接');
            if (btn) btn.classList.remove('is-downloading');
            setUpdateBtnMode('check');
            return;
        }

        availableVersions = versions;
        selectedVersion = versions[0];
        const displayLabel = `${versions[0]} · 最新稳定版`;

        const triggerText = document.getElementById('customVersionSelectText');
        if (triggerText) triggerText.textContent = displayLabel;
        const trigger = document.getElementById('customVersionSelectTrigger');
        if (trigger) trigger.classList.add('has-versions');

        const nativeSelect = document.getElementById('modalVersionSelect');
        if (nativeSelect) {
            nativeSelect.innerHTML = '';
            versions.forEach((v, index) => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = index === 0 ? `${v} · 最新稳定版` : v;
                nativeSelect.appendChild(opt);
            });
            nativeSelect.value = versions[0];
        }

        if (btn) btn.classList.remove('is-downloading');
        setUpdateBtnMode('install', versions[0]);
        showToast(`已检测到最新版本 ${versions[0]}`);

    } catch (e) {
        if (btn) btn.classList.remove('is-downloading');
        showToast('检测异常: ' + e.message);
        setUpdateBtnMode('check');
    } finally {
        isCheckingVersions = false;
        if (spinIcon) spinIcon.classList.remove('is-spinning');
    }
}

async function handleStartUpdateFlow() {
    if (isDownloadingUpdate || isCheckingVersions) return;
    const target = selectedVersion || (availableVersions.length ? availableVersions[0] : '');
    if (!target) {
        return handleCheckVersionsFlow();
    }

    const btn = document.getElementById('modalStartUpdateBtn');
    const textSpan = btn ? btn.querySelector('.btn-text') : null;
    const spinIcon = btn ? btn.querySelector('.btn-spin-icon') : null;

    isDownloadingUpdate = true;
    if (btn) {
        btn.classList.remove('is-success');
        btn.classList.add('is-downloading');
    }
    if (textSpan) textSpan.textContent = `正在下载并安装 ${target}...`;
    if (spinIcon) spinIcon.classList.add('is-spinning');
    showToast(`正在下载并安装 ${target}...`, 3500);

    const startTime = Date.now();
    try {
        const res = await execCommand(`sh ${MODDIR}/update.sh manual-update "${target}"`);

        const elapsed = Date.now() - startTime;
        if (elapsed < 1600) {
            await new Promise(r => setTimeout(r, 1600 - elapsed));
        }

        if (res.errno === 0) {
            if (btn) {
                btn.classList.remove('is-downloading');
                btn.classList.add('is-success');
            }
            if (textSpan) textSpan.textContent = `✓ 已成功安装 ${target}`;
            showToast(`✓ 已成功安装 ${target}，服务已自动更新`, 3500);
            await refreshDashboard();
            setTimeout(() => {
                if (btn) btn.classList.remove('is-success');
                setUpdateBtnMode('install', target);
            }, 3000);
        } else {
            if (btn) btn.classList.remove('is-downloading');
            showToast('安装失败，请检查网络或运行日志: ' + (res.stderr || res.stdout));
            setUpdateBtnMode('install', target);
        }
    } catch (e) {
        const elapsed = Date.now() - startTime;
        if (elapsed < 1200) {
            await new Promise(r => setTimeout(r, 1200 - elapsed));
        }
        if (btn) btn.classList.remove('is-downloading');
        showToast('执行异常: ' + e.message);
        setUpdateBtnMode('install', target);
    } finally {
        isDownloadingUpdate = false;
        if (spinIcon) spinIcon.classList.remove('is-spinning');
    }
}

// -------------------------------------------------------------
// Security & Admin Password
// -------------------------------------------------------------

async function handleSubmitPassword() {
    const pwd = document.getElementById('newPasswordInput').value;
    const cpwd = document.getElementById('confirmPasswordInput').value;
    const btn = document.getElementById('submitPasswordBtn');
    const textSpan = btn.querySelector('.btn-text');
    const spinIcon = btn.querySelector('.btn-spin-icon');

    if (!pwd || !cpwd) {
        showToast('密码不能为空');
        return;
    }
    if (pwd !== cpwd) {
        showToast('两次输入的密码不一致');
        return;
    }
    if (pwd.length < 6 || pwd.length > 32) {
        showToast('密码长度需在 6-32 位之间');
        return;
    }

    btn.disabled = true;
    if (textSpan) textSpan.textContent = '正在保存修改...';
    if (spinIcon) spinIcon.classList.add('is-spinning');
    setGlobalProgress(true);

    try {
        // Safe UTF-8 Base64
        const bytes = new TextEncoder().encode(pwd);
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        const b64 = btoa(binary);

        const res = await execCommand(`sh ${MODDIR}/update.sh set-password-base64 "${b64}"`);
        if (res.errno === 0) {
            document.getElementById('newPasswordInput').value = '';
            document.getElementById('confirmPasswordInput').value = '';
            showToast('管理员密码已成功设置！');
            closeModal('passwordModal');
        } else {
            showToast('密码修改失败: ' + (res.stderr || res.stdout));
        }
    } catch (e) {
        showToast('设置异常: ' + e.message);
    } finally {
        btn.disabled = false;
        if (textSpan) textSpan.textContent = '保存并生效';
        if (spinIcon) spinIcon.classList.remove('is-spinning');
        setGlobalProgress(false);
    }
}

// -------------------------------------------------------------
// Backup & Restore
// -------------------------------------------------------------

let pendingRestorePath = null;
let pendingDeletePath = null;

async function refreshBackupList() {
    const listContainer = document.getElementById('backupFilesList');
    const quickDesc = document.getElementById('quickBackupDesc');
    if (!listContainer) return;

    try {
        const cmd = `for f in /sdcard/OpenList/backups/*.tar.gz; do [ -f "$f" ] || continue; sz=$(ls -lh "$f" 2>/dev/null | awk '{print $5}'); mt=$(date -r "$f" "+%Y-%m-%d %H:%M" 2>/dev/null); echo "$sz|$mt|$f"; done`;
        const { stdout } = await execCommand(cmd);
        const lines = stdout.trim().split('\n').filter(Boolean);

        if (!lines.length) {
            listContainer.innerHTML = '<div class="empty-state">暂无已生成的备份文件</div>';
            if (quickDesc) quickDesc.textContent = '暂无本地备份快照';
            return;
        }

        listContainer.innerHTML = '';
        lines.reverse().forEach((line, idx) => {
            const parts = line.split('|');
            let size = parts[0] || '未知';
            let mtime = parts[1] || '';
            let filePath = parts.slice(2).join('|');

            if (!filePath) return;
            const fileName = filePath.split('/').pop() || 'backup.tar.gz';

            if (!mtime) {
                const match = fileName.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
                if (match) {
                    mtime = `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
                }
            }
            const dateTimeDisplay = mtime || '刚刚';

            if (idx === 0 && quickDesc) {
                quickDesc.textContent = `最新快照 (${size} · ${dateTimeDisplay})`;
            }

            const card = document.createElement('div');
            card.className = 'list-item-card backup-item-card';
            card.innerHTML = `
                <div class="item-avatar avatar-amber">
                    <svg class="icon" viewBox="0 0 24 24">
                        <ellipse cx="12" cy="5" rx="9" ry="3"/>
                        <path d="M3 5v14a9 3 0 0 0 18 0V5"/>
                        <path d="M3 12a9 9 0 0 0 18 0"/>
                    </svg>
                </div>
                <div class="item-content">
                    <h4 class="item-title backup-item-name font-mono truncate" title="${fileName}">${fileName}</h4>
                    <div class="item-meta">
                        <span class="item-desc font-mono">${dateTimeDisplay}</span>
                        <span class="item-pill">${size}</span>
                    </div>
                </div>
                <div class="item-actions backup-item-actions">
                    <button type="button" class="backup-action-btn btn-restore restore-file-btn" data-filepath="${filePath}" title="从该快照还原数据">
                        <svg class="btn-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                            <polyline points="3 3 3 8 8 8"/>
                        </svg>
                        <span>还原</span>
                    </button>
                    <button type="button" class="backup-action-btn btn-delete delete-file-btn" data-filepath="${filePath}" title="删除此备份">
                        <svg class="btn-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                        <span>删除</span>
                    </button>
                </div>
            `;
            listContainer.appendChild(card);
        });

        listContainer.querySelectorAll('.restore-file-btn').forEach(b => {
            b.addEventListener('click', () => {
                const fp = b.dataset.filepath;
                if (!fp) return;
                promptRestoreConfirm(fp);
            });
        });

        listContainer.querySelectorAll('.delete-file-btn').forEach(b => {
            b.addEventListener('click', () => {
                const fp = b.dataset.filepath;
                if (!fp) return;
                promptDeleteConfirm(fp);
            });
        });

    } catch (e) {
        listContainer.innerHTML = '<div class="empty-state">读取备份列表失败</div>';
    }
}

function promptDeleteConfirm(filePath) {
    if (!filePath) return;
    pendingDeletePath = filePath;
    const fileName = filePath.split('/').pop() || filePath;
    const label = document.getElementById('deleteTargetFilename');
    if (label) label.textContent = fileName;
    openModal('deleteBackupModal');
}

async function executeDeleteBackup() {
    if (!pendingDeletePath) return;
    const target = pendingDeletePath;
    closeModal('deleteBackupModal');
    pendingDeletePath = null;

    setGlobalProgress(true);
    appendConsole('backupConsole', `▶ 正在删除快照: ${target}`, 'info');

    try {
        const res = await execCommand(`rm -f "${target}" 2>&1`);
        if (res.errno === 0) {
            appendConsole('backupConsole', `✓ 备份文件已永久删除`, 'success');
            showToast('已删除备份文件');
            await refreshBackupList();
        } else {
            appendConsole('backupConsole', `✗ 删除失败: ${res.stderr || res.stdout}`, 'error');
            showToast('删除失败');
        }
    } catch (e) {
        appendConsole('backupConsole', `✗ 异常: ${e.message}`, 'error');
        showToast('删除错误: ' + e.message);
    } finally {
        setGlobalProgress(false);
    }
}

function promptRestoreConfirm(filePath) {
    if (!filePath) return;
    pendingRestorePath = filePath;
    const fileName = filePath.split('/').pop() || filePath;
    const label = document.getElementById('restoreTargetFilename');
    if (label) label.textContent = fileName;
    openModal('restoreModal');
}

async function executeRestore() {
    if (!pendingRestorePath) return;
    const target = pendingRestorePath;
    closeModal('restoreModal');
    pendingRestorePath = null;

    setGlobalProgress(true);
    showToast('正在停止服务并解压快照...');
    appendConsole('backupConsole', `▶ 正在从快照还原: ${target}`, 'info');

    try {
        await execCommand(`pkill -9 -f ${MODDIR}/bin/openlist`);
        const res = await execCommand(`tar -xzf "${target}" -C "${MODDIR}" 2>&1`);

        if (res.errno === 0) {
            appendConsole('backupConsole', '✓ 数据还原成功，守护进程将拉起新实例。', 'success');
            showToast('快照还原完成！');
            setTimeout(refreshDashboard, 1500);
        } else {
            appendConsole('backupConsole', `✗ 解压失败: ${res.stderr || res.stdout}`, 'error');
            showToast('还原失败，详情见日志');
        }
    } catch (e) {
        appendConsole('backupConsole', `✗ 异常: ${e.message}`, 'error');
        showToast('还原发生错误: ' + e.message);
    } finally {
        setGlobalProgress(false);
    }
}

async function handleCreateBackup() {
    setGlobalProgress(true);
    showToast('正在打包生成完整数据备份...');
    appendConsole('backupConsole', '▶ 正在打包 /data 目录...', 'info');

    try {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const targetPath = `/sdcard/OpenList/backups/OpenList-backup-${stamp}.tar.gz`;

        await execCommand(`mkdir -p /sdcard/OpenList/backups`);
        const res = await execCommand(`tar --exclude='data/temp' --exclude='data/log' -czf "${targetPath}" -C "${MODDIR}" data 2>&1`);

        if (res.errno === 0) {
            appendConsole('backupConsole', `✓ 备份成功: ${targetPath}`, 'success');
            showToast('备份已保存至存储卡');
            await refreshBackupList();
        } else {
            appendConsole('backupConsole', `✗ 打包失败: ${res.stderr || res.stdout}`, 'error');
            showToast('备份失败');
        }
    } catch (e) {
        appendConsole('backupConsole', `✗ 异常: ${e.message}`, 'error');
        showToast('备份发生错误: ' + e.message);
    } finally {
        setGlobalProgress(false);
    }
}

// -------------------------------------------------------------
// Logs View
// -------------------------------------------------------------

let currentLogType = 'module';

async function loadLogStream() {
    const stream = document.getElementById('terminalStream');
    const pathDisplay = document.getElementById('activeLogPathDisplay');
    const badge = document.getElementById('logLineCountBadge');
    const refreshBtn = document.getElementById('refreshLogsBtn');
    const refreshSpin = refreshBtn ? refreshBtn.querySelector('.btn-spin-icon') : null;
    if (!stream) return;

    if (refreshSpin) refreshSpin.classList.add('is-spinning');

    const targetFile = currentLogType === 'module' 
        ? `${MODDIR}/log.log` 
        : `${MODDIR}/data/log/log.log`;

    if (pathDisplay) pathDisplay.textContent = targetFile.split('/').slice(-2).join('/');

    try {
        const { stdout } = await execCommand(`tail -n 200 "${targetFile}" 2>/dev/null || cat "${targetFile}" 2>/dev/null`);
        stream.innerHTML = '';
        const lines = (stdout || '').split('\n').filter(Boolean);

        if (!lines.length) {
            stream.innerHTML = '<div class="console-row text-muted">暂无日志内容</div>';
            if (badge) badge.textContent = '0 行';
            return;
        }

        lines.forEach(line => {
            const div = document.createElement('div');
            const lower = line.toLowerCase();
            let levelClass = '';
            if (lower.includes('error') || lower.includes('fail') || lower.includes('fatal') || lower.includes('exception')) {
                levelClass = 'log-error';
            } else if (lower.includes('warn')) {
                levelClass = 'log-warn';
            } else if (lower.includes('info') || lower.includes('msg=') || lower.includes('listening')) {
                levelClass = 'log-info';
            } else if (lower.includes('success') || lower.includes('ready') || lower.includes('start')) {
                levelClass = 'log-success';
            }
            div.className = `log-row ${levelClass}`;
            div.textContent = line;
            stream.appendChild(div);
        });
        stream.scrollTop = stream.scrollHeight;
        if (badge) badge.textContent = `${lines.length} 行`;

    } catch (e) {
        stream.innerHTML = `<div class="console-row error">加载日志出错: ${e.message}</div>`;
    } finally {
        if (refreshSpin) {
            setTimeout(() => refreshSpin.classList.remove('is-spinning'), 400);
        }
    }
}

function handleCopyLogs() {
    const stream = document.getElementById('terminalStream');
    if (!stream) return;
    const text = stream.innerText || '';
    if (!text.trim() || text.includes('加载日志内容中...') || text.includes('暂无日志内容')) {
        showToast('当前暂无日志可复制');
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('✓ 已复制当前全部日志');
        }).catch(() => {
            showToast('复制日志失败，请手动选择');
        });
    } else {
        showToast('已选中日志内容');
    }
}

async function handleClearCurrentLog() {
    const targetFile = currentLogType === 'module' 
        ? `${MODDIR}/log.log` 
        : `${MODDIR}/data/log/log.log`;

    try {
        await execCommand(`: > "${targetFile}" 2>&1`);
        showToast('日志已清空');
        await loadLogStream();
    } catch (e) {
        showToast('清空失败: ' + e.message);
    }
}

// -------------------------------------------------------------
// Modals & Navigation
// -------------------------------------------------------------

function openModal(id) {
    const m = document.getElementById(id);
    if (m) {
        const card = m.querySelector('.modal-card, .version-picker-dialog');
        if (card) {
            card.style.transform = '';
            card.style.transition = '';
        }
        m.classList.add('active');
    }
}

function closeModal(id) {
    const m = document.getElementById(id);
    if (m) {
        m.classList.remove('active');
        const card = m.querySelector('.modal-card, .version-picker-dialog');
        if (card) {
            setTimeout(() => {
                card.style.transform = '';
                card.style.transition = '';
            }, 300);
        }
    }
}

// -------------------------------------------------------------
// -------------------------------------------------------------

function initDrawerSwipeToDismiss() {
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });

        const card = modal.querySelector('.modal-card');
        if (!card) return;
        const handle = modal.querySelector('.drawer-handle');
        const header = modal.querySelector('.modal-header');

        if (handle) {
            handle.addEventListener('click', () => {
                closeModal(modal.id);
            });
        }

        const touchAreas = [handle, header].filter(Boolean);
        let startY = 0;
        let currentY = 0;
        let isDragging = false;

        function handleDragStart(clientY) {
            startY = clientY;
            currentY = clientY;
            isDragging = true;
            card.style.transition = 'none';
        }

        function handleDragMove(clientY, e) {
            if (!isDragging) return;
            currentY = clientY;
            const deltaY = currentY - startY;
            if (deltaY > 0) {
                if (e && e.cancelable) e.preventDefault();
                card.style.transform = `translateY(${deltaY}px)`;
            }
        }

        function handleDragEnd() {
            if (!isDragging) return;
            isDragging = false;
            const deltaY = currentY - startY;
            card.style.transition = 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)';

            if (deltaY > 55) {
                card.style.transform = 'translateY(100%)';
                setTimeout(() => {
                    closeModal(modal.id);
                    card.style.transform = '';
                    card.style.transition = '';
                }, 220);
            } else {
                card.style.transform = 'translateY(0)';
                setTimeout(() => {
                    card.style.transform = '';
                    card.style.transition = '';
                }, 250);
            }
        }

        touchAreas.forEach(area => {
            area.addEventListener('touchstart', (e) => {
                if (!e.touches || !e.touches[0]) return;
                handleDragStart(e.touches[0].clientY);
            }, { passive: true });

            area.addEventListener('touchmove', (e) => {
                if (!e.touches || !e.touches[0]) return;
                handleDragMove(e.touches[0].clientY, e);
            }, { passive: false });

            area.addEventListener('touchend', () => handleDragEnd());
            area.addEventListener('touchcancel', () => handleDragEnd());

            area.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                handleDragStart(e.clientY);

                function onPointerMove(pe) {
                    handleDragMove(pe.clientY, pe);
                }
                function onPointerUp() {
                    handleDragEnd();
                    window.removeEventListener('pointermove', onPointerMove);
                    window.removeEventListener('pointerup', onPointerUp);
                    window.removeEventListener('pointercancel', onPointerUp);
                }
                window.addEventListener('pointermove', onPointerMove, { passive: false });
                window.addEventListener('pointerup', onPointerUp);
                window.addEventListener('pointercancel', onPointerUp);
            });
        });
    });
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const targetView = document.getElementById(viewId);
    if (targetView) targetView.classList.add('active');

    const targetNav = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (targetNav) targetNav.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (viewId === 'viewBackup') refreshBackupList();
    if (viewId === 'viewLogs') loadLogStream();
    if (viewId === 'viewHome') refreshDashboard();
}

function applyThemeAccent(accent) {
    if (accent === 'blue') {
        document.documentElement.removeAttribute('data-accent');
    } else {
        document.documentElement.setAttribute('data-accent', accent);
    }

    const palette = document.getElementById('themeColorPalette');
    if (palette) {
        palette.querySelectorAll('.color-dot-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.accent === accent);
        });
    }
}

function updateThemeMode(next, showFeedback = true) {
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('openlist-theme', next);
    execCommand(`echo "theme=${next}" > ${MODDIR}/data/theme.conf`).catch(() => {});

    const mySwitch = document.getElementById('myPageDarkSwitch');
    const desc = document.getElementById('currentThemeDesc');
    if (mySwitch) mySwitch.checked = (next === 'dark');
    if (desc) desc.textContent = (next === 'dark' ? '已开启高对比沉浸黑' : '已开启清爽明亮白');

    if (showFeedback) {
        showToast(`已切换至${next === 'dark' ? '深色' : '浅色'}外观`);
    }
}

function initTheme() {
    const isDark = localStorage.getItem('openlist-theme') === 'dark';
    if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    const mySwitch = document.getElementById('myPageDarkSwitch');
    const desc = document.getElementById('currentThemeDesc');
    if (mySwitch) mySwitch.checked = isDark;
    if (desc) desc.textContent = isDark ? '已开启高对比沉浸黑' : '已开启清爽明亮白';

    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'dark' ? 'light' : 'dark';
            updateThemeMode(next, true);
        });
    }

    if (mySwitch) {
        mySwitch.addEventListener('change', () => {
            updateThemeMode(mySwitch.checked ? 'dark' : 'light', true);
        });
    }
    const row = document.getElementById('toggleDarkModeRow');
    if (row && mySwitch) {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.ui-switch')) return;
            mySwitch.checked = !mySwitch.checked;
            updateThemeMode(mySwitch.checked ? 'dark' : 'light', true);
        });
    }

    const savedAccent = localStorage.getItem('openlist-theme-accent') || 'blue';
    applyThemeAccent(savedAccent);

    const palette = document.getElementById('themeColorPalette');
    if (palette) {
        palette.querySelectorAll('.color-dot-btn').forEach(dotBtn => {
            dotBtn.addEventListener('click', () => {
                const accent = dotBtn.dataset.accent;
                applyThemeAccent(accent);
                localStorage.setItem('openlist-theme-accent', accent);
                const title = dotBtn.getAttribute('title') || '主题色';
                showToast(`已应用「${title.split(' ')[0]}」主题色`);
            });
        });
    }
}

function setupCopyAction() {
    const btn = document.getElementById('copyEndpointHeroBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(currentEndpoint).then(() => {
                    showToast(`已复制: ${currentEndpoint}`);
                }).catch(() => {
                    showToast(`访问地址: ${currentEndpoint}`);
                });
            } else {
                showToast(`访问地址: ${currentEndpoint}`);
            }
        });
    }
}

// -------------------------------------------------------------
// Boot Initialization
// -------------------------------------------------------------

function init() {
    initTheme();
    setupCopyAction();

    // Bottom Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });

    // Modal Triggers
    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };

    bind('openUpdateModalBtn', () => openModal('updateModal'));
    bind('closeUpdateModalBtn', () => closeModal('updateModal'));
    bind('openPasswordModalBtn', () => openModal('passwordModal'));
    bind('closePasswordModalBtn', () => closeModal('passwordModal'));

    bind('closeRestoreModalBtn', () => closeModal('restoreModal'));
    bind('cancelRestoreBtn', () => closeModal('restoreModal'));
    bind('confirmRestoreBtn', executeRestore);

    // Delete Backup modal actions
    bind('closeDeleteBackupModalBtn', () => closeModal('deleteBackupModal'));
    bind('cancelDeleteBackupBtn', () => closeModal('deleteBackupModal'));
    bind('confirmDeleteBackupBtn', executeDeleteBackup);

    // Quick Action shortcuts from Home cards
    bind('cardQuickBackup', () => switchView('viewBackup'));
    bind('quickBackupBtn', (e) => { e.stopPropagation(); handleCreateBackup(); });
    bind('cardQuickLog', () => switchView('viewLogs'));
    bind('quickViewLogBtn', (e) => { e.stopPropagation(); switchView('viewLogs'); });

    // Restart process
    bind('restartServiceBtn', async () => {
        showToast('正在重启 OpenList 服务...');
        await execCommand(`pkill -9 -f ${MODDIR}/bin/openlist`);
        setTimeout(() => {
            refreshDashboard();
            showToast('已下发重启信号');
        }, 1200);
    });

    const updateBtnEl = document.getElementById("modalStartUpdateBtn");
    if (updateBtnEl) {
        updateBtnEl.addEventListener("pointerdown", () => {
            if (!isCheckingVersions && !isDownloadingUpdate) {
                updateBtnEl.style.transform = "scale(0.95)";
                triggerMainBtnImmediateFeedback();
            }
        });
        updateBtnEl.addEventListener("pointerup", () => {
            updateBtnEl.style.transform = "";
        });
        updateBtnEl.addEventListener("click", handleSingleMainBtnAction);
    }
    // Custom Themed Version Picker Trigger & Modal
    bind('customVersionSelectTrigger', openVersionPicker);
    bind('closeVersionPickerBtn', () => closeModal('versionPickerModal'));
    const pickerModalBackdrop = document.getElementById('versionPickerModal');
    if (pickerModalBackdrop) {
        pickerModalBackdrop.addEventListener('click', (e) => {
            if (e.target === pickerModalBackdrop) closeModal('versionPickerModal');
        });
    }

    // Password modal
    bind('submitPasswordBtn', handleSubmitPassword);

    // Backup actions
    bind('tabCreateBackupBtn', handleCreateBackup);
    bind('refreshBackupListBtn', refreshBackupList);

    // Log actions
    bind('refreshLogsBtn', () => {
        loadLogStream();
        showToast('日志已刷新');
    });
    bind('copyLogsBtn', handleCopyLogs);
    bind('clearCurrentLogBtn', handleClearCurrentLog);

    document.querySelectorAll('.log-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.log-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentLogType = btn.dataset.logfile;
            loadLogStream();
        });
    });

    // Copy module path
    const copyPathRow = document.getElementById('copyModPathRow');
    if (copyPathRow) {
        copyPathRow.addEventListener('click', () => {
            const p = `${MODDIR}`;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(p).then(() => {
                    showToast(`已复制路径: ${p}`);
                }).catch(() => {
                    showToast(`模块路径: ${p}`);
                });
            } else {
                showToast(`模块路径: ${p}`);
            }
        });
    }

    // Check system architecture
    execCommand(`uname -m`).then(({ stdout }) => {
        const arch = stdout.trim();
        if (arch) {
            const el1 = document.getElementById('aboutArch');
            const el2 = document.getElementById('aboutArchDetail');
            if (el1) el1.textContent = arch;
            if (el2) el2.textContent = arch;
        }
    }).catch(() => {});

    // Initial Dashboard Refresh
    refreshDashboard();
    refreshBackupList();

    initDrawerSwipeToDismiss();
}

document.addEventListener('DOMContentLoaded', init);
