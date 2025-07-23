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

async function getStatus(isInitial = false) {
  const openlistSpan = document.getElementById('openlistStatus');
  const updateSpan = document.getElementById('updateStatus');
  const versionSpan = document.getElementById('versionStatus');
  const ipSpan = document.getElementById('ipStatus');

  if (isInitial) {
    showSpinner(true);
  }

  try {
    const cmds = [
      'pgrep -f /data/adb/modules/OpenList/bin/openlist',
      'pgrep -f /data/adb/modules/OpenList/update.sh',
      '/data/adb/modules/OpenList/bin/openlist version',
      'ip -o -4 addr show wlan0 || ip -o -4 addr show eth0 || ip route get 1'
    ];
    const res = await Promise.all(
      cmds.map(c => execCommand(c).catch(() => ({ errno: -1, stdout: '', stderr: '' })))
    );

    const runningOpen = res[0].errno === 0;
    const runningUpdate = res[1].errno === 0;
    const version = res[2].stdout.match(/^Version: (.*)$/m)?.[1] || '未安装';

    let ip = '未获取到';
    const ipRes = res[3];
    const m = ipRes.stdout.match(/inet (\S+)/) || ipRes.stdout.match(/src (\S+)/);
    if (m) ip = m[1].split('/')[0];

    openlistSpan.textContent = runningOpen ? '运行中 ✓' : '已停止 ✗';
    openlistSpan.className = runningOpen ? 'text-success' : 'text-error';

    updateSpan.textContent = runningUpdate ? '运行中 ✓' : '已停止 ✗';
    updateSpan.className = runningUpdate ? 'text-success' : 'text-error';

    versionSpan.textContent = version;
    versionSpan.className = 'text-info';

    ipSpan.textContent = ip;
    ipSpan.className = 'text-info';
  } catch (e) {
    document.getElementById('status').innerHTML = `<p class="text-error">获取状态失败: ${e.message}</p>`;
  } finally {
    if (isInitial) showSpinner(false);
  }
}

async function startUpdate() {
  const updateBtn = document.getElementById('updateBtn');
  const updateLog = document.getElementById('updateLog');

  updateBtn.disabled = true;
  updateLog.innerHTML = '<p>⏳ 正在检测更新，请稍后...</p>';
  
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 0));

  showSpinner(true);
  showToast('开始更新...');

  try {
    const res = await execCommand('sh /data/adb/modules/OpenList/update.sh manual-update');
    const lines = res.stdout.split('\n').filter(l => l.trim());

    updateLog.innerHTML = '';
    if (!lines.length) {
      updateLog.innerHTML = '<p>⚠️ 无更新日志</p>';
    } else {
      lines.forEach(l => {
        const p = document.createElement('p');
        p.textContent = l;
        updateLog.appendChild(p);
      });
      updateLog.scrollTop = updateLog.scrollHeight;
    }

    showToast(res.errno === 0 ? '更新完成' : '更新失败');
  } catch (e) {
    updateLog.innerHTML = `<p>❌ 更新失败: ${e.message}</p>`;
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

  btn.disabled = true;
  showSpinner(true);

  try {
    const b64 = btoa(pwd);
    const res = await execCommand(
      `sh /data/adb/modules/OpenList/update.sh set-password-base64 "${b64}"`
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

function initialize() {
  if (typeof ksu === 'undefined' || !ksu.exec) {
    document.getElementById('status').innerHTML = '<p class="text-error">KsuWebUI 未加载，请检查 KernelSU 环境</p>';
    document.getElementById('updateBtn').disabled = true;
    document.getElementById('setPasswordBtn').disabled = true;
    return;
  }

  document.getElementById('updateBtn').addEventListener('click', startUpdate);
  document.getElementById('setPasswordBtn').addEventListener('click', setPassword);

  if (document.visibilityState === 'visible') getStatus(true);
  
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') getStatus(true);
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') getStatus();
  }, 5000);
}

document.addEventListener('DOMContentLoaded', initialize);