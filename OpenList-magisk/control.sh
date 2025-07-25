#!/system/bin/sh

MODDIR="/data/adb/modules/OpenList"
LOG="$MODDIR/log.log"

log() {
    echo "[$(date '+%F %T')] $1" >> "$LOG"
}

is_running() {
    pgrep -f 'openlist server' > /dev/null
}

start_once() {
    local bin="$MODDIR/bin/openlist"
    [ -x "$bin" ] || return 1

    chmod 755 "$bin" 2>/dev/null
    chcon u:object_r:system_file:s0 "$bin" 2>/dev/null || true

    "$bin" server --data "$MODDIR/data" > /dev/null 2>&1 &

    local i=0
    while [ $i -lt 5 ]; do
        is_running && {
            log "启动 OpenList 服务"
            return 0
        }
        sleep 0.2
        i=$((i + 1))
    done
    return 1
}

get_ip_port() {
    local ip port cfg="$MODDIR/data/config.json"

    ip=$(sh -c '
        ip -o -4 addr show 2>/dev/null |
        awk -F"[ /]+" '"'"'/inet / && $4 != "127.0.0.1" {print $4; exit}'"'"' ||
        ip route get 1 2>/dev/null |
        awk -F"src " '"'"'/src / {print $2; exit}'"'"'
    ')

    [ -z "$ip" ] && ip="127.0.0.1"

    [ -r "$cfg" ] && \
        port=$(awk -F'[:"[:space:]]+' '/"http_port"/ {print $3}' "$cfg" 2>/dev/null | tr -d ', ')
    [ -z "$port" ] && port=5244

    echo "${ip}:${port}"
}

while :; do
    if [ -x "$MODDIR/bin/openlist" ]; then
        if ! is_running; then
            start_once
        fi
    fi

    update_flag="已停止"
    pgrep -f 'update.sh' > /dev/null && update_flag="运行中"
    ip_port=$(get_ip_port)
    desc="服务:$(is_running && echo "运行中" || echo "已停止") | 更新:$update_flag | IP:$ip_port"
    sed -i "s/^description=.*/description=$desc/g" "$MODDIR/module.prop"

    sleep 3
done
