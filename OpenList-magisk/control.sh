#!/system/bin/sh
MODDIR="/data/adb/modules/OpenList"
LOG="$MODDIR/log.log"

log() {
    echo "[$(date '+%F %T')] $1" >>"$LOG"
}

is_running() {
    pgrep -f 'openlist server' >/dev/null
}

start_once() {
    BIN="$MODDIR/bin/openlist"
    [ ! -x "$BIN" ] && return 1
    chmod 755 "$BIN" 2>/dev/null
    chcon u:object_r:system_file:s0 "$BIN" 2>/dev/null || true
    "$BIN" server --data "$MODDIR/data" >/dev/null 2>&1 &
    log "启动OpenList服务"
}

stop_once() {
    pkill -f 'openlist server'
}

get_local_ip() {
    local ip=""
    if command -v ip >/dev/null 2>&1; then
        ip=$(ip -o -4 addr show wlan0 2>/dev/null | awk '{print $4}' | cut -d'/' -f1)
    fi
    if [ -z "$ip" ] && command -v ifconfig >/dev/null 2>&1; then
        ip=$(ifconfig wlan0 2>/dev/null | awk '/inet / {print $2}' | sed 's/.*://')
    fi
    
    [ -z "$ip" ] && ip="未获取到"
    echo "$ip"
}

while true; do
    if [ -f "$MODDIR/disable" ]; then
        is_running && {
            log "disable 存在，停止服务"
            stop_once
        }
    else
        is_running || start_once
    fi

    update_flag="已停止"
    pgrep -f 'update.sh' >/dev/null && update_flag="运行中"
    ip=$(get_local_ip)
    desc="OpenList $(is_running && echo "运行中" || echo "已停止") | 更新:$update_flag | IP:$ip"
    sed -i "s/^description=.*/description=$desc/g" "$MODDIR/module.prop"
    sleep 5
done
