function execCommand(cmd) {
    return new Promise((resolve, reject) => {
        if (typeof ksu === 'undefined' || !ksu.exec) {
            reject(new Error('KsuWebUI 未加载'));
            return;
        }
        const cb = `cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        window[cb] = (errno, stdout, stderr) => {
            resolve({ errno, stdout, stderr });
            delete window[cb];
        };
        try {
            ksu.exec(cmd, '{}', cb);
        } catch (e) {
            reject(new Error('无法执行命令: ' + e.message));
        }
    });
}

function showSpinner(show) {
    document.getElementById('spinner').classList.toggle('hidden', !show);
}

function showToast(msg) {
    if (typeof ksu !== 'undefined' && ksu.toast) {
        ksu.toast(msg);
    } else {
        alert(msg);
    }
}

async function getIpPort() {
    let ip = null;
    try {
        const { stdout } = await execCommand(
            'ip -o -4 addr show 2>/dev/null | awk -F"[ /]+" \'/inet / && $4 != "127.0.0.1" {print $4; exit}\'',
        );
        ip = stdout.trim();
    } catch (_) {}
    if (!ip) {
        try {
            const { stdout } = await execCommand(
                'ip route get 1 2>/dev/null | awk -F"src " \'/src / {print $2; exit}\'',
            );
            ip = stdout.trim();
        } catch (_) {}
    }
    if (!ip) ip = '127.0.0.1';

    let port = null;
    const cfgPath = '/data/adb/modules/OpenList/data/config.json';
    try {
        const { stdout } = await execCommand(
            `awk -F'[:"[:space:]]+' '/"http_port"/ {print $3}' "${cfgPath}" 2>/dev/null | tr -d ', '`,
        );
        port = stdout.trim() || null;
    } catch (_) {}
    if (!port) port = '5244';

    return `${ip}:${port}`;
}

async function getStatus(isInitial = false) {
    const openlistSpan = document.getElementById('openlistStatus');
    const versionSpan = document.getElementById('versionStatus');
    const ipStatusSpan = document.getElementById('ipStatus');

    if (isInitial) showSpinner(true);
    try {
        const [r1, r2] = await Promise.all([
            execCommand('pgrep -f /data/adb/modules/OpenList/bin/openlist').catch(() => ({ errno: -1 })),
            execCommand('/data/adb/modules/OpenList/bin/openlist version').catch(() => ({ stdout: '' })),
        ]);

        const runningOpen = r1.errno === 0;
        const version = (r2.stdout.match(/^Version: (.*)$/m) || [])[1] || '未安装';
        const ipPort = await getIpPort();

        openlistSpan.textContent = runningOpen ? '运行中 ✓' : '已停止 ✗';
        openlistSpan.className = runningOpen ? 'text-success' : 'text-error';

        versionSpan.textContent = version;
        versionSpan.className = 'text-info';

        ipStatusSpan.textContent = ipPort;
        ipStatusSpan.className = 'text-info';
    } catch (e) {
        document.getElementById('status').innerHTML = `<p class="text-error">获取状态失败: ${e.message}</p>`;
    } finally {
        if (isInitial) showSpinner(false);
    }
}

async function checkVersions() {
    const updateLog = document.getElementById('updateLog');
    const versionSelect = document.getElementById('versionSelect');
    showSpinner(true);
    updateLog.innerHTML = '<p>⏳ 正在检查版本...</p>';

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
        updateLog.innerHTML = `<p>✅ 最新稳定版: ${latestVersion}</p>`;
        showToast('版本检查完成');
    } catch (e) {
        updateLog.innerHTML = `<p>❌ ${e.message}</p>`;
        showToast(e.message);
    } finally {
        showSpinner(false);
    }
}

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
    updateLog.innerHTML = `<p>⏳ 正在更新到 ${selectedVersion}，请稍后...</p>`;
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
            updateLog.innerHTML = '<p>⚠️ 无更新日志</p>';
        } else {
            lines.forEach(l => {
                const p = document.createElement('p');
                p.textContent = l;
                if (l.includes('失败')) {
                    p.className = 'text-error';
                } else if (l.includes('成功')) {
                    p.className = 'text-success';
                } else {
                    p.className = 'text-info';
                }
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
        p.className = 'text-error';
        updateLog.appendChild(p);
        updateLog.scrollTop = updateLog.scrollHeight;
        showToast('更新失败: ' + e.message);
    } finally {
        updateBtn.disabled = false;
        showSpinner(false);
        await getStatus(true);
    }
}

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

async function backupData() {
    const log = document.getElementById('backupLog');
    const btn = document.getElementById('backupBtn');
    btn.disabled = true;
    showSpinner(true);
    log.innerHTML = '<p>🔄 正在创建数据备份...</p>';
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
                <p>✅ 备份完成！</p>
                <p>📁 文件路径：<strong>${backupPath}</strong></p>
            `;
            showToast('备份成功');
            await refreshBackupList();
        } else {
            throw new Error(res.stderr || res.stdout);
        }
    } catch (e) {
        log.innerHTML = `<p>❌ 备份失败：${e.message}</p>`;
        showToast('备份失败：' + e.message);
    } finally {
        btn.disabled = false;
        showSpinner(false);
    }
}

