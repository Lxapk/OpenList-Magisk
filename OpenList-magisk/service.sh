#!/system/bin/sh

MODDIR="$(dirname "$(readlink -f "$0")")"

mkdir -p "$MODDIR/data"
chmod 755 "$MODDIR/data"
chmod 755 "$MODDIR/bin/openlist"
chmod 755 "$MODDIR"/*.sh

until [ "$(getprop sys.boot_completed)" = "1" ]; do
    sleep 5
done

if [ -e /sys/power/wake_lock ]; then
    echo "OpenList_Service" > /sys/power/wake_lock
elif [ -e /sys/power/wakeup_count ]; then
    echo 1 > /sys/power/wakeup_count
fi

"$MODDIR/bin/openlist" server --data "$MODDIR/data" > /dev/null 2>&1 &
sh "$MODDIR/control.sh" > /dev/null 2>&1 &