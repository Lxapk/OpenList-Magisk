#!/system/bin/sh

MODDIR="$(dirname "$(readlink -f "$0")")"

find_busybox() {
    for path in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox; do
        [ -f "$path" ] && {
            BUSYBOX="$path"
            return
        }
    done
    BUSYBOX="busybox"
}

ARCH=$(uname -m)
case "$ARCH" in
    aarch64 | arm64) ARCH="arm64" ;;
    arm*) ARCH="arm" ;;
    *) ARCH="arm64" ;;
esac

LATEST_URL="https://api.github.com/repos/OpenListTeam/OpenList/releases/latest"

get_latest_version() {
    version=$(
        "${BUSYBOX}" wget -q --no-check-certificate -O - "${LATEST_URL}" 2>/dev/null |
            grep -o '"tag_name": "[^"]*"' |
            sed 's/"tag_name": "//;s/"//g;s/^v//'
    )

    [ -z "$version" ] && return 1
    echo "$version"
}

get_version() {
    [ -x "${MODDIR}/bin/openlist" ] && {
        "${MODDIR}/bin/openlist" version 2>/dev/null | awk '/^Version:/ {print $2}' | sed 's/^v//'
    } || echo "未安装"
}

prepare_temp_dir() {
    TEMP_DIR="${MODDIR}/data/temp"
    rm -rf "${TEMP_DIR}" 2>/dev/null
    mkdir -p "${TEMP_DIR}"
    echo "$TEMP_DIR"
}

download_and_extract() {
    OpenList_file="openlist-android-${ARCH}.tar.gz"
    TEMP_DIR=$(prepare_temp_dir)

    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 开始下载: v${url_version}" >>"${MODDIR}/log.log"

    "${BUSYBOX}" wget -q --no-check-certificate -O "${TEMP_DIR}/${OpenList_file}" \
        "https://github.com/OpenListTeam/OpenList/releases/latest/download/${OpenList_file}" 2>/dev/null || {
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 尝试备用下载源: v${url_version}" >>"${MODDIR}/log.log"
        "${BUSYBOX}" wget -q --no-check-certificate -O "${TEMP_DIR}/${OpenList_file}" \
            "https://github.com/OpenListTeam/OpenList/releases/download/v${url_version}/${OpenList_file}" 2>/dev/null || {
            echo "[$(date "+%Y-%m-%d %H:%M:%S")] 无法获取安装源" >>"${MODDIR}/log.log"
            [ "$MANUAL_MODE" = "1" ] && echo "无法获取安装源"
            return 1
        }
    }

    EXTRACT_DIR="${TEMP_DIR}/extracted"
    mkdir -p "${EXTRACT_DIR}"

    "${BUSYBOX}" tar -xzf "${TEMP_DIR}/${OpenList_file}" -C "${EXTRACT_DIR}" >/dev/null 2>&1 || {
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 解压失败" >>"${MODDIR}/log.log"
        [ "$MANUAL_MODE" = "1" ] && echo "解压失败"
        return 1
    }

    EXECUTABLE_FILE=$(find "${EXTRACT_DIR}" -type f -name "openlist" | head -n 1)
    if [ -z "$EXECUTABLE_FILE" ]; then
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 未找到可执行文件" >>"${MODDIR}/log.log"
        [ "$MANUAL_MODE" = "1" ] && echo "未找到可执行文件"
        return 1
    fi

    chmod 755 "${EXECUTABLE_FILE}"
    temp_version=$("${EXECUTABLE_FILE}" version 2>/dev/null | awk '/^Version:/ {print $2}')
    temp_version="${temp_version#v}"

    mkdir -p "${MODDIR}/bin"
    mv -f "${EXECUTABLE_FILE}" "${MODDIR}/bin/openlist"
    chmod 755 "${MODDIR}/bin/openlist"

    rm -rf "${TEMP_DIR}"

    version=$(get_version)
    if [ "$version" != "$temp_version" ]; then
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 版本验证失败: ${temp_version} vs ${version}" >>"${MODDIR}/log.log"
        [ "$MANUAL_MODE" = "1" ] && echo "版本验证失败"
        return 1
    fi

    return 0
}

update_and_restart() {
    sed -i "s/^version=.*/version=v${url_version}/g" "${MODDIR}/module.prop"
    
    pkill -f 'openlist server' >/dev/null 2>&1
    
    local timeout=3
    local elapsed=0
    while pgrep -f 'openlist server' >/dev/null; do
        if [ $elapsed -ge $timeout ]; then
            pkill -9 -f 'openlist server' >/dev/null 2>&1
            break
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
}

check_update() {
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] === 开始检查更新 ===" >>"${MODDIR}/log.log"

    if ! url_version=$(get_latest_version); then
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 无法获取安装源，跳过本次更新" >>"${MODDIR}/log.log"
        [ "$MANUAL_MODE" = "1" ] && echo "无法获取安装源"
        return 2
    fi

    current_version=$(get_version)
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 最新版本: v${url_version}" >>"${MODDIR}/log.log"

    if [ "$current_version" = "未安装" ]; then
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 当前版本: ${current_version}" >>"${MODDIR}/log.log"
    else
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 当前版本: v${current_version}" >>"${MODDIR}/log.log"
    fi

    [ "$current_version" != "未安装" ] && [ "$current_version" = "$url_version" ] && {
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 已是最新版本" >>"${MODDIR}/log.log"
        [ "$MANUAL_MODE" = "1" ] && echo "已是最新版本"
        return 0
    }

    local action="安装"
    [ "$current_version" != "未安装" ] && action="更新"
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] 开始${action} v${url_version}" >>"${MODDIR}/log.log"

    for attempt in 1 2 3; do
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 更新尝试 ${attempt}/3" >>"${MODDIR}/log.log"
        [ "$MANUAL_MODE" = "1" ] && echo "更新尝试 ${attempt}/3"
        download_and_extract && {
            update_and_restart
            echo "[$(date "+%Y-%m-%d %H:%M:%S")] ${action}成功" >>"${MODDIR}/log.log"
            [ "$MANUAL_MODE" = "1" ] && echo "${action}成功"
            return 0
        }
        sleep 10
    done

    echo "[$(date "+%Y-%m-%d %H:%M:%S")] ${action}失败" >>"${MODDIR}/log.log"
    [ "$MANUAL_MODE" = "1" ] && echo "${action}失败"
    return 1
}

delete_large_log() {
    [ -f "${MODDIR}/log.log" ] && {
        log_size=$(wc -c <"${MODDIR}/log.log")
        [ "$log_size" -gt 1048576 ] && rm -f "${MODDIR}/log.log"
    }
}

find_busybox
mkdir -p "${MODDIR}/bin" "${MODDIR}/data/temp"

[ "$1" = "manual-update" ] && {
    MANUAL_MODE=1
    check_update
    exit $?
}

[ "$1" = "set-password-base64" ] && [ -n "$2" ] && {
    password=$(echo "$2" | base64 -d 2>/dev/null)
    [ -n "$password" ] && [ -x "${MODDIR}/bin/openlist" ] && {
        "${MODDIR}/bin/openlist" admin set "$password" --data "${MODDIR}/data" >/dev/null 2>&1
        exit $?
    }
    exit 1
}

while true; do
    delete_large_log
    check_update
    result=$?
    if [ $result -eq 2 ]; then
        sleep 30m
    else
        sleep 3h
    fi
done