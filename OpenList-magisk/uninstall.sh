#!/system/bin/sh

MODDIR="/data/adb/modules/OpenList"

pkill -9 -f 'openlist server' 2>/dev/null
pkill -9 -f 'control.sh' 2>/dev/null
pkill -9 -f 'service.sh' 2>/dev/null

if [ -e /sys/power/wake_lock ]; then
  echo "OpenList_Service" >/sys/power/wake_unlock 2>/dev/null || true
fi

rm -rf "$MODDIR" 2>/dev/null || true

exit 0