async function refreshBackupList() {
    const sel = document.getElementById('backupSelect');
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
    log.innerHTML = '<p>🔄 正在验证文件...</p>';

    try {
        log.innerHTML += '<p>📦 正在停止服务...</p>';
        await execCommand('pkill -9 -f /data/adb/modules/OpenList/bin/openlist');

        log.innerHTML += '<p>🔄 正在恢复数据...</p>';
        const res = await execCommand(`tar -xzf "${backupPath}" -C /data/adb/modules/OpenList 2>&1`);
        if (res.errno !== 0) throw new Error(res.stderr || res.stdout);

        log.innerHTML += '<p>✅ 数据恢复完成...</p>';
        await new Promise(r => setTimeout(r, 2000));
        await getStatus(true);
        showToast('恢复成功');
    } catch (e) {
        log.innerHTML = `<p>❌ 恢复失败：${e.message}</p>`;
        showToast('恢复失败：' + e.message);
    } finally {
        btn.disabled = false;
        showSpinner(false);
    }
}

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

async function toggleTheme() {
    try {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'light' ? 'dark' : 'light';

        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('openlist-theme', next);
        await execCommand(`echo "theme=${next}" > /data/adb/modules/OpenList/data/theme.conf`);
        showToast(`已切换到${next === 'dark' ? '深色' : '浅色'}主题`);
    } catch (e) {
        showToast('主题切换失败');
    }
}

function initialize() {
    initTheme();
    document.getElementById('updateBtn').addEventListener('click', startUpdate);
    document.getElementById('checkVersionBtn').addEventListener('click', checkVersions);
    document.getElementById('setPasswordBtn').addEventListener('click', setPassword);
    document.getElementById('backupBtn').addEventListener('click', backupData);
    document.getElementById('restoreBtn').addEventListener('click', restoreData);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    if (typeof ksu === 'undefined' || !ksu.exec) {
        document.getElementById('status').innerHTML =
            '<p class="text-error">KsuWebUI 未加载，请检查 KernelSU 环境</p>';
        document.getElementById('updateBtn').disabled = true;
        document.getElementById('checkVersionBtn').disabled = true;
        document.getElementById('setPasswordBtn').disabled = true;
        document.getElementById('backupBtn').disabled = true;
        document.getElementById('restoreBtn').disabled = true;
        return;
    }

    refreshBackupList();

    if (document.visibilityState === 'visible') getStatus(true);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') getStatus(true);
    });

    setInterval(() => {
        if (document.visibilityState === 'visible') getStatus();
    }, 5000);
}

document.addEventListener('DOMContentLoaded', initialize);
