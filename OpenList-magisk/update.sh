#!/system/bin/sh

MODDIR="$(dirname "$(readlink -f "$0")")"

find_busybox() {
  for path in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox; do
    [ -f "$path" ] && {
      BUSYBOX="$path"
      return 0
    }
  done
  BUSYBOX="busybox"
  return 1
}

ARCH=$(uname -m)
case "$ARCH" in
  aarch64 | arm64) ARCH="arm64" ;;
  arm*) ARCH="arm" ;;
  *) ARCH="arm64" ;;
esac

LATEST_URL="https://api.github.com/repos/OpenListTeam/OpenList/releases/latest"
RELEASES_URL="https://api.github.com/repos/OpenListTeam/OpenList/releases"

get_latest_version() {
  version=$(
    "${BUSYBOX}" wget -q --no-check-certificate --timeout=10 -O - "${LATEST_URL}" 2>/dev/null |
    grep -o '"tag_name": "[^"]*"' |
    sed 's/"tag_name": "//;s/"//g'
  )
  if [ -z "$version" ]; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 无法获取最新版本" >>"${MODDIR}/log.log"
    echo "无法获取最新版本"
    return 1
  fi
  echo "$version"
}

get_version() {
  if [ -x "${MODDIR}/bin/openlist" ]; then
    "${MODDIR}/bin/openlist" version 2>/dev/null | awk '/^Version:/ {print $2}' | tr -d '\r'
  else
    echo "未安装"
  fi
}

prepare_temp_dir() {
  TEMP_DIR="${MODDIR}/data/temp"
  rm -rf "${TEMP_DIR}" 2>/dev/null
  if ! mkdir -p "${TEMP_DIR}"; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 创建临时目录失败" >>"${MODDIR}/log.log"
    echo "创建临时目录失败"
    return 1
  fi
  echo "$TEMP_DIR"
}

download_and_extract() {
  local target_version="$1"
  OpenList_file="openlist-android-${ARCH}.tar.gz"
  TEMP_DIR=$(prepare_temp_dir) || return 1

  if ! "${BUSYBOX}" wget -q --timeout=5 --spider https://github.com 2>/dev/null; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 无法访问 GitHub，请检查网络或代理" >>"${MODDIR}/log.log"
    rm -rf "${TEMP_DIR}" 2>/dev/null
    return 1
  fi

  echo "[$(date "+%Y-%m-%d %H:%M:%S")] 开始下载: ${target_version}" >>"${MODDIR}/log.log"
  echo "开始下载: ${target_version}"

  if [ "$target_version" = "$(get_latest_version)" ]; then
    download_url="https://github.com/OpenListTeam/OpenList/releases/latest/download/${OpenList_file}"
  else
    download_url="https://github.com/OpenListTeam/OpenList/releases/download/${target_version}/${OpenList_file}"
  fi

  if ! "${BUSYBOX}" wget -q --no-check-certificate --timeout=10 -O "${TEMP_DIR}/${OpenList_file}" "${download_url}" 2>"${TEMP_DIR}/wget_err.log"; then
    err_msg=$(cat "${TEMP_DIR}/wget_err.log" 2>/dev/null || echo "未知错误")
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 下载失败: ${err_msg}" >>"${MODDIR}/log.log"
    echo "下载失败: ${err_msg}"
    rm -rf "${TEMP_DIR}" 2>/dev/null
    return 1
  fi

  if [ ! -s "${TEMP_DIR}/${OpenList_file}" ]; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 下载文件为空" >>"${MODDIR}/log.log"
    echo "下载文件为空"
    return 1
  fi

  EXTRACT_DIR="${TEMP_DIR}/extracted"
  if ! mkdir -p "${EXTRACT_DIR}"; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 创建解压目录失败" >>"${MODDIR}/log.log"
    echo "创建解压目录失败"
    return 1
  fi

  if ! "${BUSYBOX}" tar -xzf "${TEMP_DIR}/${OpenList_file}" -C "${EXTRACT_DIR}" 2>"${TEMP_DIR}/tar_err.log"; then
    err_msg=$(cat "${TEMP_DIR}/tar_err.log" 2>/dev/null || echo "未知错误")
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 解压失败: ${err_msg}" >>"${MODDIR}/log.log"
    echo "解压失败: ${err_msg}"
    return 1
  fi

  EXECUTABLE_FILE=$(find "${EXTRACT_DIR}" -type f -name "openlist" | head -n 1)
  if [ -z "$EXECUTABLE_FILE" ]; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 未找到可执行文件" >>"${MODDIR}/log.log"
    echo "未找到可执行文件"
    return 1
  fi

  if ! chmod 755 "${EXECUTABLE_FILE}"; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 设置可执行权限失败" >>"${MODDIR}/log.log"
    echo "设置可执行权限失败"
    return 1
  fi

  temp_version=$("${EXECUTABLE_FILE}" version 2>/dev/null | awk '/^Version:/ {print $2}' | tr -d '\r')
  if [ -z "$temp_version" ]; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 无法获取下载文件的版本号" >>"${MODDIR}/log.log"
    echo "无法获取下载文件的版本号"
    return 1
  fi

  if [ "$temp_version" != "$target_version" ]; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 版本验证失败: 预期 ${target_version}, 实际 ${temp_version}" >>"${MODDIR}/log.log"
    echo "版本验证失败: 预期 ${target_version}, 实际 ${temp_version}"
    return 1
  fi

  if ! mkdir -p "${MODDIR}/bin"; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 创建 bin 目录失败" >>"${MODDIR}/log.log"
    echo "创建 bin 目录失败"
    return 1
  fi

  if ! mv -f "${EXECUTABLE_FILE}" "${MODDIR}/bin/openlist"; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 移动可执行文件失败" >>"${MODDIR}/log.log"
    echo "移动可执行文件失败"
    return 1
  fi

  if ! chmod 755 "${MODDIR}/bin/openlist"; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 设置 bin/openlist 权限失败" >>"${MODDIR}/log.log"
    echo "设置 bin/openlist 权限失败"
    return 1
  fi

  rm -rf "${TEMP_DIR}" 2>/dev/null

  version=$(get_version)
  if [ "$version" != "$target_version" ]; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 安装后版本验证失败: 预期 ${target_version}, 实际 ${version}" >>"${MODDIR}/log.log"
    echo "安装后版本验证失败: 预期 ${target_version}, 实际 ${version}"
    return 1
  fi

  return 0
}

