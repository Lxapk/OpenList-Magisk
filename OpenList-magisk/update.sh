#!/system/bin/sh

MODDIR="$(dirname "$(readlink -f "$0")")"

find_busybox() {
  for path in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox; do
    [ -f "$path" ] && [ -x "$path" ] && {
      BUSYBOX="$path"
      return 0
    }
  done
  if command -v busybox >/dev/null 2>&1; then
    BUSYBOX="busybox"
    return 0
  fi
  BUSYBOX=""
  return 1
}

ARCH=$(uname -m)
case "$ARCH" in
  aarch64 | arm64) ARCH="arm64" ;;
  arm*) ARCH="arm" ;;
  *) ARCH="arm64" ;;
esac

fetch_content() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -skL --connect-timeout 8 -m 15 "$url" 2>/dev/null && return 0
  elif [ -x "/system/bin/curl" ]; then
    /system/bin/curl -skL --connect-timeout 8 -m 15 "$url" 2>/dev/null && return 0
  fi

  for bb in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox busybox; do
    if [ -x "$bb" ] || command -v "$bb" >/dev/null 2>&1; then
      "$bb" wget -q --no-check-certificate --timeout=15 -O - "$url" 2>/dev/null && return 0
    fi
  done

  if command -v wget >/dev/null 2>&1; then
    wget -q --no-check-certificate --timeout=15 -O - "$url" 2>/dev/null && return 0
  fi
  return 1
}

download_file() {
  local url="$1"
  local output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -skL --connect-timeout 10 -m 180 -o "$output" "$url" 2>/dev/null && [ -s "$output" ] && return 0
  elif [ -x "/system/bin/curl" ]; then
    /system/bin/curl -skL --connect-timeout 10 -m 180 -o "$output" "$url" 2>/dev/null && [ -s "$output" ] && return 0
  fi

  for bb in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox busybox; do
    if [ -x "$bb" ] || command -v "$bb" >/dev/null 2>&1; then
      "$bb" wget -q --no-check-certificate --timeout=30 -O "$output" "$url" 2>/dev/null && [ -s "$output" ] && return 0
    fi
  done

  if command -v wget >/dev/null 2>&1; then
    wget -q --no-check-certificate --timeout=30 -O "$output" "$url" 2>/dev/null && [ -s "$output" ] && return 0
  fi
  return 1
}

extract_tar_gz() {
  local tar_file="$1"
  local dest_dir="$2"

  if command -v tar >/dev/null 2>&1; then
    tar -xzf "$tar_file" -C "$dest_dir" 2>/dev/null && return 0
  fi
  for bb in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox busybox; do
    if [ -x "$bb" ] || command -v "$bb" >/dev/null 2>&1; then
      "$bb" tar -xzf "$tar_file" -C "$dest_dir" 2>/dev/null && return 0
    fi
  done
  return 1
}

parse_versions_from_atom() {
  grep -o '<title>v[0-9][^<]*</title>' | sed 's/<title>//;s/<\/title>//' | grep -v 'beta'
}

get_versions() {
  local content=""
  local list=""

  content=$(fetch_content "https://github.com/OpenListTeam/OpenList/releases.atom")
  list=$(printf '%s\n' "$content" | parse_versions_from_atom)

  if [ -z "$list" ]; then
    content=$(fetch_content "https://ghproxy.net/https://github.com/OpenListTeam/OpenList/releases.atom")
    list=$(printf '%s\n' "$content" | parse_versions_from_atom)
  fi

  if [ -z "$list" ]; then
    content=$(fetch_content "https://data.jsdelivr.com/v1/package/gh/OpenListTeam/OpenList")
    list=$(printf '%s\n' "$content" | grep -o '"[0-9][0-9.]*"' | tr -d '"' | sed 's/^/v/' | grep -v 'beta')
  fi

  if [ -z "$list" ]; then
    content=$(fetch_content "https://api.github.com/repos/OpenListTeam/OpenList/releases")
    list=$(printf '%s\n' "$content" | grep -o '"tag_name": *"v[^"]*"' | sed 's/.*"v/v/;s/"//g' | grep -v 'beta')
  fi

  printf '%s\n' "$list" | grep -E '^v[0-9]+' | head -n 8
}

get_latest_version() {
  version=$(get_versions | head -n 1)
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

  echo "[$(date "+%Y-%m-%d %H:%M:%S")] 开始下载: ${target_version} (${OpenList_file})" >>"${MODDIR}/log.log"
  echo "开始下载: ${target_version}"

  local official_url="https://github.com/OpenListTeam/OpenList/releases/download/${target_version}/${OpenList_file}"
  local mirror_url="https://ghproxy.net/${official_url}"

  local downloaded=false
  if download_file "${mirror_url}" "${TEMP_DIR}/${OpenList_file}"; then
    downloaded=true
  elif download_file "${official_url}" "${TEMP_DIR}/${OpenList_file}"; then
    downloaded=true
  fi

  if [ "$downloaded" != "true" ] || [ ! -s "${TEMP_DIR}/${OpenList_file}" ]; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 下载失败，请检查网络连接" >>"${MODDIR}/log.log"
    echo "下载失败，请检查网络连接"
    rm -rf "${TEMP_DIR}" 2>/dev/null
    return 1
  fi

  EXTRACT_DIR="${TEMP_DIR}/extracted"
  if ! mkdir -p "${EXTRACT_DIR}"; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 创建解压目录失败" >>"${MODDIR}/log.log"
    echo "创建解压目录失败"
    return 1
  fi

  if ! extract_tar_gz "${TEMP_DIR}/${OpenList_file}" "${EXTRACT_DIR}"; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 解压失败" >>"${MODDIR}/log.log"
    echo "解压失败"
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
    sleep 5
  done

  echo "[$(date "+%Y-%m-%d %H:%M:%S")] ${action}失败" >>"${MODDIR}/log.log"
  echo "${action}失败"
  return 1
}

find_busybox
mkdir -p "${MODDIR}/bin" "${MODDIR}/data/temp"

if [ "$1" = "list-versions" ]; then
  list=$(get_versions | head -n 8)
  if [ -z "$list" ]; then
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 无法获取版本列表" >>"${MODDIR}/log.log"
    echo "无法获取版本列表"
    exit 1
  fi
  printf '%s\n' "$list"
  exit 0
fi

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
