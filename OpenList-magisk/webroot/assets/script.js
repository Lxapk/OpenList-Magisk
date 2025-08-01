// 执行命令的核心函数
function execCommand(cmd) {
    return new Promise((resolve, reject) => {
        if (typeof ksu === 'undefined' || !ksu.exec) {
            reject(new Error('KsuWebUI 未加载'));
            return;
        }
        const cb = `cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        window[cb] = (errno, stdout, stderr) => {
            console.log(`Command executed: ${cmd}`, { errno, stdout, stderr });
            resolve({ errno, stdout, stderr });
            delete window[cb];
        };
        try {
            ksu.exec(cmd, '{}', cb);
        } catch (e) {
            console.error(`Failed to execute command: ${cmd}`, e);
            reject(new Error('无法执行命令: ' + e.message));
        }
    });
}

// 显示/隐藏加载动画
function showSpinner(show) {
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.classList.toggle('hidden', !show);
}

// 显示提示信息
function showToast(msg) {
    console.log('Showing toast:', msg);
    if (typeof ksu !== 'undefined' && ksu.toast) {
        ksu.toast(msg);
    } else {
        alert(msg);
    }
}

// 获取IP和端口
async function getIpPort() {
    let ip = null;
    try {
        const { stdout } = await execCommand(
            'ip -o -4 addr show 2>/dev/null | awk -F"[ /]+" \'/inet / && $4 != "127.0.0.1" {print $4; exit}\'',
        );
        ip = stdout.trim();
    } catch (e) {
        console.error('Failed to get IP via addr show:', e);
    }
    if (!ip) {
        try {
            const { stdout } = await execCommand(
                'ip route get 1 2>/dev/null | awk -F"src " \'/src / {print $2; exit}\'',
            );
            ip = stdout.trim();
        } catch (e) {
            console.error('Failed to get IP via route:', e);
        }
    }
    if (!ip) ip = '127.0.0.1';

    let port = null;
    const cfgPath = '/data/adb/modules/OpenList/data/config.json';
    try {
        const { stdout } = await execCommand(
            `awk -F'[:"[:space:]]+' '/"http_port"/ {print $3}' "${cfgPath}" 2>/dev/null | tr -d ', '`,
        );
        port = stdout.trim() || null;
    } catch (e) {
        console.error('Failed to get port:', e);
    }
    if (!port) port = '5244';

    return `${ip}:${port}`;
}

// 获取服务状态
async function getStatus(isInitial = false) {
    const openlistSpan = document.getElementById('openlistStatus');
    const versionSpan = document.getElementById('versionStatus');
    const ipStatusSpan = document.getElementById('ipStatus');

    if (!openlistSpan || !versionSpan || !ipStatusSpan) {
        console.error('Status elements not found');
        return;
    }

    if (isInitial) showSpinner(true);
    try {
        console.log('Starting getStatus...');
        const [r1, r2] = await Promise.all([
            execCommand('pgrep -f /data/adb/modules/OpenList/bin/openlist').catch((e) => {
                console.error('Error in pgrep command:', e);
                return { errno: -1 };
            }),
            execCommand('/data/adb/modules/OpenList/bin/openlist version').catch((e) => {
                console.error('Error in version command:', e);
                return { stdout: '' };
            }),
        ]);

        const runningOpen = r1.errno === 0;
        const version = (r2.stdout.match(/^Version: (.*)$/m) || [])[1] || '未安装';
        const ipPort = await getIpPort().catch((e) => {
            console.error('Error in getIpPort:', e);
            return '未知';
        });

        openlistSpan.style.transition = 'all 0.3s ease';
        versionSpan.style.transition = 'all 0.3s ease';
        ipStatusSpan.style.transition = 'all 0.3s ease';

        openlistSpan.textContent = runningOpen ? '运行中 ✓' : '已停止 ✗';
        openlistSpan.className = `status-value ${runningOpen ? 'running' : 'stopped'}`;
        openlistSpan.innerHTML = `${runningOpen ? '运行中' : '已停止'} <span class="indicator"></span>`;

        versionSpan.textContent = version;
        versionSpan.className = 'status-value text-info';

        ipStatusSpan.textContent = ipPort;
        ipStatusSpan.className = 'status-value text-info';
    } catch (e) {
        console.error('getStatus failed:', e);
        document.getElementById('status').innerHTML = `<p class="text-error">获取状态失败: ${e.message}</p>`;
    } finally {
        if (isInitial) showSpinner(false);
    }
}

// 检查版本更新
async function checkVersions() {
    const updateLog = document.getElementById('updateLog');
    const versionSelect = document.getElementById('versionSelect');
    showSpinner(true);
    updateLog.innerHTML = '<p class="log-item">⏳ 正在检查版本...</p>';

    try {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            await fetch('https://api.github.com', {
                method: 'HEAD',
                signal: controller.signal,
                cache: 'no-store'
            });
            clearTimeout(timeoutId);
        } catch (e) {
            throw new Error('无法访问 GitHub，请检查网络或代理');
        }

        const latestController = new AbortController();
        const latestTimeout = setTimeout(() => latestController.abort(), 10000);
        const latestResponse = await fetch('https://api.github.com/repos/OpenListTeam/OpenList/releases/latest', {
            headers: { Accept: 'application/vnd.github.v3+json' },
            signal: latestController.signal,
        });
        clearTimeout(latestTimeout);

        if (!latestResponse.ok) {
            throw new Error('GitHub API 请求失败');
        }

        const latestData = await latestResponse.json();
        const latestVersion = latestData.tag_name;

        const allController = new AbortController();
        const allTimeout = setTimeout(() => allController.abort(), 10000);
        const allResponse = await fetch('https://api.github.com/repos/OpenListTeam/OpenList/releases', {
            headers: { Accept: 'application/vnd.github.v3+json' },
            signal: allController.signal,
        });
        clearTimeout(allTimeout);

        if (!allResponse.ok) {
            throw new Error('GitHub API 请求失败');
        }

        const allData = await allResponse.json();
        const versions = allData.map(release => release.tag_name);

        versionSelect.innerHTML = '';
        const latestOption = document.createElement('option');
        latestOption.value = latestVersion;
        latestOption.textContent = `${latestVersion} (最新稳定版)`;
        versionSelect.appendChild(latestOption);

        versions
            .filter(v => v !== latestVersion)
            .sort((a, b) => b.localeCompare(a))
            .slice(0, 7)
            .forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                versionSelect.appendChild(opt);
            });

        versionSelect.value = latestVersion;
        updateLog.innerHTML = `<p class="log-item">✅ 最新稳定版: ${latestVersion}</p>`;
        showToast('版本检查完成');
    } catch (e) {
        updateLog.innerHTML = `<p class="log-item">❌ ${e.message}</p>`;
        showToast(e.message);
    } finally {
        showSpinner(false);
    }
}

// 开始更新
async function startUpdate() {
    const updateBtn = document.getElementById('updateBtn');
    const updateLog = document.getElementById('updateLog');
    const versionSelect = document.getElementById('versionSelect');
    const selectedVersion = versionSelect.value;

    if (!selectedVersion) {
        showToast('请先检查版本以选择更新版本');
        return;
    }

    updateBtn.disabled = true;
    updateLog.innerHTML = `<p class="log-item">⏳ 正在更新到 ${selectedVersion}，请稍后...</p>`;
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 0));

    showSpinner(true);
    showToast(`开始更新到 ${selectedVersion}...`);
    try {
        const res = await execCommand(
            `sh /data/adb/modules/OpenList/update.sh manual-update "${selectedVersion}"`,
        );
        updateLog.innerHTML = '';
        const lines = (res.stdout + '\n' + res.stderr).split('\n').filter(l => l.trim());

        if (!lines.length) {
            updateLog.innerHTML = '<p class="log-item">⚠️ 无更新日志</p>';
        } else {
            lines.forEach(l => {
                const p = document.createElement('p');
                p.textContent = l;
                p.className = 'log-item';
                updateLog.appendChild(p);
            });
            updateLog.scrollTop = updateLog.scrollHeight;
        }

        if (res.errno !== 0) {
            throw new Error('请检查网络或代理');
        }
        showToast('更新完成');
    } catch (e) {
        const p = document.createElement('p');
        p.textContent = `❌ 更新失败: ${e.message}`;
        p.className = 'log-item';
        updateLog.appendChild(p);
        updateLog.scrollTop = updateLog.scrollHeight;
        showToast('更新失败: ' + e.message);
    } finally {
        updateBtn.disabled = false;
        showSpinner(false);
        await getStatus(true);
    }
}

// 设置密码
async function setPassword() {
    const pwd = document.getElementById('password').value;
    const cpwd = document.getElementById('confirmPassword').value;
    const btn = document.getElementById('setPasswordBtn');

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
    showSpinner(true);
    try {
        const b64 = btoa(pwd);
        const res = await execCommand(
            `sh /data/adb/modules/OpenList/update.sh set-password-base64 "${b64}"`,
        );
        if (res.errno === 0) {
            showToast('密码设置成功');
            document.getElementById('password').value = '';
            document.getElementById('confirmPassword').value = '';
        } else {
            showToast('密码设置失败: ' + (res.stderr || res.stdout));
        }
    } catch (e) {
        showToast('密码设置失败: ' + e.message);
    } finally {
        btn.disabled = false;
        showSpinner(false);
    }
}

// 备份数据
async function backupData() {
    const log = document.getElementById('backupLog');
    const btn = document.getElementById('backupBtn');
    btn.disabled = true;
    showSpinner(true);
    log.innerHTML = '<p class="log-item">🔄 正在创建数据备份...</p>';
    try {
        const timestamp = new Date()
            .toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            })
            .replace(/\D/g, '')
            .replace(/(\d{4})(\d{2})(\d{2})(\d{6})/, '$1$2$3-$4');
        const backupName = `OpenList-backup-${timestamp}.tar.gz`;
        const backupPath = `/sdcard/OpenList/backups/${backupName}`;

        await execCommand('mkdir -p /sdcard/OpenList/backups');
        const res = await execCommand(
            `tar --exclude='data/temp' --exclude='data/log' -czf "${backupPath}" -C /data/adb/modules/OpenList data 2>&1`,
        );

        if (res.errno === 0) {
            log.innerHTML = `
                <p class="log-item">✅ 备份完成！</p>
                <p class="log-item">📁 文件路径：<strong>${backupPath}</strong></p>
            `;
            showToast('备份成功');
            await refreshBackupList();
        } else {
            throw new Error(res.stderr || res.stdout);
        }
    } catch (e) {
        log.innerHTML = `<p class="log-item">❌ 备份失败：${e.message}</p>`;
        showToast('备份失败：' + e.message);
    } finally {
        btn.disabled = false;
        showSpinner(false);
    }
}

// 刷新备份列表
async function refreshBackupList() {
    const sel = document.getElementById('backupSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">加载中…</option>';
    try {
        const { stdout } = await execCommand(
            'ls -1 /sdcard/OpenList/backups/*.tar.gz 2>/dev/null || true',
        );
        const files = stdout.trim().split('\n').filter(f => f);
        sel.innerHTML = '';
        if (!files.length) {
            sel.innerHTML = '<option value="">暂无备份文件</option>';
            return;
        }
        files.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f.split('/').pop();
            sel.appendChild(opt);
        });
    } catch (e) {
        sel.innerHTML = '<option value="">读取失败</option>';
    }
}

// 恢复数据
async function restoreData() {
    const backupPath = document.getElementById('backupSelect').value;
    if (!backupPath) {
        showToast('请先在下方选择要恢复的备份文件');
        return;
    }

    const log = document.getElementById('backupLog');
    const btn = document.getElementById('restoreBtn');
    btn.disabled = true;
    showSpinner(true);
    log.innerHTML = '<p class="log-item">🔄 正在验证文件...</p>';

    try {
        log.innerHTML += '<p class="log-item">📦 正在停止服务...</p>';
        await execCommand('pkill -9 -f /data/adb/modules/OpenList/bin/openlist');

        log.innerHTML += '<p class="log-item">🔄 正在恢复数据...</p>';
        const res = await execCommand(`tar -xzf "${backupPath}" -C /data/adb/modules/OpenList 2>&1`);
        if (res.errno !== 0) throw new Error(res.stderr || res.stdout);

        log.innerHTML += '<p class="log-item">✅ 数据恢复完成...</p>';
        await new Promise(r => setTimeout(r, 2000));
        await getStatus(true);
        showToast('恢复成功');
    } catch (e) {
        log.innerHTML = `<p class="log-item">❌ 恢复失败：${e.message}</p>`;
        showToast('恢复失败：' + e.message);
    } finally {
        btn.disabled = false;
        showSpinner(false);
    }
}

// 刷新日志列表
async function refreshLogList() {
    const sel = document.getElementById('logSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">请选择日志文件</option>';
    const logFiles = [
        '/data/adb/modules/OpenList/log.log',
        '/data/adb/modules/OpenList/data/log/log.log'
    ];
    try {
        for (const file of logFiles) {
            const { stdout } = await execCommand(`[ -f "${file}" ] && echo "exists" || echo "not exists"`);
            if (stdout.trim() === 'exists') {
                const opt = document.createElement('option');
                opt.value = file;
                opt.textContent = file.split('/').slice(-2).join('/');
                sel.appendChild(opt);
            }
        }
    } catch (e) {
        console.error('Failed to refresh log list:', e);
        sel.innerHTML = '<option value="">读取失败</option>';
    }
}

// 加载日志内容
async function loadLogContent() {
    const logPath = document.getElementById('logSelect').value;
    const logContent = document.getElementById('logContent');
    if (!logPath) {
        logContent.innerHTML = '<p class="log-item">📜 请选择日志文件查看内容，或点击“清空日志”清空选中的日志文件。</p>';
        return;
    }

    showSpinner(true);
    logContent.innerHTML = '<p class="log-item">⏳ 正在加载日志...</p>';
    try {
        const { stdout } = await execCommand(`cat "${logPath}" || echo "无法读取日志文件"`);
        logContent.innerHTML = '';
        if (!stdout.trim()) {
            logContent.innerHTML = '<p class="log-item">📜 日志文件为空</p>';
        } else {
            stdout.split('\n').forEach(line => {
                const p = document.createElement('p');
                p.textContent = line;
                p.className = 'log-item';
                logContent.appendChild(p);
            });
            logContent.scrollTop = logContent.scrollHeight;
        }
    } catch (e) {
        logContent.innerHTML = `<p class="log-item">❌ 读取日志失败：${e.message}</p>`;
        showToast('读取日志失败：' + e.message);
    } finally {
        showSpinner(false);
    }
}

// 清空日志
async function clearLog() {
    const logPath = document.getElementById('logSelect').value;
    const logContent = document.getElementById('logContent');
    const btn = document.getElementById('clearLogBtn');

    if (!logPath) {
        showToast('请先选择要清空的日志文件');
        return;
    }

    btn.disabled = true;
    showSpinner(true);
    logContent.innerHTML = '<p class="log-item">⏳ 正在清空日志...</p>';
    try {
        const res = await execCommand(`: > "${logPath}" 2>&1`);
        if (res.errno === 0) {
            logContent.innerHTML = '<p class="log-item">✅ 日志已清空</p>';
            showToast('日志清空成功');
        } else {
            throw new Error(res.stderr || res.stdout);
        }
    } catch (e) {
        logContent.innerHTML = `<p class="log-item">❌ 清空日志失败：${e.message}</p>`;
        showToast('清空日志失败：' + e.message);
    } finally {
        btn.disabled = false;
        showSpinner(false);
        await loadLogContent();
    }
}

// 初始化主题
async function initTheme() {
    try {
        const { stdout } = await execCommand(
            'grep "^theme=" /data/adb/modules/OpenList/data/theme.conf 2>/dev/null || echo "theme=light"',
        );
        const theme = stdout.trim().split('=')[1] || 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('openlist-theme', theme);
    } catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('openlist-theme', 'light');
    }
}

// 切换主题
async function toggleTheme() {
    try {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('openlist-theme', next);
        await execCommand(`echo "theme=${next}" > /data/adb/modules/OpenList/data/theme.conf`);
        showToast(`已切换到${next === 'dark' ? '深色' : '浅色'}主题`);
        
        // 强制重绘以确保主题立即生效
        requestAnimationFrame(() => {
            document.body.offsetHeight; // 触发重排
            document.querySelectorAll('.status-card, .feature-card, .header-bg, .theme-toggle').forEach(el => {
                el.style.transition = 'all 0.3s ease';
                el.style.background = getComputedStyle(document.documentElement).getPropertyValue('--card-bg');
                el.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border');
                el.style.boxShadow = `0 4px 16px ${getComputedStyle(document.documentElement).getPropertyValue('--shadow')}`;
            });
        });
    } catch (e) {
        showToast('主题切换失败');
    }
}

// 页面导航
function navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector(`.page[data-page="${page}"]`).classList.add('active');
    if (page === 'backup') refreshBackupList();
    if (page === 'log') refreshLogList();
}

// 初始化应用
function initialize() {
    console.log('Initializing theme and event listeners...');
    initTheme();
    const updateBtn = document.getElementById('updateBtn');
    const checkVersionBtn = document.getElementById('checkVersionBtn');
    const setPasswordBtn = document.getElementById('setPasswordBtn');
    const backupBtn = document.getElementById('backupBtn');
    const restoreBtn = document.getElementById('restoreBtn');
    const clearLogBtn = document.getElementById('clearLogBtn');
    const logSelect = document.getElementById('logSelect');
    const themeToggle = document.getElementById('themeToggle');
    const navLinks = document.querySelectorAll('[data-nav]');

    if (updateBtn) updateBtn.addEventListener('click', startUpdate);
    if (checkVersionBtn) checkVersionBtn.addEventListener('click', checkVersions);
    if (setPasswordBtn) setPasswordBtn.addEventListener('click', setPassword);
    if (backupBtn) backupBtn.addEventListener('click', backupData);
    if (restoreBtn) restoreBtn.addEventListener('click', restoreData);
    if (clearLogBtn) clearLogBtn.addEventListener('click', clearLog);
    if (logSelect) logSelect.addEventListener('change', loadLogContent);
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigate(link.dataset.nav);
        });
    });

    if (typeof ksu === 'undefined' || !ksu.exec) {
        console.error('KsuWebUI not loaded');
        const status = document.getElementById('status');
        if (status) {
            status.innerHTML = '<p class="text-error">KsuWebUI 未加载，请检查 KernelSU 环境</p>';
        }
        if (updateBtn) updateBtn.disabled = true;
        if (checkVersionBtn) checkVersionBtn.disabled = true;
        if (setPasswordBtn) setPasswordBtn.disabled = true;
        if (backupBtn) backupBtn.disabled = true;
        if (restoreBtn) restoreBtn.disabled = true;
        if (clearLogBtn) clearLogBtn.disabled = true;
        return;
    }

    console.log('Refreshing backup and log lists...');
    refreshBackupList();
    refreshLogList();

    if (document.visibilityState === 'visible') {
        console.log('Calling getStatus on init...');
        getStatus(true);
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('Visibility changed, calling getStatus...');
            getStatus(true);
        }
    });

    setInterval(() => {
        if (document.visibilityState === 'visible') {
            console.log('Periodic getStatus check...');
            getStatus();
        }
    }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded triggered, initializing...');
    initialize();
});