update_and_restart() {
  local target_version="$1"
  if ! sed -i "s/^version=.*/version=${target_version}/g" "${MODDIR}/module.prop"; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 更新 module.prop 失败" >>"${MODDIR}/log.log"
    echo "更新 module.prop 失败"
    return 1
  fi

  pkill -f 'openlist server' >/dev/null 2>&1

  local timeout=5
  local elapsed=0
  while pgrep -f 'openlist server' >/dev/null; do
    if [ $elapsed -ge $timeout ]; then
      pkill -9 -f 'openlist server' >/dev/null 2>&1
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 0
}

check_update() {
  local target_version="$1"

  echo "[$(date "+%Y-%m-%d %H:%M:%S")] === 开始检查更新 ===" >>"${MODDIR}/log.log"
  echo "=== 开始检查更新 ==="

  if ! "${BUSYBOX}" wget -q --timeout=5 --spider https://github.com 2>/dev/null; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 无法访问 GitHub，请检查网络或代理" >>"${MODDIR}/log.log"
    return 1
  fi

  current_version=$(get_version)
  echo "[$(date "+%Y-%m-%d %H:%M:%S")] 目标版本: ${target_version}" >>"${MODDIR}/log.log"
  echo "目标版本: ${target_version}"
  echo "[$(date "+%Y-%m-%d %H:%M:%S")] 当前版本: ${current_version}" >>"${MODDIR}/log.log"
  echo "当前版本: ${current_version}"

  if [ "$current_version" != "未安装" ] && [ "$current_version" = "$target_version" ]; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 已是目标版本" >>"${MODDIR}/log.log"
    echo "已是目标版本"
    return 0
  fi

  local action="安装"
  [ "$current_version" != "未安装" ] && action="更新"
  echo "[$(date "+%Y-%m-%d %H:%M:%S")] 开始${action} ${target_version}" >>"${MODDIR}/log.log"
  echo "开始${action} ${target_version}"

  for attempt in 1 2 3; do
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 更新尝试 ${attempt}/3" >>"${MODDIR}/log.log"
    echo "更新尝试 ${attempt}/3"
    if download_and_extract "$target_version"; then
      if update_and_restart "$target_version"; then
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] ${action}成功" >>"${MODDIR}/log.log"
        echo "${action}成功"
        return 0
      else
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 服务重启失败" >>"${MODDIR}/log.log"
        echo "服务重启失败"
        return 1
      fi
    fi
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 更新尝试 ${attempt}/3 失败，等待重试" >>"${MODDIR}/log.log"
    echo "更新尝试 ${attempt}/3 失败，等待重试"
    rm -rf "${TEMP_DIR}" 2>/dev/null
    sleep 10
  done

  echo "[$(date "+%Y-%m-%d %H:%M:%S")] ${action}失败" >>"${MODDIR}/log.log"
  echo "${action}失败"
  return 1
}

find_busybox
mkdir -p "${MODDIR}/bin" "${MODDIR}/data/temp"

if [ "$1" = "manual-update" ]; then
  check_update "$2"
  exit $?
fi

if [ "$1" = "set-password-base64" ] && [ -n "$2" ]; then
  password=$(echo "$2" | base64 -d 2>/dev/null)
  if [ -n "$password" ] && [ -x "${MODDIR}/bin/openlist" ]; then
    "${MODDIR}/bin/openlist" admin set "$password" --data "${MODDIR}/data" >/dev/null 2>&1
    exit $?
  fi
  echo "[$(date "+%Y-%m-%d %H:%M:%S")] 设置密码失败" >>"${MODDIR}/log.log"
  echo "设置密码失败"
  exit 1
fi
exit 1